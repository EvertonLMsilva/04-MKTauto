import type { PostgresDatabase } from '../../src/infrastructure/database/postgres/index.js';
import { mediaCatalogFixture, at } from './media-catalog-fixture.js';
import { LocalFlowRepository } from '../../src/modules/media/infrastructure/local-flow.repository.js';
import { validateVoiceTrack } from '../../src/modules/media/domain/voice-track-contracts.js';
import { adaptationHash } from '../../src/modules/media/domain/media-hash.js';
import { documentBytes } from '../../src/modules/media/infrastructure/local-evidence-storage.js';
import { createHash } from 'node:crypto';

export async function mediaVoiceFixture(db: PostgresDatabase) {
  const catalog = await mediaCatalogFixture(db);
  const native = new LocalFlowRepository(
    catalog.sqlite.path,
    { get: (id) => catalog.native.getRun(id)! },
    { getScript: (id) => catalog.native.getScript(id) },
  );
  return {
    ...catalog,
    voiceNative: native,
    cleanupVoice() {
      native.close();
      catalog.native.close();
      catalog.cleanup();
    },
  };
}
export function voiceTrack(
  script: any,
  overrides: Record<string, unknown> = {},
) {
  return validateVoiceTrack({
    schemaVersion: 'voice-track/1.0.0',
    voiceTrackId: 'voice_recording_001',
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    language: script.language,
    voiceStyle: 'informative',
    durationMilliseconds: 5000,
    audioFormat: 'wav',
    contentHash: 'c'.repeat(64),
    storageReference: `object:voice/sha256/${'c'.repeat(64)}`,
    origin: 'AUTHORIZED_RECORDING',
    provider: null,
    rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
    createdAt: at,
    revision: 1,
    supersedesVoiceTrackId: null,
    ...overrides,
  });
}
// Synthetic metadata only: no audio bytes, TTS, alignment or external services.
export function voiceEvidence(voice: any) {
  const authorization = {
    actorId: 'operator_fixture',
    statement: 'Fixture authorization for commercial use',
  };
  const document = {
    voice,
    authorization,
    audioSha256: voice.contentHash,
    cost: { status: 'UNKNOWN', amount: null },
  };
  return {
    documentHash: createHash('sha256')
      .update(documentBytes(document))
      .digest('hex'),
    rightsHash: adaptationHash(authorization),
  };
}
