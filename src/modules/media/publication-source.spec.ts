import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { publicationSourceReview } from './infrastructure/local-flow.runtime.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

test('authorized IMAGE receives static physical inspection without a temporal review', () => {
  const root = mkdtempSync(join(tmpdir(), 'publication-image-'));
  try {
    const storage = new LocalEvidenceStorage(root);
    const contentHash = storage.put(png(), 'png');
    const asset: any = {
      assetType: 'IMAGE', mediaAssetId: 'image_001', contentHash,
      mediaReference: `media:sha256_${contentHash}`,
      technicalProperties: { format: 'png', mimeType: 'image/png',
        widthPixels: 90, heightPixels: 160, durationMilliseconds: null, hasAudio: null },
      rights: { commercialUseAllowed: true },
    };
    const temporalReview = vi.fn();
    const evidence = publicationSourceReview(asset, { temporalReview } as any, root);
    expect(evidence.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.sourceKind).toBe('STATIC_IMAGE');
    expect(temporalReview).not.toHaveBeenCalled();
    expect(publicationSourceReview(asset, { temporalReview } as any, root)).toEqual(evidence);
    expect(() => publicationSourceReview({ ...asset, rights: { commercialUseAllowed: false } },
      { temporalReview } as any, root)).toThrow();
    expect(() => publicationSourceReview({ ...asset,
      technicalProperties: { ...asset.technicalProperties, widthPixels: 91 } },
      { temporalReview } as any, root)).toThrow();
    expect(() => publicationSourceReview({ ...asset,
      technicalProperties: { ...asset.technicalProperties, widthPixels: undefined } },
      { temporalReview } as any, root)).toThrow('PUBLICATION_SOURCE_QC_REQUIRED');
    writeFileSync(storage.path(contentHash, 'png'), Buffer.from('tampered'));
    expect(() => publicationSourceReview(asset, { temporalReview } as any, root)).toThrow();
    const invalidHash = storage.put(Buffer.from('not a PNG'), 'png');
    expect(() => publicationSourceReview({ ...asset, contentHash: invalidHash,
      mediaReference: `media:sha256_${invalidHash}` }, { temporalReview } as any, root)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('VIDEO still requires valid temporal review and unknown source type is blocked', () => {
  const root = mkdtempSync(join(tmpdir(), 'publication-video-'));
  try {
    const storage = new LocalEvidenceStorage(root);
    const contentHash = storage.put(Buffer.from('video-fixture'), 'mp4');
    const asset: any = { assetType: 'VIDEO', mediaAssetId: 'video_001',
      contentHash, mediaReference: `media:sha256_${contentHash}`,
      technicalProperties: { format: 'mp4' }, rights: { commercialUseAllowed: true } };
    expect(() => publicationSourceReview(asset, { temporalReview: () => null } as any, root))
      .toThrow('PUBLICATION_SOURCE_QC_REQUIRED');
    expect(() => publicationSourceReview(asset,
      { temporalReview: () => ({ result: 'FAIL', contentHash: 'a'.repeat(64) }) } as any, root))
      .toThrow('PUBLICATION_SOURCE_QC_REQUIRED');
    expect(publicationSourceReview(asset,
      { temporalReview: () => ({ result: 'PASS', contentHash: 'b'.repeat(64) }) } as any, root))
      .toEqual({ reviewHash: 'b'.repeat(64), sourceKind: 'TEMPORAL_VIDEO' });
    expect(() => publicationSourceReview({ ...asset, assetType: 'UNKNOWN' },
      { temporalReview: () => null } as any, root)).toThrow('PUBLICATION_SOURCE_QC_REQUIRED');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
