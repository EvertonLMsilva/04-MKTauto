import type { PostgresDatabase } from '../../src/infrastructure/database/postgres/index.js';
import {
  mediaVoiceFixture,
  voiceTrack,
  voiceEvidence,
} from './media-voice-fixture.js';
import { catalogAsset, licensedAsset } from './media-catalog-fixture.js';
import { PostgresMediaVoicePersistence } from '../../src/modules/media/infrastructure/postgres-media-voice.persistence.js';
import { PostgresMediaCatalogPersistence } from '../../src/modules/media/infrastructure/postgres-media-catalog.persistence.js';
import { CompositionPlanRepository } from '../../src/modules/media/infrastructure/composition-plan.reader.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { SqliteProjectRepository } from '../../src/modules/project/infrastructure/sqlite-project.repository.js';
import { PostgresOperationsPersistence } from '../../src/modules/content-operations/infrastructure/postgres-campaign.persistence.js';
import { SqliteOperationsRepository } from '../../src/modules/content-operations/infrastructure/sqlite-operations.repository.js';
import { PostgresAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.persistence.js';
import { PostgresAffiliateSessionFactory } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.session.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { PostgresContentPersistence } from '../../src/modules/content/infrastructure/postgres-content.persistence.js';
import { contentStore } from '../support/content-store.js';
import { affiliateHash } from '../../src/modules/affiliate/domain/affiliate-contracts.js';
import { scriptContentHash } from '../../src/modules/content/domain/script-contracts.js';
import { compositionPlanContentHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
import { project, at } from './affiliate-fixture.js';

export function changedPlan(plan: any, changes: Record<string, unknown> = {}) {
  const value = { ...plan, ...changes };
  value.contentHash = compositionPlanContentHash(value);
  return value;
}
export async function compositionScriptRevision(
  db: PostgresDatabase,
  f: Awaited<ReturnType<typeof mediaCompositionFixture>>,
  { extraDirection = false, visualChanged = false } = {},
) {
  const script = {
    ...f.script,
    scriptId: 'script_composition_revision',
    hook: 'Uma nova narração para o mesmo material autorizado.',
    revision: 2,
    supersedesScriptId: f.script.scriptId,
    visualDirections: extraDirection
      ? [
          ...f.script.visualDirections,
          { ...f.script.visualDirections[0], position: 2 },
        ]
      : visualChanged
        ? f.script.visualDirections.map((s: any) => ({
            ...s,
            description: 'Uma direção visual diferente.',
          }))
        : f.script.visualDirections,
  };
  script.fullNarration = [
    script.hook,
    ...script.narrativeBlocks.map((s: any) => s.narration),
    script.cta,
  ]
    .filter(Boolean)
    .join('\n\n');
  script.contentHash = scriptContentHash(script);
  const content = await PostgresContentPersistence.coordinated(db).open();
  try {
    await content.registerScript(script);
  } finally {
    await content.close();
  }
  const native = contentStore(f.sqlite.path).open();
  try {
    native.registerScript(script);
  } finally {
    native.close();
  }
  const voice = voiceTrack(script, {
      voiceTrackId: 'voice_composition_revision',
    }),
    e = voiceEvidence(voice);
  const voices = await new PostgresMediaVoicePersistence(db).open();
  try {
    await voices.registerLocalVoice(voice, e.documentHash, e.rightsHash);
  } finally {
    await voices.close();
  }
  f.voiceNative.transaction(() =>
    f.voiceNative.registerLocalVoice(voice, e.documentHash, e.rightsHash),
  );
  const assets = extraDirection
    ? [1, 2].map((visualDirectionPosition) =>
        catalogAsset(script, {
          mediaAssetId: `asset_revision_${visualDirectionPosition}`,
          visualDirectionPosition,
        }),
      )
    : [f.asset];
  if (extraDirection) {
    const catalog = await new PostgresMediaCatalogPersistence(db).open();
    try {
      for (const asset of assets) {
        await catalog.registerMediaAsset(asset);
        f.native.registerMediaAsset(asset);
      }
    } finally {
      await catalog.close();
    }
  }
  const plan = changedPlan(f.plan, {
    compositionPlanId: 'composition_script_revision',
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId,
    voiceTrackContentHash: voice.contentHash,
    ...(extraDirection
      ? {
          segments: assets.map((asset, i) => ({
            position: i + 1,
            visualDirectionPosition: i + 1,
            mediaAssetId: asset.mediaAssetId,
            mediaAssetContentHash: asset.contentHash,
            startMilliseconds: i === 0 ? 0 : 2000,
            endMilliseconds: i === 0 ? 2000 : 5000,
          })),
        }
      : {}),
  });
  return { script, voice, assets, plan };
}
export async function mediaCompositionFixture(
  db: PostgresDatabase,
  { mixed = false, video = false } = {},
) {
  const f = await mediaVoiceFixture(db);
  let script = f.script,
    snapshot = f.snapshot;
  try {
    if (mixed) {
      const input = {
        ...project(),
        version: 2,
        channel: { ...project().channel, productionProfile: 'MIXED_MEDIA_V2' },
      };
      const projects = await new PostgresProjectPersistence(db).open();
      try {
        snapshot = await projects.createVersion(input, {
          expectedVersion: 1,
          createdAt: at,
        });
      } finally {
        await projects.close();
      }
      const nativeProjects = new SqliteProjectRepository(f.sqlite.path);
      try {
        nativeProjects.createVersion(input, {
          expectedVersion: 1,
          createdAt: at,
        });
      } finally {
        nativeProjects.close();
      }
      const pipelineRunId = 'run_composition_mixed',
        execution = {
          pipelineRunId,
          projectId: 'project_001',
          projectVersion: 2,
          startedAt: at,
        };
      const ops = await new PostgresOperationsPersistence(db).open();
      try {
        await ops.startRun({ execution, projectSnapshot: snapshot });
      } finally {
        await ops.close();
      }
      const nativeOps = new SqliteOperationsRepository(f.sqlite.path);
      try {
        nativeOps.startRun({ execution, projectSnapshot: snapshot });
      } finally {
        nativeOps.close();
      }
      const affiliate = new PostgresAffiliatePersistence(
        new PostgresAffiliateSessionFactory(db, undefined, true),
      );
      const binding = { pipelineRunId, briefingId: f.briefing.briefingId };
      await new AffiliateRunContextService<true>(affiliate).bindRun(
        binding,
        'binding_composition',
      );
      new AffiliateRunContextService(
        new SqliteAffiliateRunContextPersistence(f.sqlite.path),
      ).bindRun(binding, 'binding_composition');
      const selected = {
        ...f.selected,
        selectionId: 'editorial_composition_mixed',
        pipelineRunId,
        projectVersion: 2,
        contentHash: '',
      };
      const { contentHash: _, ...body } = selected;
      selected.contentHash = affiliateHash(body);
      script = {
        ...f.script,
        scriptId: 'script_composition_mixed',
        pipelineRunId,
        projectVersion: 2,
        editorialSelectionId: selected.selectionId,
        editorialSelectionContentHash: selected.contentHash,
      };
      script.contentHash = scriptContentHash(script);
      const content = await PostgresContentPersistence.coordinated(db).open();
      try {
        await content.registerAffiliateEditorialSelection(selected);
        await content.registerScript(script);
      } finally {
        await content.close();
      }
      const nativeContent = contentStore(f.sqlite.path).open();
      try {
        nativeContent.registerAffiliateEditorialSelection(selected);
        nativeContent.registerScript(script);
      } finally {
        nativeContent.close();
      }
    }
    const voice = voiceTrack(script),
      evidence = voiceEvidence(voice),
      voices = await new PostgresMediaVoicePersistence(db).open();
    try {
      await voices.registerLocalVoice(
        voice,
        evidence.documentHash,
        evidence.rightsHash,
      );
    } finally {
      await voices.close();
    }
    f.voiceNative.transaction(() =>
      f.voiceNative.registerLocalVoice(
        voice,
        evidence.documentHash,
        evidence.rightsHash,
      ),
    );
    const asset = video ? licensedAsset(script) : catalogAsset(script),
      assets = await new PostgresMediaCatalogPersistence(db).open();
    try {
      await assets.registerMediaAsset(asset);
    } finally {
      await assets.close();
    }
    f.native.registerMediaAsset(asset);
    const segment = {
      position: 1,
      visualDirectionPosition: 1,
      mediaAssetId: asset.mediaAssetId,
      mediaAssetContentHash: asset.contentHash,
      startMilliseconds: 0,
      endMilliseconds: 5000,
    };
    const plan = changedPlan({
      schemaVersion: mixed
        ? 'composition-plan/2.0.0'
        : 'composition-plan/1.0.0',
      compositionPlanId: 'composition_001',
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      voiceTrackId: voice.voiceTrackId,
      voiceTrackContentHash: voice.contentHash,
      outputAspectRatio: snapshot.channel.aspectRatio,
      timelineUnit: 'MILLISECOND',
      continuityMode: 'CONTIGUOUS',
      durationMilliseconds: 5000,
      segments: [
        mixed
          ? {
              ...segment,
              mediaType: video ? 'VIDEO' : 'IMAGE',
              sourceStartMilliseconds: 0,
              playbackMode: 'TRIM',
              originalAudioMuted: true,
              framingStrategy: 'COVER_CROP_9_16',
              transition: {
                policyVersion: 'composition-transition/1.0.0',
                type: 'CUT',
                durationMilliseconds: 0,
              },
            }
          : segment,
      ],
      createdAt: at,
      revision: 1,
      supersedesCompositionPlanId: null,
      ...(mixed
        ? {
            productionProfile: 'MIXED_MEDIA_V2',
            compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
          }
        : {}),
    });
    const nativeComposition = new CompositionPlanRepository(
      f.sqlite.path,
      { get: (id) => f.native.getRun(id)! },
      { getScript: (id) => f.native.getScript(id) },
    );
    return {
      ...f,
      script,
      snapshot,
      voice,
      asset,
      plan,
      nativeComposition,
      cleanupComposition() {
        nativeComposition.close();
        f.cleanupVoice();
      },
    };
  } catch (error) {
    f.cleanupVoice();
    throw error;
  }
}
