import { inspectMvpPng } from './physical-media-inspection.js';
import { digest } from './local-evidence-storage.js';
import {
  exact,
  imageFail,
  integer,
  MAX_IMAGE_BYTES,
  traceId,
  validateImageRequest,
  validateUsage,
  type OpenAIImageRequest,
} from '../domain/openai-image.contract.js';
import type {
  OfflineImageTransport,
  ParsedImageOutput,
  ImageFinancialOperations,
} from '../application/image-generation.port.js';
/** Protocol mapping/parser only. No authenticated HTTP client.
 * generate maps to POST /v1/images/generations; edit to POST /v1/images/edits.
 * Dispatch requires the same Finance-owned SUBMITTING operation. Request IDs
 * are trace references, never remote recovery or idempotency guarantees.
 */
export class OpenAIImageAdapter {
  constructor(
    private readonly transport?: OfflineImageTransport,
    private readonly operations?: Pick<ImageFinancialOperations, 'find'>,
  ) {}
  assertOffline() {
    if (
      !this.transport ||
      this.transport.mode !== 'FAKE_ONLY' ||
      this.transport.operational !== false
    )
      imageFail('LIVE_IMAGE_TRANSPORT_DISABLED');
  }
  prepare(
    raw: unknown,
    references: readonly Buffer[] = [],
  ): Readonly<Record<string, unknown>> {
    const r = validateImageRequest(raw);
    if (references.length !== r.references.length)
      imageFail('IMAGE_REFERENCE_BYTES_MISSING');
    for (const [i, bytes] of references.entries())
      if (
        bytes.length > MAX_IMAGE_BYTES ||
        digest(bytes) !== r.references[i].contentHash
      )
        imageFail('IMAGE_REFERENCE_HASH_MISMATCH');
    return Object.freeze({
      model: r.profile.model,
      prompt: r.prompt,
      n: r.profile.n,
      size: r.profile.size,
      quality: r.profile.quality,
      output_format: r.profile.format,
      stream: false,
      ...(r.operationType === 'EDIT'
        ? {
            images: references.map((b) => ({
              image_url: 'data:image/png;base64,' + b.toString('base64'),
            })),
          }
        : {}),
    });
  }
  async execute(
    request: OpenAIImageRequest,
    references: readonly Buffer[],
  ): Promise<ParsedImageOutput> {
    this.assertOffline();
    if (!this.operations) imageFail('FINANCE_NOT_CONFIGURED');
    let operation;
    try {
      operation = await this.operations.find(request.operationId);
    } catch {
      imageFail('FINANCIAL_OPERATION_UNCERTAIN');
    }
    if (
      !operation ||
      operation.operationId !== request.operationId ||
      operation.requestHash !== request.requestHash ||
      operation.state !== 'SUBMITTING' ||
      operation.receiptHash !== null
    )
      imageFail('RESERVATION_REQUIRED');
    const body = this.prepare(request, references);
    let response;
    try {
      response = await (request.operationType === 'GENERATE'
        ? this.transport!.generate(body)
        : this.transport!.edit(body));
    } catch {
      imageFail('IMAGE_TRANSPORT_UNCERTAIN');
    }
    if (
      !response ||
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599
    )
      imageFail('IMAGE_RESPONSE_INVALID');
    if (response.status !== 200) {
      const failure = parseImageFailure(
        response.status,
        response.body,
        response.requestId,
      );
      throw Object.assign(new Error(failure.code), failure);
    }
    return parseImageResponse(response.body, response.requestId);
  }
}
export function parseImageResponse(
  raw: unknown,
  requestId?: unknown,
): ParsedImageOutput {
  try {
    exact(
      raw,
      ['created', 'data'],
      [
        'usage',
        'size',
        'quality',
        'output_format',
        'background',
        'safety_identifier',
      ],
    );
    integer(raw.created, 0);
    if (
      (raw.size !== undefined && raw.size !== '864x1536') ||
      (raw.quality !== undefined && raw.quality !== 'medium') ||
      (raw.output_format !== undefined && raw.output_format !== 'png') ||
      (raw.background !== undefined &&
        !['opaque', 'transparent'].includes(raw.background as string))
    )
      imageFail('IMAGE_RESPONSE_INVALID');
    if (
      raw.safety_identifier !== undefined &&
      (typeof raw.safety_identifier !== 'string' ||
        raw.safety_identifier.length > 128)
    )
      imageFail('IMAGE_RESPONSE_INVALID');
    if (!Array.isArray(raw.data) || raw.data.length !== 1)
      imageFail('IMAGE_RESPONSE_INVALID');
    exact(raw.data[0], ['b64_json']);
    const b = raw.data[0].b64_json;
    if (
      typeof b !== 'string' ||
      !b.length ||
      b.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        b,
      )
    )
      imageFail('IMAGE_RESPONSE_INVALID');
    const bytes = Buffer.from(b, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== b)
      imageFail('IMAGE_RESPONSE_INVALID');
    const facts = inspectMvpPng(bytes, {
      widthPixels: 864,
      heightPixels: 1536,
    });
    return {
      bytes,
      contentHash: digest(bytes),
      widthPixels: facts.widthPixels,
      heightPixels: facts.heightPixels,
      byteLength: bytes.length,
      usage: raw.usage === undefined ? null : validateUsage(raw.usage),
      requestId: traceId(requestId),
      providerCreated: raw.created as number,
    };
  } catch {
    imageFail('IMAGE_RESPONSE_INVALID');
  }
}

/** Failure descriptions are never returned, even for well-formed provider errors. */
export function parseImageFailure(
  status: number,
  raw: unknown,
  requestId?: unknown,
): { code: string; requestId: string | null } {
  let id: string | null = null;
  try {
    id = traceId(requestId);
  } catch {
    /* Untrusted trace is discarded. */
  }
  let code = 'IMAGE_PROVIDER_ERROR_UNPARSEABLE';
  try {
    exact(raw, ['error']);
    exact(
      raw.error,
      ['message'],
      ['type', 'code', 'param', 'moderation_details'],
    );
    if (
      typeof raw.error.message !== 'string' ||
      raw.error.message.length > 32000
    )
      imageFail('IMAGE_RESPONSE_INVALID');
    for (const key of ['type', 'code', 'param'])
      if (
        raw.error[key] !== undefined &&
        raw.error[key] !== null &&
        (typeof raw.error[key] !== 'string' || raw.error[key].length > 200)
      )
        imageFail('IMAGE_RESPONSE_INVALID');
    if (raw.error.moderation_details !== undefined) {
      exact(raw.error.moderation_details, ['moderation_stage', 'categories']);
      if (
        typeof raw.error.moderation_details.moderation_stage !== 'string' ||
        !Array.isArray(raw.error.moderation_details.categories) ||
        raw.error.moderation_details.categories.length > 100 ||
        raw.error.moderation_details.categories.some(
          (x) => typeof x !== 'string' || x.length > 100,
        )
      )
        imageFail('IMAGE_RESPONSE_INVALID');
    }
    code =
      raw.error.code === 'moderation_blocked'
        ? 'IMAGE_MODERATION_BLOCKED'
        : raw.error.code === 'insufficient_quota'
          ? 'IMAGE_QUOTA_EXCEEDED'
          : status === 429
            ? 'IMAGE_QUOTA_OR_RATE_LIMIT'
            : status === 401 || status === 403
              ? 'IMAGE_PROVIDER_ACCESS_DENIED'
              : 'IMAGE_PROVIDER_REJECTED';
  } catch {
    /* Unknown failure also remains uncertain and non-retryable. */
  }
  return { code, requestId: id };
}
