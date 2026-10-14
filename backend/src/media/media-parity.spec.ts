import { contentFixture, script } from '../../test/support/content-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { mediaStore } from '../../test/support/media-store.js';
import { asset } from '../../test/support/media-fixture.js';
import {
  validateMediaAsset,
  mediaAssetIdentityHash,
} from './domain/media-asset-contracts.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
import { mediaSelectionRequestHash } from './domain/media-selection-contracts.js';
import type { MediaAsset } from './domain/media.types.js';
const legacy = await import(
  new URL('../../../src/media-asset-repository.js', import.meta.url).href
);
const contracts = await import(
  new URL('../../../src/domain/media-asset-contracts.js', import.meta.url).href
);
function outcome(action: () => unknown) {
  try {
    return { result: action() };
  } catch (error) {
    const e = error as {
      name: string;
      code?: string;
      field?: string;
      path?: string;
      message: string;
    };
    return {
      name: e.name,
      code: e.code,
      field: e.field ?? e.path,
      message: e.message,
    };
  }
}
describe('Media JS/TS parity', () => {
  it('matches assets, revisions, evidence, receipts, replay and persistence errors', () => {
    const f = contentFixture(),
      g = contentFixture();
    const content = contentStore(f.database).open(),
      other = contentStore(g.database).open();
    const s = content.registerScript(script(f.selected));
    other.registerScript(script(g.selected));
    content.close();
    other.close();
    const r = mediaStore(f.database).open(),
      js = new legacy.MediaAssetRepository(g.database);
    try {
      const request = {
        schemaVersion: 'media-acquisition-request/1.0.0',
        mediaAcquisitionRequestId: 'acquisition_001',
        scriptId: s.scriptId,
        scriptContentHash: s.contentHash,
        visualDirectionPosition: 1,
        assetType: 'IMAGE',
        requestedAt: '2026-09-28T14:01:00.000Z',
        contentHash: '',
      };
      request.contentHash = mediaAcquisitionRequestHash(request);
      const v = asset(s, { mediaAssetId: 'media_asset:acquisition_001' });
      expect(r.registerAcquiredMediaAsset({ request, mediaAsset: v })).toEqual(
        js.registerAcquiredMediaAsset({ request, mediaAsset: v }),
      );
      expect(r.registerAcquiredMediaAsset({ request, mediaAsset: v })).toEqual(
        js.registerAcquiredMediaAsset({ request, mediaAsset: v }),
      );
      expect(r.getMediaAcquisition(request.mediaAcquisitionRequestId)).toEqual(
        js.getMediaAcquisition(request.mediaAcquisitionRequestId),
      );
      const selection = {
        schemaVersion: 'media-selection-request/1.0.0',
        mediaSelectionRequestId: 'selection_media_001',
        scriptId: s.scriptId,
        scriptContentHash: s.contentHash,
        visualDirectionPosition: 1,
        productionProfile: 'STATIC_IMAGE_V1',
        requestedAt: request.requestedAt,
        contentHash: '',
      };
      selection.contentHash = mediaSelectionRequestHash(selection);
      expect(
        r.registerMediaSelection({ request: selection, mediaAsset: v }),
      ).toEqual(
        js.registerMediaSelection({ request: selection, mediaAsset: v }),
      );
      expect(r.getMediaSelection(selection.mediaSelectionRequestId)).toEqual(
        js.getMediaSelection(selection.mediaSelectionRequestId),
      );
      const next = asset(s, {
        mediaAssetId: 'media_revision_2',
        revision: 2,
        supersedesMediaAssetId: v.mediaAssetId,
        contentHash: 'b'.repeat(64),
      });
      expect(r.registerMediaAsset(next)).toEqual(js.registerMediaAsset(next));
      for (const value of [
        asset(s, { scriptId: 'script_missing' }),
        asset(s, { pipelineRunId: 'run_missing' }),
        asset(s, {
          rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
        }),
        asset(s, {
          mediaAssetId: 'media_revision_3',
          revision: 3,
          supersedesMediaAssetId: v.mediaAssetId,
        }),
      ])
        expect(outcome(() => r.registerMediaAsset(value))).toEqual(
          outcome(() => js.registerMediaAsset(value)),
        );
      expect(r.listMediaAssetsByPipelineRun(s.pipelineRunId)).toEqual(
        js.listMediaAssetsByPipelineRun(s.pipelineRunId),
      );
      expect(r.listMediaAssetsByVisualDirection(s.scriptId, 1)).toEqual(
        js.listMediaAssetsByVisualDirection(s.scriptId, 1),
      );
      for (const table of [
        'media_assets',
        'media_asset_sources',
        'media_acquisition_requests',
        'media_selection_requests',
        'artifact_lineage',
        'artifact_lineage_inputs',
      ])
        expect(
          r.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all(),
        ).toEqual(js.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all());
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM cost_events').get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      js.close();
      f.close();
      g.close();
    }
  });
  it('preserves V2 source metadata and detects tampering', () => {
    const f = contentFixture();
    const c = contentStore(f.database).open();
    const s = c.registerScript(script(f.selected));
    c.close();
    const r = mediaStore(f.database).open();
    try {
      const v = asset(s, {
        schemaVersion: 'media-asset/2.0.0',
        origin: 'PROVIDER_LICENSED',
        provider: 'pexels',
        rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
        technicalProperties: {
          format: 'mp4',
          widthPixels: 1080,
          heightPixels: 1920,
          durationMilliseconds: 1000,
          mimeType: 'video/mp4',
          hasAudio: false,
        },
        assetType: 'VIDEO',
        source: {
          externalAssetId: '12345',
          licenseName: 'Pexels License',
          licenseUrl: 'https://www.pexels.com/license/',
          photographerName: 'Autor autorizado',
          photographerUrl: 'https://www.pexels.com/@autor/',
          sourceUrl: 'https://www.pexels.com/video/12345/',
        },
      });
      expect(validateMediaAsset(v)).toEqual(contracts.validateMediaAsset(v));
      expect(mediaAssetIdentityHash(v)).toBe(
        contracts.mediaAssetIdentityHash(v),
      );
      expect(r.registerMediaAsset(v)).toEqual(v);
      const triggers = r.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='media_asset_sources'",
        )
        .all();
      for (const trigger of triggers)
        r.db.exec(`DROP TRIGGER "${String(trigger.name)}"`);
      r.db.exec("UPDATE media_asset_sources SET license_name='tampered'");
      expect(() => r.getMediaAsset(v.mediaAssetId)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PERSISTED_MEDIA_ASSET' }),
      );
    } finally {
      r.close();
      f.close();
    }
  });
  it('matches permission validation across existing origins and usage bases', () => {
    const f = contentFixture();
    try {
      const s = script(f.selected);
      for (const origin of [
        'OPERATOR_OWNED',
        'AUTHORIZED_THIRD_PARTY',
        'PROVIDER_GENERATED',
        'PROVIDER_LICENSED',
      ] as const)
        for (const usageBasis of [
          'OWNED',
          'LICENSED',
          'EXPLICIT_PERMISSION',
          'PROVIDER_TERMS',
        ] as const) {
          const v = asset(s, {
            origin,
            provider: origin.startsWith('PROVIDER') ? 'provider_001' : null,
            rights: { usageBasis, commercialUseAllowed: true },
          });
          expect(outcome(() => validateMediaAsset(v))).toEqual(
            outcome(() => contracts.validateMediaAsset(v)),
          );
        }
      const invalid = asset(s, {
        source: {
          externalAssetId: '123',
          licenseName: 'Licensed',
          licenseUrl: 'http://example.com/license',
          photographerName: 'Autor',
          photographerUrl: 'https://example.com/author',
          sourceUrl: 'https://example.com/source',
        },
      } as Partial<MediaAsset>);
      expect(outcome(() => validateMediaAsset(invalid))).toEqual(
        outcome(() => contracts.validateMediaAsset(invalid)),
      );
    } finally {
      f.close();
    }
  });
});
