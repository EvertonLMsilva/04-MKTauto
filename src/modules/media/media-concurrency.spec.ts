import { contentFixture, script } from '../../../test/support/content-fixture.js';
import { contentStore } from '../../../test/support/content-store.js';
import { mediaStore } from '../../../test/support/media-store.js';
import { asset } from '../../../test/support/media-fixture.js';
import { raceMedia } from '../../../test/support/media-concurrency.js';
describe('Media simultaneous SQLite writers', () => {
  it('serializes identical asset replay and rejects a concurrent revision fork', async () => {
    const f = contentFixture();
    const c = contentStore(f.database).open();
    const s = c.registerScript(script(f.selected));
    c.close();
    try {
      const original = asset(s);
      expect(
        await raceMedia(
          f.database,
          'registerMediaAsset',
          [original, original],
          s,
        ),
      ).toEqual([{ ok: true }, { ok: true }]);
      const one = asset(s, {
          mediaAssetId: 'media_fork_001',
          revision: 2,
          supersedesMediaAssetId: original.mediaAssetId,
        }),
        two = { ...one, mediaAssetId: 'media_fork_002' };
      const result = await raceMedia(
        f.database,
        'registerMediaAsset',
        [one, two],
        s,
      );
      expect(result.filter((value) => value.ok)).toHaveLength(1);
      expect(result.find((value) => !value.ok)?.code).toMatch(
        /MEDIA_ASSET_(REVISION_CONFLICT|ALREADY_SUPERSEDED)/,
      );
      const r = mediaStore(f.database).open();
      try {
        expect(r.listMediaAssetsByScript(s.scriptId)).toHaveLength(2);
        expect(
          r.db
            .prepare(
              "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='media_asset'",
            )
            .get()?.n,
        ).toBe(2);
      } finally {
        r.close();
      }
    } finally {
      f.close();
    }
  });
});
