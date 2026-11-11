import { falFailure } from '../../finance/domain/fal-errors.js';
import { FAL_VIDEO_ENDPOINT } from '../domain/fal-model.js';
export { FAL_VIDEO_ENDPOINT } from '../domain/fal-model.js';
const submitUrl = `https://queue.fal.run/${FAL_VIDEO_ENDPOINT}`;
// Single-attempt HTTP transport. No subscribe/retry behavior around paid POSTs.
export class FalQueueClient {
  apiKey: any;
  timeoutMs: any;
  maxResponseBytes: any;
  maxVideoBytes: any;
  fetch: any;
  constructor(
    {
      apiKey,
      timeoutMs = 30000,
      maxResponseBytes = 1048576,
      maxVideoBytes = 104857600,
    }: any,
    { fetchImpl = fetch }: any = {},
  ) {
    if (
      typeof apiKey !== 'string' ||
      !apiKey ||
      [timeoutMs, maxResponseBytes, maxVideoBytes].some(
        (v: any) => !Number.isSafeInteger(v) || v < 1,
      )
    )
      throw falFailure('PROVIDER_CONFIGURATION_INVALID');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxVideoBytes = maxVideoBytes;
    this.fetch = fetchImpl;
  }
  async submit(parameters: any, options: any = {}) {
    const body = await this.#request(submitUrl, {
      ...options,
      method: 'POST',
      parameters,
    });
    const id = body?.request_id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{3,120}$/.test(id))
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    // Identity survives unusable convenience URLs. Never persist the rejected URL.
    let statusUrl = null,
      responseUrl = null;
    try {
      statusUrl = queueUrl(body.status_url, id);
    } catch {}
    try {
      responseUrl = queueUrl(body.response_url, id);
    } catch {}
    return {
      requestId: id,
      statusUrl,
      responseUrl,
      ...(!statusUrl || !responseUrl ? { reconciliationPending: true } : {}),
    };
  }
  async status(id: any, { url, ...options }: any = {}) {
    const body = await this.#request(
      queueUrl(url ?? recoveryUrl(id, 'status'), id),
      options,
    );
    if (body.request_id !== undefined && body.request_id !== id)
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    if (!['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(body.status))
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    return {
      status: body.status,
      ...(body.error != null ? { error: 'provider_failure' } : {}),
    };
  }
  async result(id: any, { url, ...options }: any = {}) {
    const body = await this.#request(
      queueUrl(url ?? recoveryUrl(id), id),
      options,
    );
    if (!body.video || typeof body.video.url !== 'string')
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    return { video: { url: mediaUrl(body.video.url) } };
  }
  async download(url: any, options: any = {}) {
    return this.#request(mediaUrl(url), { ...options, binary: true });
  }
  async #request(
    url: any,
    { signal, method = 'GET', parameters, binary = false }: any = {},
  ) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetch(url, {
        method,
        signal: combined,
        redirect: 'error',
        headers: binary
          ? {}
          : {
              authorization: `Key ${this.apiKey}`,
              'content-type': 'application/json',
              ...(method === 'POST'
                ? {
                    'X-Fal-No-Retry': '1',
                    'x-app-fal-disable-fallback': '1',
                  }
                : {}),
            },
        ...(parameters ? { body: JSON.stringify(parameters) } : {}),
      });
      if (!response?.ok) throw falFailure('PROVIDER_HTTP_FAILED');
      const type = response.headers?.get('content-type') ?? '';
      if (
        !(binary ? /^video\/mp4(?:;|$)/i : /^application\/json(?:;|$)/i).test(
          type,
        )
      )
        throw falFailure('PROVIDER_INVALID_RESPONSE');
      const chunks = [];
      let size = 0;
      if (!response.body) throw falFailure('PROVIDER_INVALID_RESPONSE');
      for await (const chunk of response.body) {
        if (combined.aborted) throw falFailure('PROVIDER_TIMEOUT');
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > (binary ? this.maxVideoBytes : this.maxResponseBytes))
          throw falFailure('PROVIDER_RESPONSE_TOO_LARGE');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      return binary ? bytes : JSON.parse(bytes.toString('utf8'));
    } catch (caught: any) {
      if (caught?.code?.startsWith('PROVIDER_')) throw caught;
      throw falFailure(
        combined.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_CONNECTION_FAILED',
      );
    }
  }
}
// Official fal-js queue.ts: status/result use owner/alias, without the model subpath.
// https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts
function recoveryUrl(id: any, operation: any = '') {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{3,120}$/.test(id))
    throw falFailure('PROVIDER_INVALID_REQUEST_ID');
  return `https://queue.fal.run/minimax/h3-max-turbo/requests/${id}${operation ? `/${operation}` : ''}`;
}
function queueUrl(value: any, id: any) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{3,120}$/.test(id))
    throw falFailure('PROVIDER_INVALID_REQUEST_ID');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw falFailure('PROVIDER_INVALID_QUEUE_URL');
  }
  if (
    url.origin !== 'https://queue.fal.run' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !new RegExp(
      `^/minimax/h3-max-turbo(?:/image-to-video)?/requests/${id}(?:/status|/response)?$`,
    ).test(url.pathname)
  )
    throw falFailure('PROVIDER_INVALID_QUEUE_URL');
  return url.href;
}
function mediaUrl(value: any) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw falFailure('PROVIDER_INVALID_MEDIA_URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))
  )
    throw falFailure('PROVIDER_INVALID_MEDIA_URL');
  return url.href;
}
