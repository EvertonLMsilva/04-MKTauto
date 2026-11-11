import { script } from './content-fixture.js';
import type { MediaAsset } from '../../src/modules/media/domain/media.types.js';
export function asset(
  scriptValue: ReturnType<typeof script>,
  changes: Partial<MediaAsset> = {},
): MediaAsset {
  return {
    schemaVersion: 'media-asset/1.0.0',
    mediaAssetId: 'media_asset_001',
    pipelineRunId: scriptValue.pipelineRunId,
    projectId: scriptValue.projectId,
    projectVersion: scriptValue.projectVersion,
    scriptId: scriptValue.scriptId,
    scriptContentHash: scriptValue.contentHash,
    visualDirectionPosition: 1,
    assetType: 'IMAGE',
    technicalProperties: {
      format: 'png',
      widthPixels: 1080,
      heightPixels: 1920,
      durationMilliseconds: null,
    },
    contentHash: 'a'.repeat(64),
    mediaReference: 'media:asset_001',
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    createdAt: '2026-09-28T14:01:00.000Z',
    revision: 1,
    supersedesMediaAssetId: null,
    ...changes,
  };
}
