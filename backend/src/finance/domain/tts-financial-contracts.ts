import { createHash } from 'node:crypto';
import {
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';

// Legacy requests retain their wire values and denial policy.
export const TTS_RISK_POLICY = 'tts-risk-reservation/2.0.0';
export function isTtsRiskRequest(request: any): boolean {
  return (
    request?.schemaVersion === 'tts-operation/2.0.0' &&
    request.financialPolicy?.schemaVersion === TTS_RISK_POLICY
  );
}
export function ttsFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
export function ttsHash(value: unknown): string {
  const stable = (item: any): string =>
    JSON.stringify(
      item && typeof item === 'object'
        ? Array.isArray(item)
          ? item.map((v) => JSON.parse(stable(v)))
          : Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, JSON.parse(stable(item[key]))]),
            )
        : item,
    );
  return createHash('sha256').update(stable(value)).digest('hex');
}
const hash = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const voices = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];
const capabilities: Record<
  string,
  { languages: string[]; voices: string[]; styles: string[] }
> = {
  openai: {
    languages: ['pt-BR'],
    voices,
    styles: ['informative', 'calm', 'energetic'],
  },
  fake_voice: {
    languages: ['pt-BR'],
    voices: ['fixture_ptbr', 'fixture_alternate'],
    styles: ['informative', 'calm'],
  },
};
function audioConfig(input: any): any {
  const value = { language: 'pt-BR', ...input };
  const keys = [
    'schemaVersion',
    'campaignId',
    'revision',
    'language',
    'provider',
    'voice',
    'style',
    'mode',
    'originalGainDb',
    'narrationGainDb',
  ];
  if (Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Object.assign(new Error('P4_INVALID_CONTRACT: contract'), {
      code: 'P4_INVALID_CONTRACT',
      field: 'contract',
    });
  const c = capabilities[value.provider];
  if (
    value.schemaVersion !== 'campaign-audio/1.0.0' ||
    typeof value.campaignId !== 'string' ||
    !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value.campaignId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !c?.languages.includes(value.language) ||
    !c.voices.includes(value.voice) ||
    !c.styles.includes(value.style) ||
    !['PRESERVE', 'REPLACE', 'MIX'].includes(value.mode) ||
    ![value.originalGainDb, value.narrationGainDb].every(
      (v) => Number.isFinite(v) && v >= -60 && v <= 12,
    )
  )
    throw Object.assign(new Error('P4_AUDIO_CONFIG_INVALID: contract'), {
      code: 'P4_AUDIO_CONFIG_INVALID',
      field: 'contract',
    });
  return immutable(value);
}
export function ttsRequest(plan: any): any {
  const op = plan?.operation,
    config = audioConfig(plan?.audioConfiguration?.config),
    provider = plan?.providerConfiguration;
  if (
    !op ||
    ttsHash(op) !== plan.operationHash ||
    !op.narration?.trim() ||
    op.narration.length > 4096 ||
    op.maxDurationMilliseconds !== 10000 ||
    op.audioConfigId !== plan.audioConfiguration.id ||
    plan.audioConfiguration.contentHash !== ttsHash(config) ||
    op.audioConfigId !== `audio_config:${ttsHash(config)}` ||
    config.provider !== 'openai' ||
    config.language !== 'pt-BR' ||
    config.voice !== 'marin' ||
    config.style !== 'informative' ||
    config.mode === 'PRESERVE' ||
    provider?.model !== 'gpt-4o-mini-tts' ||
    provider.voice !== 'marin' ||
    provider.audioFormat !== 'wav' ||
    provider.policyVersion !== 'openai-voice-policy/2.0.0' ||
    ttsHash({ provider: 'openai', ...provider }) !==
      plan.providerConfigurationHash ||
    plan.estimatedCost?.currency !== 'USD' ||
    String(plan.estimatedCost.amount) !== '0.00306' ||
    String(plan.estimatedCost.proposedInternalAllowanceUsd) !== '0.01' ||
    plan.estimatedCost.guaranteedMaximum !== false ||
    plan.source?.generationRequestId !== op.sourceId ||
    !hash(plan.source.requestHash) ||
    !hash(plan.source.sourceContentHash)
  )
    ttsFail('TTS_INVALID_PLAN');
  for (const key of ['sourceId', 'pipelineRunId'])
    affiliateIdentifier(op[key], key);
  affiliateIdentifier(plan.operationId, 'operationId');
  const risk = plan.financialPolicy;
  if (risk !== undefined) {
    if (
      !risk ||
      Object.keys(risk).sort().join(',') !==
        'schemaVersion,scriptContentHash,scriptId' ||
      risk.schemaVersion !== TTS_RISK_POLICY ||
      !hash(risk.scriptContentHash)
    )
      ttsFail('TTS_INVALID_POLICY');
    affiliateIdentifier(risk.scriptId, 'scriptId');
  }
  return immutable({
    schemaVersion: risk ? 'tts-operation/2.0.0' : 'tts-operation/1.0.0',
    ...(risk ? { financialPolicy: risk } : {}),
    operationId: plan.operationId,
    campaignId: config.campaignId,
    operation: op,
    source: plan.source,
    providerConfigurationHash: plan.providerConfigurationHash,
    model: provider.model,
    language: config.language,
    voice: config.voice,
    style: config.style,
    narrationHash: ttsHash(op.narration),
    audioConfigurationHash: ttsHash(config),
    estimatedUsd: '0.00306',
    reservationUsd: '0.01',
    costBasis: 'PLANNING_ESTIMATE',
    guaranteedMaximum: false,
  });
}
export interface TtsApproval {
  acceptsUnboundedCost: true;
  approvalReference: string;
  approvedAt: string;
  approvedBy: string;
  requestHash: string;
  policyVersion?: string;
  expiresAt?: string;
}
export function ttsApproval(request: unknown, value: any): TtsApproval {
  const risk = isTtsRiskRequest(request);
  const fields = [
    'acceptsUnboundedCost',
    'approvalReference',
    'approvedAt',
    'approvedBy',
    'requestHash',
    ...(risk ? ['expiresAt', 'policyVersion'] : []),
  ]
    .sort()
    .join(',');
  if (
    !value ||
    Object.keys(value).sort().join(',') !== fields ||
    value.requestHash !== ttsHash(request) ||
    value.acceptsUnboundedCost !== true ||
    typeof value.approvedBy !== 'string' ||
    !value.approvedBy.trim() ||
    typeof value.approvalReference !== 'string' ||
    !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(value.approvalReference) ||
    typeof value.approvedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.approvedAt)) ||
    (risk &&
      (value.policyVersion !== TTS_RISK_POLICY ||
        typeof value.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.parse(value.approvedAt)))
  )
    ttsFail('TTS_APPROVAL_INVALID');
  return immutable(value);
}
export interface TtsBilling {
  actualCostUsd: string;
  evidenceReference: string;
}
export interface TtsAudio {
  durationMilliseconds: number;
  audioFormat: string;
  contentHash: string;
  storageReference: string;
  provider: string;
  origin: string;
  rights: { usageBasis: string; commercialUseAllowed: boolean };
}
export interface TtsResult {
  audio: TtsAudio;
  billing?: TtsBilling | null;
  providerRequestId?: string | null;
}
export interface TtsFinancialOperation {
  request: any;
  requestHash: string;
  state: 'SUBMITTING' | 'UNKNOWN' | 'COMPLETED' | 'REVIEW_REQUIRED';
  createdAt: string;
  audio: TtsAudio | null;
  billing: TtsBilling | null;
  reconciliationReference: string | null;
  providerRequestId: string | null;
  errorCode: string | null;
}
// Same metadata contract as validateVoiceProviderOutput; no media bytes or TTS are accessed.
export function ttsAudio(value: TtsAudio): TtsAudio {
  const fail = (code: string, field: string): never => {
    throw new ContractValidationError(code, field, 'valor inválido');
  };
  const exact = (item: any, fields: string[], field: string) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      fail('INVALID_TYPE', field);
    for (const key of Object.keys(item))
      if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${field}.${key}`);
    for (const key of fields)
      if (!(key in item)) fail('REQUIRED_FIELD', `${field}.${key}`);
  };
  exact(
    value,
    [
      'durationMilliseconds',
      'audioFormat',
      'contentHash',
      'storageReference',
      'provider',
      'origin',
      'rights',
    ],
    'output',
  );
  if (
    !Number.isSafeInteger(value.durationMilliseconds) ||
    value.durationMilliseconds < 1
  )
    fail('INVALID_DURATION', 'durationMilliseconds');
  if (!['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(value.audioFormat))
    fail('INVALID_AUDIO_FORMAT', 'audioFormat');
  if (!hash(value.contentHash)) fail('INVALID_HASH', 'contentHash');
  const reference = value.storageReference;
  if (
    typeof reference !== 'string' ||
    reference.length < 3 ||
    reference.length > 300 ||
    !/^[a-z0-9][a-z0-9._:/-]+$/.test(reference) ||
    reference.includes('..') ||
    reference.startsWith('/') ||
    /^[a-z]:\//i.test(reference) ||
    /^(?:https?|file):/i.test(reference) ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=)/i.test(
      reference,
    ) ||
    /(?:^|[/:._-])(?:token|secret|credential|password|signature|api.?key)(?:[/:._-]|$)/i.test(
      reference,
    )
  )
    fail('INVALID_STORAGE_REFERENCE', 'storageReference');
  if (
    typeof value.provider !== 'string' ||
    value.provider.length > 100 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value.provider)
  )
    fail('INVALID_IDENTIFIER', 'provider');
  if (value.origin !== 'SYNTHETIC_TTS') fail('INVALID_VOICE_ORIGIN', 'origin');
  exact(value.rights, ['usageBasis', 'commercialUseAllowed'], 'rights');
  if (
    !['OWNED', 'LICENSED', 'PROVIDER_TERMS'].includes(value.rights.usageBasis)
  )
    fail('INVALID_USAGE_BASIS', 'rights.usageBasis');
  if (value.rights.commercialUseAllowed !== true)
    fail('COMMERCIAL_USE_REQUIRED', 'rights.commercialUseAllowed');
  return immutable(value);
}
