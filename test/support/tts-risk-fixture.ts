import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture, P2_TIME } from './p2-editorial-fixture.js';
import { FinanceService } from '../../src/modules/finance/application/finance.service.js';
import { FinanceSession } from '../../src/modules/finance/infrastructure/finance.session.js';
import {
  ttsHash,
  ttsRequest,
} from '../../src/modules/finance/domain/tts-financial-contracts.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';

export const TTS_RISK_TIME = P2_TIME;
export function ttsRiskFixture() {
  const f = p2EditorialFixture();
  const db = new DatabaseSync(f.database);
  new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  ).bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'tts_bind');
  const service = () =>
    new FinanceService({ open: () => new FinanceSession(f.database) });
  service().configureGlobal({});
  service().configureCampaign('camp_001', 1);
  const config = {
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
  };
  const configHash = ttsHash(config),
    configId = `audio_config:${configHash}`;
  db.prepare('INSERT INTO p4_artifacts VALUES(?,?,?,?,?)').run(
    'audio_config',
    configId,
    configHash,
    null,
    JSON.stringify(config),
  );
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
  const sourceHash = ttsHash(sourceRequest);
  db.prepare(
    "INSERT INTO video_generation_operations VALUES(?,?,?,?,?,?,?,'COMPLETED',?,?,?,?)",
  ).run(
    'source_001',
    'camp_001',
    'run_001',
    1,
    sourceHash,
    JSON.stringify(sourceRequest),
    JSON.stringify({
      maximumAmount: '0.001',
      kind: 'ENFORCED_MAXIMUM',
      currency: 'USD',
      provider: 'fake_video',
      requestHash: sourceHash,
      includesAllCharges: true,
      evidenceReference: 'fixture/local',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    'fixture',
    P2_TIME,
    JSON.stringify({
      generationRequestId: 'source_001',
      requestHash: sourceHash,
      provider: 'fake_video',
      state: 'COMPLETED',
      actualCostUsd: '0',
      providerRequestId: 'fixture_video',
      videoReference: 'object:fixture/video',
    }),
    'fixture_cost',
  );
  const operation = {
    sourceId: 'source_001',
    pipelineRunId: 'run_001',
    audioConfigId: configId,
    narration:
      'Conheça este travesseiro anatômico. Veja os detalhes do produto.',
    maxDurationMilliseconds: 10000,
  };
  const providerConfiguration = {
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    policyVersion: 'openai-voice-policy/2.0.0',
    audioFormat: 'wav',
  };
  const plan = {
    operationId: 'tts_risk_001',
    operation,
    operationHash: ttsHash(operation),
    audioConfiguration: { id: configId, config, contentHash: configHash },
    providerConfiguration,
    providerConfigurationHash: ttsHash({
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
    financialPolicy: {
      schemaVersion: 'tts-risk-reservation/2.0.0',
      scriptId: 'script_p77_v2',
      scriptContentHash: 'c'.repeat(64),
    },
  };
  const approval = {
    requestHash: ttsHash(ttsRequest(plan)),
    approvedBy: 'operator',
    approvalReference: 'fixture/tts-risk',
    approvedAt: P2_TIME,
    acceptsUnboundedCost: true,
    policyVersion: 'tts-risk-reservation/2.0.0',
    expiresAt: '2026-10-14T13:00:00Z',
  };
  const audio = {
    durationMilliseconds: 5000,
    audioFormat: 'wav',
    contentHash: 'd'.repeat(64),
    storageReference: `object:voice/sha256/${'d'.repeat(64)}`,
    provider: 'openai',
    origin: 'SYNTHETIC_TTS',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
  };
  return {
    ...f,
    db,
    service,
    plan,
    approval,
    audio,
    close() {
      db.close();
      f.cleanup();
    },
  };
}
