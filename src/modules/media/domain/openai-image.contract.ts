import { adaptationHash } from './media-hash.js';
import { validateMediaAcquisitionRequest } from './media-acquisition-contracts.js';
import type { AcquisitionRequest } from './media.types.js';
// Profile checked against official Images API documentation on 2026-11-12:
// https://developers.openai.com/api/reference/resources/images/methods/generate
// https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
// No account availability, billing authority or physical generation is inferred.
export const OPENAI_IMAGE_PROFILE = Object.freeze({
  model: 'gpt-image-2.5-flare-2026-09-08',
  quality: 'medium',
  size: '864x1536',
  format: 'png',
  n: 1,
} as const);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export interface ImageReference {
  role: 'PRODUCT' | 'INFLUENCER';
  artifactId: string;
  contentHash: string;
  revision: number;
  provenance: { evidenceId: string; sourceRef: string };
  commercialPurpose: 'ADVERTISING';
  externalProcessing: { provider: 'openai'; evidenceId: string };
}
export interface OpenAIImageRequest {
  schemaVersion: 'openai-image-request/1.0.0';
  operationId: string;
  projectId: string;
  projectVersion: number;
  pipelineRunId: string;
  scriptId: string;
  scriptContentHash: string;
  scriptRevision: number;
  acquisitionRequest: AcquisitionRequest;
  operationType: 'GENERATE' | 'EDIT';
  prompt: string;
  profile: typeof OPENAI_IMAGE_PROFILE;
  references: ImageReference[];
  requestHash: string;
}
export interface ImageUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: { text_tokens: number; image_tokens: number };
  output_tokens_details?: { text_tokens: number; image_tokens: number };
}
export function imageFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
export function object(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    imageFail('IMAGE_CONTRACT_INVALID');
}
export function exact(
  value: unknown,
  keys: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  object(value);
  if (
    keys.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some((k) => ![...keys, ...optional].includes(k))
  )
    imageFail('IMAGE_CONTRACT_INVALID');
}
export function imageId(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    imageFail('IMAGE_ID_INVALID');
}
export function imageHash(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    imageFail('IMAGE_HASH_INVALID');
}
export function integer(value: unknown, min = 1) {
  if (!Number.isSafeInteger(value) || (value as number) < min)
    imageFail('IMAGE_NUMBER_INVALID');
}
export function imageRequestHash(value: unknown): string {
  object(value);
  const { requestHash: _hash, ...rest } = value;
  return adaptationHash(rest);
}
export function validateImageRequest(raw: unknown): OpenAIImageRequest {
  exact(raw, [
    'schemaVersion',
    'operationId',
    'projectId',
    'projectVersion',
    'pipelineRunId',
    'scriptId',
    'scriptContentHash',
    'scriptRevision',
    'acquisitionRequest',
    'operationType',
    'prompt',
    'profile',
    'references',
    'requestHash',
  ]);
  const v = raw as unknown as OpenAIImageRequest;
  if (v.schemaVersion !== 'openai-image-request/1.0.0')
    imageFail('IMAGE_SCHEMA_UNSUPPORTED');
  for (const id of [v.operationId, v.projectId, v.pipelineRunId, v.scriptId])
    imageId(id);
  integer(v.projectVersion);
  integer(v.scriptRevision);
  imageHash(v.scriptContentHash);
  imageHash(v.requestHash);
  exact(v.profile, Object.keys(OPENAI_IMAGE_PROFILE));
  if (adaptationHash(v.profile) !== adaptationHash(OPENAI_IMAGE_PROFILE))
    imageFail('IMAGE_PROFILE_UNSUPPORTED');
  if (
    !['GENERATE', 'EDIT'].includes(v.operationType) ||
    typeof v.prompt !== 'string' ||
    !v.prompt.trim() ||
    v.prompt.length > 32000 ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i.test(v.prompt)
  )
    imageFail('IMAGE_REQUEST_INVALID');
  const a = validateMediaAcquisitionRequest(v.acquisitionRequest);
  if (
    a.assetType !== 'IMAGE' ||
    a.scriptId !== v.scriptId ||
    a.scriptContentHash !== v.scriptContentHash
  )
    imageFail('IMAGE_ACQUISITION_MISMATCH');
  if (
    !Array.isArray(v.references) ||
    v.references.length > 2 ||
    (v.operationType === 'GENERATE'
      ? v.references.length !== 0
      : v.references.length === 0)
  )
    imageFail('IMAGE_REFERENCES_INVALID');
  const roles = new Set<string>();
  const ids = new Set<string>();
  for (const r of v.references) {
    exact(r, [
      'role',
      'artifactId',
      'contentHash',
      'revision',
      'provenance',
      'commercialPurpose',
      'externalProcessing',
    ]);
    imageId(r.artifactId);
    imageHash(r.contentHash);
    integer(r.revision);
    exact(r.provenance, ['evidenceId', 'sourceRef']);
    imageId(r.provenance.evidenceId);
    imageId(r.provenance.sourceRef);
    exact(r.externalProcessing, ['provider', 'evidenceId']);
    if (
      !['PRODUCT', 'INFLUENCER'].includes(r.role) ||
      roles.has(r.role) ||
      ids.has(r.artifactId) ||
      r.commercialPurpose !== 'ADVERTISING' ||
      r.externalProcessing.provider !== 'openai' ||
      r.externalProcessing.evidenceId !== r.provenance.evidenceId
    )
      imageFail('IMAGE_REFERENCES_INVALID');
    roles.add(r.role);
    ids.add(r.artifactId);
  }
  if (imageRequestHash(v) !== v.requestHash)
    imageFail('IMAGE_REQUEST_HASH_MISMATCH');
  return freezeImageData(structuredClone(v));
}
export function freezeImageData<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeImageData);
    Object.freeze(value);
  }
  return value;
}
export function validateUsage(raw: unknown): ImageUsage {
  exact(
    raw,
    ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details'],
    ['output_tokens_details'],
  );
  const v = raw as unknown as ImageUsage;
  for (const x of [v.input_tokens, v.output_tokens, v.total_tokens])
    integer(x, 0);
  exact(v.input_tokens_details, ['text_tokens', 'image_tokens']);
  for (const x of Object.values(v.input_tokens_details)) integer(x, 0);
  if (
    v.input_tokens_details.text_tokens + v.input_tokens_details.image_tokens !==
      v.input_tokens ||
    v.input_tokens + v.output_tokens !== v.total_tokens
  )
    imageFail('IMAGE_USAGE_INVALID');
  if (v.output_tokens_details !== undefined) {
    exact(v.output_tokens_details, ['text_tokens', 'image_tokens']);
    for (const x of Object.values(v.output_tokens_details)) integer(x, 0);
    if (
      v.output_tokens_details.text_tokens +
        v.output_tokens_details.image_tokens !==
      v.output_tokens
    )
      imageFail('IMAGE_USAGE_INVALID');
  }
  return structuredClone(v);
}
export function traceId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(raw) ||
    /^(?:sk-|bearer)/i.test(raw)
  )
    imageFail('IMAGE_TRACE_INVALID');
  return raw;
}
