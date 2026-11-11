import { historicalResidualPersistence } from './historical-residual-persistence.js';
import { historicalResidualContracts } from './historical-residual-contracts.js';
import { campaignFinanceFixture, time } from './finance-fixture.js';
const { registerAudioConfig } = historicalResidualPersistence(
  'p4-video-repository',
);
const { adaptationHash } = historicalResidualContracts(
  'video-adaptation-contracts',
);
const { videoRequestHash } = historicalResidualContracts(
  'video-generation-contracts',
);
const { ttsRequest } = historicalResidualContracts('tts-finance-contracts');

export function ttsFinanceFixture() {
  const f = campaignFinanceFixture();
  const config = registerAudioConfig(f.legacy, {
    schemaVersion: 'campaign-audio/1.0.0',
    campaignId: 'camp_001',
    revision: 1,
    language: 'pt-BR',
    provider: 'openai',
    voice: 'marin',
    style: 'informative',
    mode: 'REPLACE',
    originalGainDb: 0,
    narrationGainDb: 0,
  });
  const operation = {
    sourceId: 'source_001',
    pipelineRunId: 'run_001',
    audioConfigId: config.id,
    narration: 'Narração sintética de fixture.',
    maxDurationMilliseconds: 10000,
  };
  const sourceRequest = {
    schemaVersion: 'video-generation-request/1.0.0',
    generationRequestId: 'source_001',
    campaignId: 'camp_001',
    pipelineRunId: 'run_001',
    originalSlot: 1,
    provider: 'fake_video',
    purpose: 'ORIGINAL',
    outputAspectRatio: '9:16',
    prompt: 'Local fixture',
  };
  const sourceHash = videoRequestHash(sourceRequest);
  const ceiling = {
    kind: 'ENFORCED_MAXIMUM',
    currency: 'USD',
    provider: 'fake_video',
    requestHash: sourceHash,
    maximumAmount: '0.001',
    includesAllCharges: true,
    evidenceReference: 'fixture/local',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const result = {
    generationRequestId: 'source_001',
    requestHash: sourceHash,
    provider: 'fake_video',
    state: 'COMPLETED',
    providerRequestId: 'fixture_source',
    videoReference: 'object:fixture/video',
    actualCostUsd: null,
  };
  f.legacy.db
    .prepare(
      "INSERT INTO video_generation_operations VALUES (?,?,?,?,?,?,?,'COMPLETED',?,?,?,?)",
    )
    .run(
      'source_001',
      'camp_001',
      'run_001',
      1,
      sourceHash,
      JSON.stringify(sourceRequest),
      JSON.stringify(ceiling),
      'fixture',
      time,
      JSON.stringify(result),
      'fixture_cost',
    );
  const providerConfiguration = {
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    policyVersion: 'openai-voice-policy/2.0.0',
    audioFormat: 'wav',
  };
  const plan = {
    operationId: 'tts_001',
    operation,
    operationHash: adaptationHash(operation),
    audioConfiguration: config,
    providerConfiguration,
    providerConfigurationHash: adaptationHash({
      provider: 'openai',
      ...providerConfiguration,
    }),
    source: {
      generationRequestId: 'source_001',
      requestHash: sourceHash,
      sourceContentHash: 'b'.repeat(64),
    },
    estimatedCost: {
      currency: 'USD',
      amount: 0.00306,
      proposedInternalAllowanceUsd: 0.01,
      guaranteedMaximum: false,
    },
  };
  const request = ttsRequest(plan);
  const approval = {
    requestHash: adaptationHash(request),
    approvedBy: 'human',
    approvalReference: 'fixture/tts-approval',
    approvedAt: time,
    acceptsUnboundedCost: true,
  };
  const audio = {
    durationMilliseconds: 9000,
    audioFormat: 'wav',
    contentHash: 'c'.repeat(64),
    storageReference: `object:voice/sha256/${'c'.repeat(64)}`,
    provider: 'openai',
    origin: 'SYNTHETIC_TTS',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
  };
  return { ...f, plan, request, approval, audio };
}
