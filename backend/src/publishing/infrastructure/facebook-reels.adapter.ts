import { socialFail } from '../domain/social-publication-contracts.js';
import {
  validateFacebookUploadUri,
  type FacebookSessionObservation,
  type UploadTransportObserver,
  type UploadTransportEvent,
} from '../domain/facebook-upload-session.js';

export interface FacebookReelsConfiguration {
  pageId: string;
  apiVersion: string;
  mode: 'fake' | 'live';
  getAccessToken(): string;
  getAppAccessToken(): string;
  fetch: typeof globalThis.fetch;
  allowLivePosts?: boolean;
  timeoutMs?: number;
}
export class FacebookReelsAdapter {
  readonly network = 'FACEBOOK_REELS';
  readonly accountId: string;
  readonly mode: 'fake' | 'live';
  #config: FacebookReelsConfiguration;
  constructor(config: FacebookReelsConfiguration) {
    if (
      !/^[1-9]\d{4,63}$/.test(config.pageId) ||
      !/^v\d{2}\.0$/.test(config.apiVersion) ||
      !['fake', 'live'].includes(config.mode) ||
      typeof config.fetch !== 'function' ||
      typeof config.getAccessToken !== 'function' ||
      typeof config.getAppAccessToken !== 'function' ||
      (config.timeoutMs !== undefined &&
        (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1))
    )
      socialFail('SOCIAL_CONFIG_INVALID');
    if (config.mode === 'fake' && config.fetch === globalThis.fetch)
      socialFail('SOCIAL_OFFLINE_TRANSPORT_REQUIRED');
    this.#config = { ...config };
    this.mode = config.mode;
    this.accountId = 'facebook_reels:' + config.pageId;
  }
  assertMutationAllowed() {
    if (this.mode === 'live' && !this.#config.allowLivePosts)
      socialFail('SOCIAL_LIVE_POST_BLOCKED');
  }
  private token(app = false) {
    const token = app
      ? this.#config.getAppAccessToken()
      : this.#config.getAccessToken();
    if (!token || /[\s\r\n]/.test(token)) socialFail('SOCIAL_AUTH_REQUIRED');
    return token;
  }
  private async response(
    url: URL,
    init: RequestInit,
    observe?: UploadTransportObserver,
  ) {
    const event = (
      kind: UploadTransportEvent['kind'],
      extra: Partial<UploadTransportEvent> = {},
    ) =>
      observe?.({
        kind,
        at: new Date().toISOString(),
        method: 'POST',
        requestType: 'UPLOAD',
        destination: url.origin + url.pathname,
        payloadSize: init.body instanceof Uint8Array ? init.body.byteLength : 0,
        ...extra,
      });
    await event('ATTEMPT_STARTED');
    let response: Response;
    try {
      response = await this.#config.fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 15000),
      });
    } catch (error) {
      await event('RESPONSE_UNKNOWN', {
        error:
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'TIMEOUT'
            : 'NETWORK',
      });
      socialFail('SOCIAL_NETWORK_UNCERTAIN');
    }
    await event('HTTP_RESPONSE', { httpStatus: response.status });
    let data: any;
    try {
      data = await response.json();
    } catch {
      await event('RESPONSE_UNKNOWN', {
        httpStatus: response.status,
        error: 'INVALID_RESPONSE',
      });
      socialFail('SOCIAL_RESPONSE_UNCERTAIN');
    }
    if (!response.ok || data?.error) {
      await event('OBSERVED_FAILURE', {
        httpStatus: response.status,
        error: 'HTTP_REJECTED',
      });
      const code = Number(data?.error?.code);
      socialFail(
        code === 190 || response.status === 401
          ? 'SOCIAL_AUTH_REQUIRED'
          : response.status === 403 || [10, 200].includes(code)
            ? 'SOCIAL_PERMISSION_REQUIRED'
            : response.status === 429
              ? 'SOCIAL_RATE_LIMIT'
              : response.status >= 500
                ? 'SOCIAL_REMOTE_UNCERTAIN'
                : 'SOCIAL_API_REJECTED',
      );
    }
    return data;
  }
  private request(
    path: string,
    method: 'GET' | 'POST',
    fields: Record<string, string> = {},
    app = false,
  ) {
    if (method === 'POST') this.assertMutationAllowed();
    const url = new URL(
      `https://graph.facebook.com/${this.#config.apiVersion}/${path}`,
    );
    if (method === 'GET') url.search = new URLSearchParams(fields).toString();
    return this.response(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + this.token(app),
        ...(method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      ...(method === 'POST'
        ? { body: new URLSearchParams(fields).toString() }
        : {}),
    });
  }
  private id(value: string) {
    if (!/^\d{5,64}$/.test(value)) socialFail('SOCIAL_RECEIPT_INVALID');
    return value;
  }
  private destination(value: string) {
    if (value !== this.accountId) socialFail('SOCIAL_DESTINATION_INVALID');
  }
  async verifyConnection() {
    const page = await this.request('me', 'GET', { fields: 'id' });
    if (page.id !== this.#config.pageId)
      socialFail('SOCIAL_DESTINATION_INVALID');
    const debug = await this.request(
      'debug_token',
      'GET',
      { input_token: this.token() },
      true,
    );
    if (debug.data?.is_valid !== true || debug.data?.type !== 'PAGE')
      socialFail('SOCIAL_AUTH_REQUIRED');
    if (!debug.data.scopes?.includes('pages_manage_posts'))
      socialFail('SOCIAL_PERMISSION_REQUIRED');
    if (debug.data.profile_id && debug.data.profile_id !== this.#config.pageId)
      socialFail('SOCIAL_DESTINATION_INVALID');
    if (debug.data.expires_at && debug.data.expires_at * 1000 <= Date.now())
      socialFail('SOCIAL_AUTH_REQUIRED');
  }
  createContainer() {
    return socialFail('SOCIAL_LOCAL_MEDIA_REQUIRED');
  }
  async createResumableContainer(input: {
    accountId: string;
    caption: string;
  }) {
    this.destination(input.accountId);
    const d = await this.request(this.#config.pageId + '/video_reels', 'POST', {
      upload_phase: 'start',
    });
    const id = this.id(d.video_id);
    const uploadUri = validateFacebookUploadUri(
      d.upload_url,
      id,
      this.#config.apiVersion,
    );
    return {
      containerId: id,
      uploadUri,
      sessionEvidence: {
        source: 'META_CREATE_RESPONSE',
        graphVersion: this.#config.apiVersion,
        pageId: this.#config.pageId,
        videoId: id,
        originalUrlRecovered: true,
      },
    };
  }
  async uploadResumableBytes(
    uri: string,
    bytes: Buffer,
    videoId?: string,
    observer?: UploadTransportObserver,
  ) {
    this.assertMutationAllowed();
    validateFacebookUploadUri(uri, videoId ?? '', this.#config.apiVersion);
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      socialFail('SOCIAL_UPLOAD_URI_INVALID');
    let last: UploadTransportEvent | undefined;
    const observe: UploadTransportObserver = async (e) => {
      last = e;
      await observer?.(e);
    };
    const d = await this.response(
      new URL(uri),
      {
        method: 'POST',
        headers: {
          Authorization: 'OAuth ' + this.token(),
          offset: '0',
          file_size: String(bytes.length),
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(bytes) as unknown as BodyInit,
      },
      observe,
    );
    if (d.success !== true) {
      await observe({
        ...last!,
        kind: 'RESPONSE_UNKNOWN',
        at: new Date().toISOString(),
        error: 'UNCONFIRMED',
      });
      socialFail('SOCIAL_RESPONSE_UNCERTAIN');
    }
    await observe({
      ...last!,
      kind: 'TRANSFER_CONFIRMED',
      at: new Date().toISOString(),
    });
    return { uploaded: true };
  }
  documentedUploadEndpoint(videoId: string, uploadVersion: string) {
    if (!['v26.0', 'v27.0'].includes(uploadVersion))
      socialFail('SOCIAL_UPLOAD_URI_INVALID');
    return validateFacebookUploadUri(
      `https://rupload.facebook.com/video-upload/${uploadVersion}/${this.id(videoId)}`,
      videoId,
      this.#config.apiVersion,
    );
  }
  async inspectUploadSession(
    videoId: string,
  ): Promise<FacebookSessionObservation> {
    const id = this.id(videoId);
    const d = await this.request(id, 'GET', {
      fields: 'id,status,from,created_time',
    });
    const s = d.status;
    if (
      d.id !== id ||
      d.from?.id !== this.#config.pageId ||
      !Number.isFinite(Date.parse(d.created_time)) ||
      [
        s?.video_status,
        s?.uploading_phase?.status,
        s?.processing_phase?.status,
        s?.publishing_phase?.status,
      ].some((v) => typeof v !== 'string')
    )
      socialFail('SOCIAL_SESSION_UNVERIFIED');
    const field = (o: any, key: string, numeric = false) => {
      if (!Object.hasOwn(o, key)) return { present: false as const };
      const value = o[key];
      if (
        numeric &&
        value !== null &&
        (!Number.isSafeInteger(value) || value < 0)
      )
        socialFail('SOCIAL_SESSION_UNVERIFIED');
      return { present: true as const, value };
    };
    const errors = (o: any) => {
      const f = field(o, 'errors');
      if (!f.present || f.value === null) return f;
      if (!Array.isArray(f.value)) socialFail('SOCIAL_SESSION_UNVERIFIED');
      return {
        present: true as const,
        value: f.value.map((e: any) => {
          if (!e || typeof e !== 'object')
            socialFail('SOCIAL_SESSION_UNVERIFIED');
          return Object.fromEntries(
            ['code', 'error_subcode']
              .filter((k) => Number.isSafeInteger(e[k]))
              .map((k) => [k, e[k]]),
          );
        }),
      };
    };
    const fields = {
      videoStatus: field(s, 'video_status'),
      uploadStatus: field(s.uploading_phase, 'status'),
      bytesTransferred: field(s.uploading_phase, 'bytes_transferred', true),
      bytesTransfered: field(s.uploading_phase, 'bytes_transfered', true),
      sourceFileSize: field(s.uploading_phase, 'source_file_size', true),
      uploadErrors: errors(s.uploading_phase),
      processingErrors: errors(s.processing_phase),
      publishingErrors: errors(s.publishing_phase),
      processingStatus: field(s.processing_phase, 'status'),
      publicationStatus: field(s.publishing_phase, 'status'),
    };
    const selected = fields.bytesTransferred.present
      ? fields.bytesTransferred
      : fields.bytesTransfered;
    const conflict =
      fields.bytesTransferred.present &&
      fields.bytesTransfered.present &&
      fields.bytesTransferred.value !== fields.bytesTransfered.value;
    const transferred = conflict
      ? undefined
      : selected.present
        ? selected.value
        : undefined;
    const progress = conflict
      ? ('CONFLICT' as const)
      : typeof transferred === 'number'
        ? ('CONSISTENT' as const)
        : ('UNKNOWN' as const);
    if (
      transferred !== undefined &&
      transferred !== null &&
      (!Number.isSafeInteger(transferred) || transferred < 0)
    )
      socialFail('SOCIAL_SESSION_UNVERIFIED');
    return {
      fields,
      progress,
      videoId: id,
      pageId: d.from.id,
      createdAt: d.created_time,
      observedAt: new Date().toISOString(),
      graphVersion: this.#config.apiVersion,
      videoStatus: s.video_status,
      uploadStatus: s.uploading_phase.status,
      processingStatus: s.processing_phase.status,
      publicationStatus: s.publishing_phase.status,
      bytesTransferred:
        Number.isSafeInteger(transferred) && transferred >= 0
          ? transferred
          : null,
    };
  }
  async getContainerStatus(input: { containerId: string }) {
    const d = await this.request(this.id(input.containerId), 'GET', {
        fields: 'status',
      }),
      s = d.status;
    if (!s || typeof s.video_status !== 'string')
      socialFail('SOCIAL_STATUS_INVALID');
    const status =
      s.video_status === 'expired'
        ? 'EXPIRED'
        : ['error', 'upload_failed'].includes(s.video_status) ||
            [s.uploading_phase, s.processing_phase, s.publishing_phase].some(
              (p) => p?.status === 'error',
            )
          ? 'ERROR'
          : s.video_status === 'ready' &&
              s.publishing_phase?.status === 'complete'
            ? 'PUBLISHED'
            : s.uploading_phase?.status === 'complete' &&
                s.processing_phase?.status === 'complete'
              ? 'FINISHED'
              : 'IN_PROGRESS';
    return { status };
  }
  async publish(input: {
    accountId: string;
    containerId: string;
    caption?: string;
  }) {
    this.destination(input.accountId);
    const id = this.id(input.containerId);
    const d = await this.request(this.#config.pageId + '/video_reels', 'POST', {
      upload_phase: 'finish',
      video_id: id,
      video_state: 'PUBLISHED',
      description: input.caption ?? '',
    });
    if (d.success !== true) socialFail('SOCIAL_RESPONSE_UNCERTAIN');
    return { mediaId: id };
  }
  async getMedia(input: { mediaId: string }) {
    const id = this.id(input.mediaId),
      d = await this.request(id, 'GET', {
        fields: 'id,status,permalink_url,created_time',
      });
    if (
      d.id !== id ||
      d.status?.video_status !== 'ready' ||
      d.status?.publishing_phase?.status !== 'complete'
    )
      socialFail('SOCIAL_RECONCILIATION_REQUIRED');
    let permalink: string | null = null;
    if (d.permalink_url) {
      const u = new URL(d.permalink_url, 'https://www.facebook.com');
      if (
        !['facebook.com', 'www.facebook.com'].includes(u.hostname) ||
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.port ||
        !/^\/reel\/\d+\/?$/.test(u.pathname)
      )
        socialFail('SOCIAL_RECEIPT_INVALID');
      permalink = 'https://www.facebook.com' + u.pathname;
    }
    if (!Number.isFinite(Date.parse(d.created_time)))
      socialFail('SOCIAL_RECEIPT_INVALID');
    return { mediaId: id, permalink, publishedAt: d.created_time };
  }
}
