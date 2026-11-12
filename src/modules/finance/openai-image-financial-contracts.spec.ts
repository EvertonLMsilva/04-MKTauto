import { describe, it, expect } from 'vitest';
import {
  imageFinancialRequestHash,
  validateImageFinancialRequest,
} from './domain/openai-image-financial-contracts.js';
const body = () => ({
  schemaVersion: 'openai-image-financial-request/1.0.0' as const,
  operationId: 'image_001',
  projectId: 'project_001',
  projectVersion: 1,
  campaign: null,
  pipelineRunId: null,
  model: 'gpt-image-fixture',
  modelVersion: 'fixture-2026-11',
  quality: 'high',
  resolution: { width: 1024, height: 1024 },
  operationType: 'GENERATE' as const,
  billingMode: 'IMAGES_STANDARD_UNCACHED_NON_STREAMING' as const,
  imageCount: 1,
  referenceHashes: [] as string[],
  payloadHash: 'a'.repeat(64),
  tokensPerImage: { textInput: '100', imageInput: '0', imageOutput: '1000' },
  proposedMaximumUsd: '0.1',
  tariff: {
    model: 'gpt-image-fixture',
    modelVersion: 'fixture-2026-11',
    quality: 'high',
    resolution: { width: 1024, height: 1024 },
    operationType: 'GENERATE' as const,
    billingMode: 'IMAGES_STANDARD_UNCACHED_NON_STREAMING' as const,
    reference: 'https://developers.openai.com/api/docs/pricing',
    tariffDate: '2026-11-12T00:00:00Z',
    validUntil: '2026-11-13T00:00:00Z',
    textInputUsdPerMillion: '2',
    imageInputUsdPerMillion: '3',
    imageOutputUsdPerMillion: '10',
  },
});
const request = () => {
  const b = body();
  return { ...b, requestHash: imageFinancialRequestHash(b) };
};
describe('OpenAI image financial request contract', () => {
  it('binds financial identity, supports stable key order and freezes the validated request', () => {
    const r = request(),
      v = validateImageFinancialRequest(r);
    expect(v).toEqual(r);
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.tokensPerImage)).toBe(true);
    expect(
      imageFinancialRequestHash(
        Object.fromEntries(Object.entries(body()).reverse()) as ReturnType<
          typeof body
        >,
      ),
    ).toBe(r.requestHash);
  });
  it.each([
    'scope',
    'model',
    'quality',
    'resolution',
    'references',
    'payload',
    'price',
    'maximum',
    'count',
  ])('binds %s to the hash', (kind) => {
    const r = request();
    if (kind === 'scope') r.projectId = 'other';
    if (kind === 'model') r.modelVersion = 'other';
    if (kind === 'quality') r.quality = 'medium';
    if (kind === 'resolution') r.resolution.width = 1536;
    if (kind === 'references') r.referenceHashes = ['b'.repeat(64)];
    if (kind === 'payload') r.payloadHash = 'b'.repeat(64);
    if (kind === 'price') r.tariff.imageOutputUsdPerMillion = '11';
    if (kind === 'maximum') r.proposedMaximumUsd = '0.2';
    if (kind === 'count') r.imageCount = 120;
    expect(() => validateImageFinancialRequest(r)).toThrow(/IMAGE_FINANCIAL_/);
  });
  it.each([
    'extra',
    'fractional_count',
    'number_money',
    'exponent',
    'negative',
    'token_number',
    'token_fraction',
    'bad_hash',
    'bad_campaign',
    'duplicate_references',
    'edit_without_reference',
    'generate_with_reference',
    'unofficial_price',
    'invalid_date',
  ])('rejects %s without coercion', (kind) => {
    const r: any = request();
    if (kind === 'extra') r.executionAllowed = true;
    if (kind === 'fractional_count') r.imageCount = 1.5;
    if (kind === 'number_money') r.proposedMaximumUsd = 0.1;
    if (kind === 'exponent') r.proposedMaximumUsd = '1e-3';
    if (kind === 'negative') r.tokensPerImage.textInput = '-1';
    if (kind === 'token_number') r.tokensPerImage.textInput = 100;
    if (kind === 'token_fraction') r.tokensPerImage.textInput = '0.1';
    if (kind === 'bad_hash') r.payloadHash = 'bad';
    if (kind === 'bad_campaign') r.campaign = { campaignId: 'c', revision: 0 };
    if (kind === 'duplicate_references')
      r.referenceHashes = ['b'.repeat(64), 'b'.repeat(64)];
    if (kind === 'edit_without_reference') r.operationType = 'EDIT';
    if (kind === 'generate_with_reference')
      r.referenceHashes = ['b'.repeat(64)];
    if (kind === 'unofficial_price')
      r.tariff.reference = 'https://example.com/price';
    if (kind === 'invalid_date') r.tariff.validUntil = 'invalid';
    expect(() => validateImageFinancialRequest(r)).toThrow(/IMAGE_FINANCIAL_/);
  });
  it('accepts an edit with multiple hashes and explicitly unknown token quantities or rates', () => {
    const b: any = body();
    b.operationType = 'EDIT';
    b.tariff.operationType = 'EDIT';
    b.referenceHashes = ['b'.repeat(64), 'c'.repeat(64)];
    b.tokensPerImage.imageInput = null;
    b.tariff.imageInputUsdPerMillion = null;
    expect(
      validateImageFinancialRequest({
        ...b,
        requestHash: imageFinancialRequestHash(b),
      }).tokensPerImage.imageInput,
    ).toBeNull();
  });
});
