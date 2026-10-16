import { contentFixture, script } from '../../test/support/content-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { mediaStore } from '../../test/support/media-store.js';
import { MediaAssetRepository } from './infrastructure/media-asset.repository.js';
import { asset } from '../../test/support/media-fixture.js';
describe('Media independent persistence', () => {
  let f: ReturnType<typeof contentFixture>,
    r: MediaAssetRepository,
    s: ReturnType<typeof script>;
  beforeEach(() => {
    f = contentFixture();
    const content = contentStore(f.database).open();
    try {
      s = content.registerScript(script(f.selected));
    } finally {
      content.close();
    }
    r = mediaStore(f.database).open();
  });
  afterEach(() => {
    r.close();
    f.close();
  });
  it('preserves exact asset replay and immutable revisions', () => {
    const v = asset(s);
    expect(r.registerMediaAsset(v)).toEqual(v);
    expect(r.registerMediaAsset(v)).toEqual(v);
    const next = asset(s, {
      mediaAssetId: 'media_revision_2',
      revision: 2,
      supersedesMediaAssetId: v.mediaAssetId,
      contentHash: 'b'.repeat(64),
    });
    expect(r.registerMediaAsset(next)).toEqual(next);
    expect(r.listMediaAssetsByScript(s.scriptId)).toHaveLength(2);
    expect(r.getArtifact(next.mediaAssetId)!.inputs[1].inputId).toBe(
      v.mediaAssetId,
    );
  });
  it('rejects missing scope and unauthorized commercial use', () => {
    expect(() =>
      r.registerMediaAsset(
        asset(s, {
          rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_USE_REQUIRED' }),
    );
    expect(() =>
      r.registerMediaAsset(asset(s, { scriptContentHash: 'b'.repeat(64) })),
    ).toThrowError(
      expect.objectContaining({ code: 'SCRIPT_CONTENT_HASH_MISMATCH' }),
    );
    expect(
      r.db.prepare('SELECT COUNT(*) AS n FROM media_assets').get()?.n,
    ).toBe(0);
  });
  it('rolls back asset and lineage on a write failure', () => {
    r.db.exec(
      "CREATE TRIGGER test_media_failure BEFORE INSERT ON media_assets BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    expect(() => r.registerMediaAsset(asset(s))).toThrowError(
      expect.objectContaining({ code: 'MEDIA_ASSET_PERSISTENCE_FAILED' }),
    );
    expect(
      r.db
        .prepare(
          "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='media_asset'",
        )
        .get()?.n,
    ).toBe(0);
  });
});
