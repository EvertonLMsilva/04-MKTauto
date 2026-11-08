import { createHash } from 'node:crypto';
import type {
  OperationalNotification,
  OperationalNotificationPort,
  NotificationDelivery,
} from '../application/operational-notification.port.js';
export class NullOperationalNotificationAdapter implements OperationalNotificationPort {
  readonly enabled = false;
  readonly destinationId = null;
  constructor(readonly disabledReason = 'OPERATIONAL_NOTIFICATIONS_DISABLED') {}
  async send(_message: OperationalNotification): Promise<NotificationDelivery> {
    return { status: 'FAILED', errorCode: 'NOTIFICATIONS_DISABLED' };
  }
}
export class FakeOperationalNotificationAdapter implements OperationalNotificationPort {
  readonly enabled = true;
  constructor(readonly destinationId = 'fake:operator') {}
  readonly messages: OperationalNotification[] = [];
  result?: NotificationDelivery;
  async send(message: OperationalNotification): Promise<NotificationDelivery> {
    this.messages.push(message);
    return (
      this.result ?? {
        status: 'DELIVERED',
        messageId: String(this.messages.length),
      }
    );
  }
}
export class TelegramOperationalNotificationAdapter implements OperationalNotificationPort {
  readonly enabled = true;
  readonly destinationId: string;
  #token: string;
  #chatId: string;
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;
  constructor(
    token: string,
    chatId: string,
    fetch: typeof globalThis.fetch = globalThis.fetch,
    timeoutMs = 5000,
  ) {
    if (
      !validCredentials(token, chatId) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1
    )
      throw new Error('TELEGRAM_CONFIGURATION_REQUIRED');
    this.#token = token;
    this.#chatId = chatId;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
    this.destinationId = `telegram:${createHash('sha256').update(chatId).digest('hex')}`;
  }
  async send(message: OperationalNotification): Promise<NotificationDelivery> {
    try {
      const text = message.text
        .replaceAll(this.#token, '[redigido]')
        .replaceAll(this.#chatId, '[redigido]');
      const response = await this.#fetch(
        `https://api.telegram.org/bot${this.#token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.#chatId, text }),
          redirect: 'error',
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
      );
      if (!response.ok)
        return {
          status: 'FAILED',
          errorCode:
            response.status === 401
              ? 'TELEGRAM_AUTH_REQUIRED'
              : response.status === 403
                ? 'TELEGRAM_DESTINATION_REJECTED'
                : response.status === 429
                  ? 'TELEGRAM_RATE_LIMIT'
                  : 'TELEGRAM_HTTP_ERROR',
        };
      const data = await response.json();
      if (data?.ok === false)
        return { status: 'FAILED', errorCode: 'TELEGRAM_API_REJECTED' };
      if (
        data?.ok !== true ||
        !Number.isSafeInteger(data.result?.message_id) ||
        data.result.message_id < 1
      )
        return {
          status: 'UNCERTAIN',
          errorCode: 'TELEGRAM_RESPONSE_UNCERTAIN',
        };
      return { status: 'DELIVERED', messageId: String(data.result.message_id) };
    } catch (error) {
      return {
        status: 'UNCERTAIN',
        errorCode:
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'TELEGRAM_TIMEOUT'
            : 'TELEGRAM_NETWORK_UNCERTAIN',
      };
    }
  }
}
function validCredentials(token: unknown, chatId: unknown): boolean {
  return (
    typeof token === 'string' &&
    /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(token) &&
    typeof chatId === 'string' &&
    /^-?[1-9]\d{0,19}$/.test(chatId)
  );
}
export function notificationAdapter(
  env: Record<string, string | undefined>,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): OperationalNotificationPort {
  if (env.OPERATIONAL_NOTIFICATIONS_ENABLED !== 'true')
    return new NullOperationalNotificationAdapter();
  if (!validCredentials(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID))
    return new NullOperationalNotificationAdapter(
      'OPERATIONAL_NOTIFICATIONS_CONFIGURATION_REQUIRED',
    );
  return new TelegramOperationalNotificationAdapter(
    env.TELEGRAM_BOT_TOKEN!,
    env.TELEGRAM_CHAT_ID!,
    fetch,
  );
}
