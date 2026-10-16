export interface MediaIdentity {
  readonly reference: string;
  readonly contentHash: string;
  readonly format: 'CANONICAL' | 'LEGACY_LTX_VIDEO';
}
/** Parse identity without rewriting the reference or claiming the bytes exist. */
export function parseMediaIdentity(
  reference: unknown,
  options: { expectedHash?: unknown; allowLegacy?: boolean } = {},
): MediaIdentity {
  const match =
    typeof reference === 'string'
      ? /^(media:sha256_|object:ltx-video\/sha256\/)([a-f0-9]{64})$/.exec(
          reference,
        )
      : null;
  // JS $ also matches before a final newline; require the complete input.
  if (
    !match ||
    match[0] !== reference ||
    (match[1] !== 'media:sha256_' && options.allowLegacy !== true) ||
    (Object.hasOwn(options, 'expectedHash') &&
      options.expectedHash !== match[2])
  )
    throw Object.assign(new Error('MEDIA_IDENTITY_INVALID'), {
      code: 'MEDIA_IDENTITY_INVALID',
      field: 'mediaReference',
    });
  return Object.freeze({
    reference: reference as string,
    contentHash: match[2],
    format: match[1] === 'media:sha256_' ? 'CANONICAL' : 'LEGACY_LTX_VIDEO',
  });
}
export function canonicalMediaReference(contentHash: unknown): string {
  if (typeof contentHash !== 'string')
    throw Object.assign(new Error('MEDIA_IDENTITY_INVALID'), {
      code: 'MEDIA_IDENTITY_INVALID',
      field: 'contentHash',
    });
  return parseMediaIdentity(`media:sha256_${contentHash}`, {
    expectedHash: contentHash,
  }).reference;
}
/** Reserved CAS namespace on new writes; unrelated opaque references stay untouched. */
export function assertNewPhysicalMediaIdentity(
  reference: string,
  contentHash: string,
): void {
  if (reference.startsWith('media:sha256_'))
    parseMediaIdentity(reference, { expectedHash: contentHash });
}
