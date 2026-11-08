import { createHash } from 'node:crypto';
import type {
  OperationalNotification,
  OperationalNotificationPort,
  NotificationDelivery,
} from '../application/operational-notification.port.js';
import { NullOperationalNotificationAdapter } from './operational-notification.adapter.js';

function parseWebhook(
  raw: unknown,
): { url: URL; id: string; token: string } | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw),
      match =
        /^\/api\/(?:v\d{1,2}\/)?webhooks\/([1-9]\d{4,21})\/([A-Za-z0-9._-]{20,200})\/?$/.exec(
          url.pathname,
        );
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'discord.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !match ||
      [...url.searchParams.keys()].some((key) => key !== 'wait') ||
      url.searchParams.getAll('wait').length > 1 ||
      (url.searchParams.has('wait') &&
        !['true', 'false'].includes(url.searchParams.get('wait')!))
    )
      return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.searchParams.set('wait', 'true');
    return { url, id: match[1], token: match[2] };
  } catch {
    return null;
  }
}

export class DiscordOperationalNotificationAdapter implements OperationalNotificationPort {
  readonly enabled = true;
  readonly destinationId: string;
  #url: URL;
  #configuredUrl: string;
  #token: string;
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;
  constructor(
    webhookUrl: string,
    fetch: typeof globalThis.fetch = globalThis.fetch,
    timeoutMs = 5000,
  ) {
    const parsed = parseWebhook(webhookUrl);
    if (!parsed || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new Error('DISCORD_CONFIGURATION_REQUIRED');
    this.#url = parsed.url;
    this.#configuredUrl = webhookUrl;
    this.#token = parsed.token;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
    this.destinationId = `discord:${createHash('sha256').update(parsed.id).digest('hex')}`;
  }
  async send(message: OperationalNotification): Promise<NotificationDelivery> {
    try {
      const content = message.text
        .replaceAll(this.#configuredUrl, '[redigido]')
        .replaceAll(this.#url.href, '[redigido]')
        .replaceAll(this.#token, '[redigido]')
        .slice(0, 2000);
      const response = await this.#fetch(this.#url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok)
        return {
          status: 'FAILED',
          errorCode:
            response.status === 401
              ? 'DISCORD_AUTH_REQUIRED'
              : response.status === 403
                ? 'DISCORD_DESTINATION_REJECTED'
                : response.status === 404
                  ? 'DISCORD_WEBHOOK_UNAVAILABLE'
                  : response.status === 429
                    ? 'DISCORD_RATE_LIMIT'
                    : 'DISCORD_HTTP_ERROR',
        };
      let data;
      try {
        data = await response.json();
      } catch {
        return { status: 'UNCERTAIN', errorCode: 'DISCORD_RESPONSE_UNCERTAIN' };
      }
      if (typeof data?.id !== 'string' || !/^\d{1,20}$/.test(data.id))
        return { status: 'UNCERTAIN', errorCode: 'DISCORD_RESPONSE_UNCERTAIN' };
      return { status: 'DELIVERED', messageId: data.id };
    } catch (error) {
      return {
        status: 'UNCERTAIN',
        errorCode:
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'DISCORD_TIMEOUT'
            : 'DISCORD_NETWORK_UNCERTAIN',
      };
    }
  }
}

export function discordNotificationAdapter(
  env: Record<string, string | undefined>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): OperationalNotificationPort {
  if (env.DISCORD_NOTIFICATIONS_ENABLED !== 'true')
    return new NullOperationalNotificationAdapter(
      'DISCORD_NOTIFICATIONS_DISABLED',
    );
  if (!parseWebhook(env.DISCORD_WEBHOOK_URL))
    return new NullOperationalNotificationAdapter(
      'DISCORD_NOTIFICATIONS_CONFIGURATION_REQUIRED',
    );
  return new DiscordOperationalNotificationAdapter(
    env.DISCORD_WEBHOOK_URL!,
    fetch,
  );
}
