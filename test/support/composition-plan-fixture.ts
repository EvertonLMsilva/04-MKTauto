import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup } from './publishing-render-fixture.js';
import { MediaPersistence } from '../../src/modules/media/infrastructure/media.persistence.js';
import { MediaService } from '../../src/modules/media/application/media.service.js';
import { compositionPlanContentHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
export function fixture(mixed = false) {
  const root = mkdtempSync(join(tmpdir(), 'composition-plan-'));
  const path = join(root, 'catalog.sqlite');
  const f = setup(path, { registerPlan: false, mixed });
  const store = new MediaPersistence(
    path,
    { get: (id) => f.repository.getRun(id) },
    { getScript: (id) => (id === f.script.scriptId ? f.script : null) },
  );
  const value = mixed
    ? {
        ...f.compositionPlan,
        schemaVersion: 'composition-plan/2.0.0',
        productionProfile: 'MIXED_MEDIA_V2',
        compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
        segments: f.compositionPlan.segments.map((s: any, i: number) => ({
          ...s,
          mediaType: i ? 'VIDEO' : 'IMAGE',
          sourceStartMilliseconds: 0,
          playbackMode: 'TRIM',
          originalAudioMuted: true,
          framingStrategy: 'COVER_CROP_9_16',
          transition: {
            policyVersion: 'composition-transition/1.0.0',
            type: 'CUT',
            durationMilliseconds: 0,
          },
        })),
      }
    : f.compositionPlan;
  value.contentHash = compositionPlanContentHash(value);
  return {
    ...f,
    root,
    path,
    store,
    value,
    media: new MediaService(store),
    close() {
      f.repository.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
