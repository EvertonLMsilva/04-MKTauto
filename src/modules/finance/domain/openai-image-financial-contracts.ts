import { createHash } from 'node:crypto';
import { usdUnits } from './video-financial-contracts.js';
import type { FinanceReadiness, CampaignUsage } from './finance.types.js';
export interface ImageFinancialScope {
  projectId: string;
  projectVersion: number;
  campaign: { campaignId: string; revision: number } | null;
  pipelineRunId: string | null;
}
export interface ImageFinancialProfile {
  model: string;
  modelVersion: string;
  quality: string;
  resolution: { width: number; height: number };
  operationType: 'GENERATE' | 'EDIT';
  billingMode: 'IMAGES_STANDARD_UNCACHED_NON_STREAMING';
}
export interface ImagePublishedTariff extends ImageFinancialProfile {
  reference: string;
  tariffDate: string;
  validUntil: string;
  textInputUsdPerMillion: string | null;
  imageInputUsdPerMillion: string | null;
  imageOutputUsdPerMillion: string | null;
}
export interface OpenAIImageFinancialRequest
  extends ImageFinancialScope, ImageFinancialProfile {
  schemaVersion: 'openai-image-financial-request/1.0.0';
  operationId: string;
  imageCount: number;
  referenceHashes: string[];
  // Hash of the entire future image payload, including prompt, masks and all settings.
  payloadHash: string;
  tokensPerImage: {
    textInput: string | null;
    imageInput: string | null;
    imageOutput: string | null;
  };
  proposedMaximumUsd: string;
  tariff: ImagePublishedTariff | null;
  requestHash: string;
}
export interface OpenAIImageFinancialPreflightResult {
  schemaVersion: 'openai-image-financial-preflight/1.0.0';
  operationId: string;
  requestHash: string;
  evaluatedAt: string;
  estimationBasis: 'PROVIDED_PER_IMAGE_TOKEN_ESTIMATES';
  imageCount: number;
  estimateStatus: 'ESTIMATE_DOCUMENTED' | 'ESTIMATE_PARTIAL' | 'COST_UNKNOWN';
  statuses: string[];
  textInputCostUsd: string | null;
  imageInputCostUsd: string | null;
  outputImageCostUsd: string | null;
  totalEstimatedUsd: string | null;
  proposedMaximumUsd: string;
  authorizedCeilingUsd: null;
  requiredBudgetUsd: string;
  budgetStatus:
    'AVAILABLE_FOR_PROPOSED_MAXIMUM' | 'INSUFFICIENT' | 'UNVERIFIED';
  availableBudget: {
    dailyUsd: string;
    monthlyUsd: string;
    campaignUsd: string | null;
  } | null;
  budgetEvidence: {
    global: FinanceReadiness;
    campaign: CampaignUsage | null;
  } | null;
  recoveryStatus:
    | 'NEW'
    | 'NOT_SENT'
    | 'RESERVED'
    | 'UNCERTAIN'
    | 'RECONCILED'
    | 'IDENTITY_CONFLICT';
  observedCostUsd: string | null;
  missingEvidence: string[];
  blockers: string[];
  executionAllowed: false;
  reservationPerformed: false;
}
export function imageFinancialFail(field: string): never {
  throw Object.assign(new Error(`IMAGE_FINANCIAL_CONTRACT_INVALID: ${field}`), {
    code: 'IMAGE_FINANCIAL_CONTRACT_INVALID',
    field,
  });
}
function record(
  value: unknown,
  fields: string[],
  field: string,
): Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k)) ||
    fields.some((k) => !Object.hasOwn(value, k))
  )
    imageFinancialFail(field);
  return value as Record<string, any>;
}
function text(v: unknown, field: string) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(v))
    imageFinancialFail(field);
}
function hash(v: unknown, field: string) {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    imageFinancialFail(field);
}
function positive(v: unknown, field: string) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0)
    imageFinancialFail(field);
}
function money(v: unknown, field: string) {
  try {
    usdUnits(v);
  } catch {
    imageFinancialFail(field);
  }
}
export function imageFinancialTime(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    imageFinancialFail('time');
  // Date.parse otherwise accepts impossible calendar days by rolling into the next month.
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
    imageFinancialFail('time');
  return Date.parse(value);
}
const profileFields = [
  'model',
  'modelVersion',
  'quality',
  'resolution',
  'operationType',
  'billingMode',
];
function profile(v: Record<string, any>) {
  for (const k of ['model', 'modelVersion', 'quality']) text(v[k], k);
  const size = record(v.resolution, ['width', 'height'], 'resolution');
  positive(size.width, 'width');
  positive(size.height, 'height');
  if (
    !['GENERATE', 'EDIT'].includes(v.operationType) ||
    v.billingMode !== 'IMAGES_STANDARD_UNCACHED_NON_STREAMING'
  )
    imageFinancialFail('profile');
}
function body(value: unknown, signed: boolean): Record<string, any> {
  const v = record(
    value,
    [
      'schemaVersion',
      'operationId',
      'projectId',
      'projectVersion',
      'campaign',
      'pipelineRunId',
      ...profileFields,
      'imageCount',
      'referenceHashes',
      'payloadHash',
      'tokensPerImage',
      'proposedMaximumUsd',
      'tariff',
      ...(signed ? ['requestHash'] : []),
    ],
    'request',
  );
  if (v.schemaVersion !== 'openai-image-financial-request/1.0.0')
    imageFinancialFail('schemaVersion');
  profile(v);
  text(v.operationId, 'operationId');
  text(v.projectId, 'projectId');
  positive(v.projectVersion, 'projectVersion');
  positive(v.imageCount, 'imageCount');
  hash(v.payloadHash, 'payloadHash');
  if (v.campaign !== null) {
    const c = record(v.campaign, ['campaignId', 'revision'], 'campaign');
    text(c.campaignId, 'campaignId');
    positive(c.revision, 'campaignRevision');
  }
  if (v.pipelineRunId !== null) text(v.pipelineRunId, 'pipelineRunId');
  if (!Array.isArray(v.referenceHashes)) imageFinancialFail('referenceHashes');
  v.referenceHashes.forEach((h: unknown) => hash(h, 'referenceHashes'));
  if (
    new Set(v.referenceHashes).size !== v.referenceHashes.length ||
    (v.operationType === 'EDIT'
      ? !v.referenceHashes.length
      : !!v.referenceHashes.length)
  )
    imageFinancialFail('referenceHashes');
  const tokens = record(
    v.tokensPerImage,
    ['textInput', 'imageInput', 'imageOutput'],
    'tokensPerImage',
  );
  for (const k of Object.keys(tokens))
    if (
      tokens[k] !== null &&
      (typeof tokens[k] !== 'string' || !/^(0|[1-9]\d{0,39})$/.test(tokens[k]))
    )
      imageFinancialFail(k);
  if (
    (!v.referenceHashes.length &&
      tokens.imageInput !== null &&
      tokens.imageInput !== '0') ||
    (v.referenceHashes.length && tokens.imageInput === '0')
  )
    imageFinancialFail('imageInputTokens');
  money(v.proposedMaximumUsd, 'proposedMaximumUsd');
  if (usdUnits(v.proposedMaximumUsd) <= 0n)
    imageFinancialFail('proposedMaximumUsd');
  if (v.tariff !== null) {
    const t = record(
      v.tariff,
      [
        ...profileFields,
        'reference',
        'tariffDate',
        'validUntil',
        'textInputUsdPerMillion',
        'imageInputUsdPerMillion',
        'imageOutputUsdPerMillion',
      ],
      'tariff',
    );
    profile(t);
    if (typeof t.reference !== 'string') imageFinancialFail('reference');
    let url: URL;
    try {
      url = new URL(t.reference);
    } catch {
      imageFinancialFail('reference');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['developers.openai.com', 'platform.openai.com', 'openai.com'].includes(
        url.hostname,
      )
    )
      imageFinancialFail('reference');
    if (imageFinancialTime(t.validUntil) <= imageFinancialTime(t.tariffDate))
      imageFinancialFail('tariffPeriod');
    for (const k of [
      'textInputUsdPerMillion',
      'imageInputUsdPerMillion',
      'imageOutputUsdPerMillion',
    ])
      if (t[k] !== null) money(t[k], k);
  }
  if (signed) hash(v.requestHash, 'requestHash');
  return v;
}
function stable(value: any): string {
  return JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((v) => JSON.parse(stable(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, JSON.parse(stable(value[k]))]),
          )
      : value,
  );
}
export function imageFinancialRequestHash(
  value: Omit<OpenAIImageFinancialRequest, 'requestHash'>,
): string {
  const validated = body(value, false);
  return createHash('sha256').update(stable(validated)).digest('hex');
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
export function validateImageFinancialRequest(
  value: unknown,
): OpenAIImageFinancialRequest {
  const v = body(value, true),
    { requestHash, ...unsigned } = v;
  if (
    createHash('sha256').update(stable(unsigned)).digest('hex') !== requestHash
  )
    throw Object.assign(new Error('IMAGE_FINANCIAL_REQUEST_HASH_MISMATCH'), {
      code: 'IMAGE_FINANCIAL_REQUEST_HASH_MISMATCH',
    });
  return freeze(JSON.parse(JSON.stringify(v)) as OpenAIImageFinancialRequest);
}
