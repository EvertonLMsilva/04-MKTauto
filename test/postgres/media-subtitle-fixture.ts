import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import type { PostgresDatabase } from '../../src/infrastructure/database/postgres/index.js';
import { mediaVoiceFixture, voiceTrack } from './media-voice-fixture.js';
import { catalogAsset } from './media-catalog-fixture.js';
import { changedPlan } from './media-composition-fixture.js';
import { renderMetadata } from './media-render-fixture.js';
import { PostgresMediaVoicePersistence } from '../../src/modules/media/infrastructure/postgres-media-voice.persistence.js';
import { PostgresMediaCatalogPersistence } from '../../src/modules/media/infrastructure/postgres-media-catalog.persistence.js';
import { PostgresMediaCompositionPersistence } from '../../src/modules/media/infrastructure/postgres-media-composition.persistence.js';
import { PostgresMediaRenderPersistence } from '../../src/modules/media/infrastructure/postgres-media-render.persistence.js';
import { LocalFlowRuntime } from '../../src/modules/media/infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from '../../src/modules/media/infrastructure/local-flow.repository.js';
import {
  LocalEvidenceStorage,
  digest,
  documentBytes,
} from '../../src/modules/media/infrastructure/local-evidence-storage.js';
import { PinnedAlignmentVerifier } from '../../src/modules/media/application/alignment.port.js';
import {
  alignmentHash,
  type AlignmentEvidence,
} from '../../src/modules/media/domain/alignment-contracts.js';
import { adaptationHash } from '../../src/modules/media/domain/media-hash.js';
import { videoCompositionRequestHash } from '../../src/modules/media/domain/video-composition-contracts.js';
import { MediaService } from '../../src/modules/media/application/media.service.js';
import { mediaStore } from '../support/media-store.js';
import type { LocalSubtitleProof } from '../../src/modules/media/infrastructure/postgres-media-subtitle.contracts.js';
const { wav } = await import(
  new URL('../../test-support/physical-fixtures.js', import.meta.url).href
);
export async function subtitleFixture(db: PostgresDatabase) {
  const f = await mediaVoiceFixture(db),
    parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'mktauto-pg-subtitle-'));
  try {
    const evidenceFiles = new LocalEvidenceStorage(join(root, 'evidence')),
      voiceFiles = new LocalEvidenceStorage(join(root, 'voice'));
    const audio: Buffer = wav({ durationMilliseconds: 5000 }),
      audioHash = voiceFiles.put(audio, 'wav');
    const voice = voiceTrack(f.script, {
      contentHash: audioHash,
      storageReference: `object:voice/sha256/${audioHash}`,
    });
    const authorization = {
      actorId: 'operator_fixture',
      statement: 'Fixture-owned recording authorized for test use',
    };
    const voiceDoc = evidenceFiles.put(
      documentBytes({
        voice,
        authorization,
        audioSha256: audioHash,
        cost: { status: 'UNKNOWN', amount: null },
      }),
      'json',
    );
    const voices = await new PostgresMediaVoicePersistence(db).open();
    try {
      await voices.registerLocalVoice(
        voice,
        voiceDoc,
        adaptationHash(authorization),
      );
    } finally {
      await voices.close();
    }
    f.voiceNative.transaction(() =>
      f.voiceNative.registerLocalVoice(
        voice,
        voiceDoc,
        adaptationHash(authorization),
      ),
    );
    const asset = catalogAsset(f.script),
      assets = await new PostgresMediaCatalogPersistence(db).open();
    try {
      await assets.registerMediaAsset(asset);
    } finally {
      await assets.close();
    }
    f.native.registerMediaAsset(asset);
    const plan = changedPlan({
      schemaVersion: 'composition-plan/1.0.0',
      compositionPlanId: 'composition_subtitle',
      pipelineRunId: voice.pipelineRunId,
      projectId: voice.projectId,
      projectVersion: voice.projectVersion,
      scriptId: voice.scriptId,
      scriptContentHash: voice.scriptContentHash,
      voiceTrackId: voice.voiceTrackId,
      voiceTrackContentHash: voice.contentHash,
      outputAspectRatio: f.snapshot.channel.aspectRatio,
      timelineUnit: 'MILLISECOND',
      continuityMode: 'CONTIGUOUS',
      durationMilliseconds: 5000,
      segments: [
        {
          position: 1,
          visualDirectionPosition: 1,
          mediaAssetId: asset.mediaAssetId,
          mediaAssetContentHash: asset.contentHash,
          startMilliseconds: 0,
          endMilliseconds: 5000,
        },
      ],
      createdAt: voice.createdAt,
      revision: 1,
      supersedesCompositionPlanId: null,
    });
    const plans = await new PostgresMediaCompositionPersistence(db).open();
    try {
      await plans.registerCompositionPlan(plan);
    } finally {
      await plans.close();
    }
    f.voiceNative.registerCompositionPlan(plan);
    const source = renderMetadata(plan),
      renders = await new PostgresMediaRenderPersistence(db).open();
    try {
      await renders.registerVideoRender(source);
    } finally {
      await renders.close();
    }
    const req = {
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: 'render_fixture_001',
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
      containerFormat: source.containerFormat,
      widthPixels: source.widthPixels,
      heightPixels: source.heightPixels,
      requestedAt: source.createdAt,
    };
    f.voiceNative.registerVideoComposition({
      request: { ...req, contentHash: videoCompositionRequestHash(req) },
      videoRender: source,
    });
    const text = f.script.fullNarration;
    const evidence: AlignmentEvidence = {
      input: {
        audioAssetId: voice.voiceTrackId,
        audioSha256: voice.contentHash,
        scriptId: f.script.scriptId,
        scriptVersion: f.script.revision,
        scriptTextSha256: alignmentHash(text),
        durationMs: 5000,
        canonicalText: text,
      },
      parameters: { language: 'pt' },
      provenance: 'FORCED_ALIGNMENT',
      output: {
        alignmentId: 'alignment_subtitle_fixture',
        provider: 'fixture-pinned',
        modelVersion: 'fixture/1',
        audioSha256: voice.contentHash,
        scriptTextSha256: alignmentHash(text),
        segments: Array.from(text.matchAll(/[^\n]+/g), (m: any, i) => ({
          startMs: [100, 1800, 3500][i],
          endMs: [1700, 3400, 4900][i],
          text: m[0],
          textStartOffset: m.index,
          textEndOffset: m.index + m[0].length,
        })),
        evidenceHash: '',
        status: 'VERIFIED',
      },
    };
    evidence.output.evidenceHash = alignmentHash(evidence);
    const verifier = new PinnedAlignmentVerifier(
      new Set([evidence.output.evidenceHash]),
    );
    const proof: LocalSubtitleProof = {
      readEvidence: (hash, ext) => evidenceFiles.read(hash, ext),
      readAudio: (hash) => voiceFiles.read(hash, 'wav', 20971520),
      alignmentVerifier: verifier,
    };
    const open = () =>
      new LocalFlowRepository(
        f.sqlite.path,
        { get: (id) => f.native.getRun(id)! },
        { getScript: (id) => f.native.getScript(id) },
      );
    const runtime = new LocalFlowRuntime(
      open,
      new MediaService(mediaStore(f.sqlite.path)),
      {
        LOCAL_MEDIA_EVIDENCE_ROOT: evidenceFiles.root,
        FFMPEG_VOICE_ROOT: voiceFiles.root,
      },
      verifier,
      async () => {
        throw new Error('PROCESS_EXECUTION_FORBIDDEN');
      },
    );
    await runtime.acceptAlignment(evidence);
    const subtitle = runtime.subtitles(evidence.output.alignmentId);
    const alignmentDocumentHash = (
      f.voiceNative.getArtifact(evidence.output.alignmentId)!
        .generationMetadata as any
    ).configurationHash;
    const subtitleDocumentHash = (
      f.voiceNative.getArtifact(subtitle.subtitleId)!.generationMetadata as any
    ).configurationHash;
    return {
      ...f,
      root,
      voice,
      asset,
      plan,
      source,
      evidence,
      subtitle,
      alignmentDocumentHash,
      subtitleDocumentHash,
      proof,
      evidenceFiles,
      voiceFiles,
      burned: {
        ...source,
        videoRenderId: `video_render:local:${adaptationHash({ videoId: source.videoRenderId, subtitleId: subtitle.subtitleId })}`,
        contentHash: digest(Buffer.from('burned-fixture-metadata')),
        logicalReference: 'render:burned_fixture',
        revision: 2,
        supersedesVideoRenderId: source.videoRenderId,
      },
      close() {
        f.cleanupVoice();
        const actual = realpathSync(root);
        if (
          dirname(actual) !== parent ||
          !basename(actual).startsWith('mktauto-pg-subtitle-')
        )
          throw new Error('Unsafe fixture cleanup');
        rmSync(actual, { recursive: true, force: false });
      },
    };
  } catch (error) {
    f.cleanupVoice();
    const actual = realpathSync(root);
    if (
      dirname(actual) === parent &&
      basename(actual).startsWith('mktauto-pg-subtitle-')
    )
      rmSync(actual, { recursive: true, force: false });
    throw error;
  }
}
