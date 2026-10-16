import {
  ttsFail,
  ttsHash,
  ttsRequest,
} from '../../finance/domain/tts-financial-contracts.js';

// Preparation preserves the historical wire contract. It grants no execution.
export function prepareNarration(plan: unknown) {
  const request = ttsRequest(plan);
  return { request, requestHash: ttsHash(request) };
}

export function narrationEnvelope(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    ttsFail('TTS_PREPARATION_INVALID');
  return value as Record<string, unknown>;
}

export function narrationEvidence(value: unknown): string {
  const { evidenceReference } = narrationEnvelope(value, ['evidenceReference']);
  if (typeof evidenceReference !== 'string' || !evidenceReference.trim())
    ttsFail('TTS_RECONCILIATION_REQUIRED');
  return evidenceReference;
}
