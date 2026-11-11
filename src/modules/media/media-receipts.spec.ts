import { contentFixture, script } from '../../../test/support/content-fixture.js';
import { contentStore } from '../../../test/support/content-store.js';
import { mediaStore } from '../../../test/support/media-store.js';
import { asset } from '../../../test/support/media-fixture.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
describe('Acquisition receipt atomicity and external dependencies', () => {
  it('rolls back receipt, asset and lineage on receipt failure', () => {
    const f = contentFixture();
    const c = contentStore(f.database).open();
    const s = c.registerScript(script(f.selected));
    c.close();
    const r = mediaStore(f.database).open();
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
      r.db.exec(
        "CREATE TRIGGER test_receipt_failure BEFORE INSERT ON media_acquisition_requests BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
      );
      expect(() =>
        r.registerAcquiredMediaAsset({
          request,
          mediaAsset: asset(s, { mediaAssetId: 'media_asset:acquisition_001' }),
        }),
      ).toThrow();
      for (const table of ['media_assets', 'media_acquisition_requests'])
        expect(
          r.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
        ).toBe(0);
      expect(
        r.db
          .prepare(
            "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='media_asset'",
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      f.close();
    }
  });
  it('does not silently discard Finance telemetry or cost events', () => {
    const f = contentFixture(),
      r = mediaStore(f.database).open();
    try {
      expect(() =>
        r.registerAcquiredMediaAsset({ telemetry: {}, costEvent: {} }),
      ).toThrowError(
        expect.objectContaining({ code: 'MEDIA_FINANCE_DEPENDENCY_REQUIRED' }),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM media_assets').get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      f.close();
    }
  });
});
