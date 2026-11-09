import {
  accountId,
  socialFail,
} from '../domain/social-publication-contracts.js';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

export interface InstagramGraphConfiguration {
  accountId: string;
  apiVersion: string;
  mode: 'fake' | 'live';
  getAccessToken: () => string;
  fetch: typeof globalThis.fetch;
  allowLivePosts?: boolean;
  timeoutMs?: number;
}
// Facebook Login, professional Instagram account. Token supplied from a vault/environment;
// never stored in operation payloads. Mutating requests deliberately have no retry.
// Reference: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
export class InstagramGraphAdapter {
  readonly accountId: string;
  readonly mode: 'fake' | 'live';
  #config: InstagramGraphConfiguration;
  constructor(config: InstagramGraphConfiguration) {
    if (
      !/^[1-9]\d{4,63}$/.test(config.accountId) ||
      !/^v\d{2}\.0$/.test(config.apiVersion) ||
      !['fake', 'live'].includes(config.mode) ||
      typeof config.fetch !== 'function' ||
      typeof config.getAccessToken !== 'function' ||
      (config.timeoutMs !== undefined &&
        (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1))
    )
      socialFail('SOCIAL_CONFIG_INVALID');
    if (config.mode === 'fake' && config.fetch === globalThis.fetch)
      socialFail('SOCIAL_OFFLINE_TRANSPORT_REQUIRED');
    this.#config = { ...config };
    this.accountId = config.accountId;
    this.mode = config.mode;
  }
  assertMutationAllowed() {
    if (this.mode === 'live' && !this.#config.allowLivePosts)
      socialFail('SOCIAL_LIVE_POST_BLOCKED');
  }
  private destination(id: string) {
    if (id !== this.accountId) socialFail('SOCIAL_DESTINATION_INVALID');
  }
  private async request(
    path: string,
    method: 'GET' | 'POST',
    fields: Record<string, string>,
  ) {
    if (method === 'POST') this.assertMutationAllowed();
    const token = this.#config.getAccessToken();
    if (typeof token !== 'string' || !token || /[\s\r\n]/.test(token))
      socialFail('SOCIAL_AUTH_REQUIRED');
    const url = new URL(
      `https://graph.facebook.com/${this.#config.apiVersion}/${path}`,
    );
    if (method === 'GET') url.search = new URLSearchParams(fields).toString();
    let response: Response;
    try {
      response = await this.#config.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === 'POST'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        ...(method === 'POST'
          ? { body: new URLSearchParams(fields).toString() }
          : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 15000),
      });
    } catch {
      return socialFail('SOCIAL_NETWORK_UNCERTAIN');
    }
    let data: any;
    try {
      data = await response.json();
    } catch {
      return socialFail('SOCIAL_RESPONSE_UNCERTAIN');
    }
    if (!response.ok || data?.error) {
      const code = Number(data?.error?.code);
      const classification =
        code === 190 || response.status === 401
          ? 'SOCIAL_AUTH_REQUIRED'
          : response.status === 429 ||
              [4, 17, 32, 613, 80002].includes(code) ||
              Number(data?.error?.error_subcode) === 2207042
            ? 'SOCIAL_RATE_LIMIT'
            : response.status === 403 || [10, 200].includes(code)
              ? 'SOCIAL_PERMISSION_REQUIRED'
              : response.status >= 500
                ? 'SOCIAL_REMOTE_UNCERTAIN'
                : 'SOCIAL_API_REJECTED';
      // Never propagate provider messages, URLs, headers or response bodies (may contain secrets).
      throw Object.assign(new Error(classification), {
        code: classification,
        retryAfterSeconds: /^\d+$/.test(
          response.headers.get('retry-after') ?? '',
        )
          ? Number(response.headers.get('retry-after'))
          : null,
      });
    }
    return data;
  }
  async createContainer(input: {
    accountId: string;
    caption: string;
    videoUrl: string;
  }) {
    this.destination(input.accountId);
    let url: URL;
    try {
      url = new URL(input.videoUrl);
    } catch {
      return socialFail('SOCIAL_TRANSFER_INVALID');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      typeof input.caption !== 'string' ||
      Array.from(input.caption).length > 2200
    )
      socialFail('SOCIAL_TRANSFER_INVALID');
    const data = await this.request(`${this.accountId}/media`, 'POST', {
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
    });
    if (!/^[1-9]\d{4,63}$/.test(data?.id)) socialFail('SOCIAL_RECEIPT_INVALID');
    return { containerId: String(data.id) };
  }
  async createResumableContainer(input: { accountId: string; caption: string }) {
    this.destination(input.accountId);
    if (typeof input.caption !== 'string' || Array.from(input.caption).length > 2200)
      socialFail('SOCIAL_TRANSFER_INVALID');
    const data = await this.request(`${this.accountId}/media`, 'POST', {
      media_type: 'REELS', upload_type: 'resumable', caption: input.caption,
    });
    accountId(data?.id);
    const uploadUri = this.validUploadUri(data?.uri);
    return { containerId: String(data.id), uploadUri };
  }
  private validUploadUri(value: unknown): string {
    if (typeof value !== 'string') socialFail('SOCIAL_TRANSFER_INVALID');
    let url: URL;
    try { url = new URL(value); } catch { return socialFail('SOCIAL_TRANSFER_INVALID'); }
    if (url.protocol !== 'https:' || url.hostname !== 'rupload.facebook.com' ||
      url.port || url.username || url.password || url.search || url.hash ||
      !/^\/ig-api-upload\/(?:v\d+\.\d+\/)?[1-9]\d{4,63}$/.test(url.pathname))
      socialFail('SOCIAL_TRANSFER_INVALID');
    return url.toString();
  }
  async uploadResumableFile(uploadUri: string, path: string, expectedHash: string) {
    this.assertMutationAllowed();
    this.validUploadUri(uploadUri);
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) socialFail('SOCIAL_TRANSFER_INVALID');
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 1_000_000_000)
      socialFail('SOCIAL_TRANSFER_INVALID');
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== expectedHash)
      socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
    return this.uploadResumableBytes(uploadUri, bytes);
  }
  async uploadResumableBytes(uploadUri: string, bytes: Buffer) {
    this.assertMutationAllowed();
    const url = this.validUploadUri(uploadUri);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1_000_000_000)
      socialFail('SOCIAL_TRANSFER_INVALID');
    const token = this.#config.getAccessToken();
    if (typeof token !== 'string' || !token || /[\s\r\n]/.test(token))
      socialFail('SOCIAL_AUTH_REQUIRED');
    let response: Response;
    try {
      response = await this.#config.fetch(url, {
        method: 'POST',
        headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.length) },
        body: Uint8Array.from(bytes),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 15000),
      });
    } catch { return socialFail('SOCIAL_NETWORK_UNCERTAIN'); }
    let result: unknown;
    try { result = await response.json(); } catch { return socialFail('SOCIAL_RESPONSE_UNCERTAIN'); }
    if (!response.ok || !result || typeof result !== 'object' ||
      (result as { success?: unknown }).success !== true)
      socialFail('SOCIAL_RESPONSE_UNCERTAIN');
    return { uploaded: true as const };
  }
  async getContainerStatus(input: { containerId: string }) {
    accountId(input.containerId);
    const data = await this.request(input.containerId, 'GET', {
      fields: 'status_code',
    });
    if (
      !['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED'].includes(
        data?.status_code,
      )
    )
      socialFail('SOCIAL_STATUS_INVALID');
    return { status: String(data.status_code) };
  }
  async publish(input: { accountId: string; containerId: string }) {
    this.destination(input.accountId);
    accountId(input.containerId);
    const data = await this.request(`${this.accountId}/media_publish`, 'POST', {
      creation_id: input.containerId,
    });
    if (!/^[1-9]\d{4,63}$/.test(data?.id)) socialFail('SOCIAL_RECEIPT_INVALID');
    return { mediaId: String(data.id) };
  }
  async getMedia(input: { mediaId: string }) {
    accountId(input.mediaId);
    const data = await this.request(input.mediaId, 'GET', {
      fields: 'id,permalink,timestamp',
    });
    if (
      data?.id !== input.mediaId ||
      typeof data.permalink !== 'string' ||
      !/^https:\/\/(www\.)?instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]+\/$/.test(
        data.permalink,
      ) ||
      typeof data.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(data.timestamp))
    )
      socialFail('SOCIAL_RECEIPT_INVALID');
    return {
      mediaId: input.mediaId,
      permalink: data.permalink,
      publishedAt: new Date(data.timestamp).toISOString(),
    };
  }
}
