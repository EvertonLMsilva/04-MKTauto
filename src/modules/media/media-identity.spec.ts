import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  lstat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseMediaIdentity,
  canonicalMediaReference,
} from './domain/media-identity.js';
import {
  mediaIdentityHash,
  validateVideoOrigin,
} from './domain/p4-qc-contracts.js';
import { adaptationHash } from './domain/media-hash.js';
import { FalVideoStorage } from './infrastructure/fal-video-storage.js';
import { LocalCompositionReferenceResolver } from './infrastructure/local-composition-reference-resolver.js';
import { validateMediaProviderOutput } from './domain/media-acquisition-contracts.js';
import { fixture as mediaFixture } from '../../../test/support/temporal-qc-fixture.js';
import { QualityControlRepository } from './infrastructure/quality-control.repository.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';

const bytes = Buffer.from('synthetic-local-video-no-provider');
const hash = createHash('sha256').update(bytes).digest('hex');
const canonical = `media:sha256_${hash}`;
const legacy = `object:ltx-video/sha256/${hash}`;
const probe = vi.fn(async (cmd: string) => ({
  stdout:
    cmd === 'probe'
      ? JSON.stringify({
          streams: [{ codec_type: 'video', width: 768, height: 1024 }],
          format: { format_name: 'mov,mp4', duration: '5.0' },
        })
      : '',
}));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'media-identity-'));
  const original = join(root, 'originals'),
    target = join(root, 'current');
  await mkdir(join(original, 'sha256'), { recursive: true });
  const storage = new FalVideoStorage(
    { root: target, maxBytes: 100, ffprobePath: 'probe', ffmpegPath: 'decode' },
    { executeImpl: probe },
  );
  const resolver = new LocalCompositionReferenceResolver({
    voiceRoot: original,
    mediaRoot: original,
  });
  return {
    root,
    original,
    target,
    storage,
    resolver,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
describe('content-addressed Media identity', () => {
  it('writes canonical identities and reads legacy only by explicit opt-in', () => {
    expect(canonicalMediaReference(hash)).toBe(canonical);
    expect(
      parseMediaIdentity(canonical, { expectedHash: hash }).contentHash,
    ).toBe(hash);
    expect(() => parseMediaIdentity(legacy)).toThrow('MEDIA_IDENTITY_INVALID');
    expect(
      parseMediaIdentity(legacy, { expectedHash: hash, allowLegacy: true })
        .reference,
    ).toBe(legacy);
    expect(mediaIdentityHash(legacy, hash)).toBe(hash);
  });
  it.each([
    `${canonical}?token=x`,
    `${canonical}/../x`,
    `${legacy}/../x`,
    `media:sha256_${hash.toUpperCase()}`,
    'media:sha256_bad',
    `render:sha256_${hash}`,
    'media:opaque',
    `object:ltx-video/sha256/${hash}\n`,
  ])('rejects malformed or unrelated identity %s', (reference) => {
    expect(() => parseMediaIdentity(reference, { allowLegacy: true })).toThrow(
      'MEDIA_IDENTITY_INVALID',
    );
  });
  it('rejects missing or divergent physical hashes', () => {
    expect(() =>
      parseMediaIdentity(canonical, { expectedHash: 'f'.repeat(64) }),
    ).toThrow();
    expect(() => mediaIdentityHash(canonical, undefined)).toThrow();
    expect(() => canonicalMediaReference('bad')).toThrow();
  });
  it('recovers a historical manifest without normalizing payloads or identity hashes', () => {
    const origin = {
      schemaVersion: 'video-origin/1.0.0',
      kind: 'AI_GENERATED',
      generationRequestId: 'historical_generation',
      providerRequestId: 'historical_request',
      requestHash: 'a'.repeat(64),
      sourceReference: legacy,
      sourceContentHash: hash,
      rights: {
        evidenceReference: 'evidence:historical',
        evidenceContentHash: 'b'.repeat(64),
        processingAuthorized: true,
        commercialUseAuthorized: true,
        audioAuthorized: true,
      },
    };
    const serialized = JSON.stringify({ origin });
    const recovered = JSON.parse(serialized);
    expect(validateVideoOrigin(recovered.origin)).toEqual(origin);
    expect(JSON.stringify(recovered)).toBe(serialized);
    expect(adaptationHash(recovered.origin)).toBe(adaptationHash(origin));
    expect(recovered.origin.sourceReference).toBe(legacy);
  });
  it('rejects divergent CAS identities on new provider outputs', () => {
    expect(() =>
      validateMediaProviderOutput(
        {
          assetType: 'VIDEO',
          contentHash: 'e'.repeat(64),
          mediaReference: canonical,
          technicalProperties: {
            format: 'mp4',
            widthPixels: 768,
            heightPixels: 1024,
            durationMilliseconds: 5000,
          },
          origin: 'PROVIDER_GENERATED',
          provider: 'fal_ai',
          rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
        },
        { physicalWrite: true },
      ),
    ).toThrow('MEDIA_IDENTITY_INVALID');
  });
  it('requires canonical references for physical provider writes while preserving opaque read contracts', () => {
    const output = {
      assetType: 'VIDEO',
      contentHash: hash,
      mediaReference: 'media:opaque_video',
      technicalProperties: {
        format: 'mp4',
        widthPixels: 768,
        heightPixels: 1024,
        durationMilliseconds: 5000,
      },
      origin: 'PROVIDER_GENERATED',
      provider: 'fal_ai',
      rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    };
    expect(validateMediaProviderOutput(output)).toEqual(output);
    expect(() =>
      validateMediaProviderOutput(output, { physicalWrite: true }),
    ).toThrow('MEDIA_IDENTITY_INVALID');
    expect(
      validateMediaProviderOutput(
        { ...output, mediaReference: canonical },
        { physicalWrite: true },
      ).mediaReference,
    ).toBe(canonical);
  });
  it('requires matching CAS hashes on new asset registrations, preserving opaque contracts', () => {
    const f = mediaFixture();
    try {
      const asset = {
        ...f.assets[1],
        mediaAssetId: 'identity_video_002',
        revision: 2,
        supersedesMediaAssetId: f.assets[1].mediaAssetId,
        mediaReference: canonical,
      };
      expect(() => f.media.register(asset)).toThrow('MEDIA_IDENTITY_INVALID');
      expect(
        f.media.register({ ...asset, mediaReference: 'media:opaque_video' })
          .mediaReference,
      ).toBe('media:opaque_video');
    } finally {
      f.close();
    }
  });
  it('does not carry temporal QC across new artifact identities with the same physical hash', async () => {
    const f = mediaFixture();
    const source = f.assets[1];
    const q = new QualityControlRepository(
      f.path,
      { get: (id) => f.repository.getRun(id)! },
      { getScript: () => f.script as any },
      {
        temporalValidator: {
          id: 'independent-review',
          version: '1',
          evaluate: (identity) => ({
            mediaReference: identity.mediaReference,
            contentHash: identity.contentHash,
            motion: 'PASS',
            continuity: 'PASS',
            fidelity: 'PASS',
            motionBasis: 'SUBJECT_MOTION',
            provenance: {
              reference: 'evidence:simulated_review',
              contentHash: 'a'.repeat(64),
              validator: 'independent-review',
              version: '1',
              parameters: { method: 'simulated-test-only' },
            },
          }),
        },
      },
    );
    try {
      expect((await q.evaluateTemporalMedia(source.mediaAssetId)).result).toBe(
        'PASS',
      );
      const reused = {
        ...source,
        mediaAssetId: 'identity_video_copy',
        revision: 2,
        supersedesMediaAssetId: source.mediaAssetId,
      };
      f.media.register(reused);
      f.value.segments[1].mediaAssetId = reused.mediaAssetId;
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
    } finally {
      q.close();
      f.close();
    }
  });
  it.each([false, true])(
    'resolves verified historical bytes in sharded layout=%s',
    async (sharded) => {
      const f = await fixture();
      try {
        const dir = sharded
          ? join(f.original, 'sha256', hash.slice(0, 2))
          : join(f.original, 'sha256');
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${hash}.mp4`);
        await writeFile(path, bytes);
        expect(await f.resolver.resolveHistoricalVideo(legacy, hash)).toBe(
          path,
        );
        await expect(f.resolver.resolveMedia(legacy, 'mp4')).rejects.toThrow();
        if (!sharded)
          await expect(
            f.resolver.resolveMedia(canonical, 'mp4'),
          ).rejects.toThrow();
      } finally {
        await f.close();
      }
    },
  );
  it('materializes canonically via existing storage, preserves original and replays', async () => {
    const f = await fixture();
    try {
      const source = join(f.original, 'sha256', `${hash}.mp4`);
      await writeFile(source, bytes);
      const before = await lstat(source);
      const result = await f.storage.materializeHistorical(legacy, {
        legacyRoot: f.original,
        contentHash: hash,
      });
      expect(result.mediaReference).toBe(canonical);
      expect(result.contentHash).toBe(hash);
      expect(result.physicalPath).toBe(
        join(f.target, 'sha256', hash.slice(0, 2), `${hash}.mp4`),
      );
      expect(await readFile(result.physicalPath)).toEqual(bytes);
      expect(await readFile(source)).toEqual(bytes);
      expect((await lstat(source)).mtimeMs).toBe(before.mtimeMs);
      expect(
        (
          await f.storage.materializeHistorical(legacy, {
            legacyRoot: f.original,
            contentHash: hash,
          })
        ).reused,
      ).toBe(true);
      expect(result).not.toHaveProperty('qc');
      expect(result).not.toHaveProperty('approval');
    } finally {
      await f.close();
    }
  });
  it('rejects wrong bytes without decode or canonical write', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.original, 'sha256', `${hash}.mp4`), 'tampered');
      probe.mockClear();
      await expect(
        f.storage.materializeHistorical(legacy, {
          legacyRoot: f.original,
          contentHash: hash,
        }),
      ).rejects.toThrow('COMPOSER_MEDIA_HASH_MISMATCH');
      expect(probe).not.toHaveBeenCalled();
      await expect(lstat(f.target)).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
  it('does not mask a corrupted historical file with a valid canonical fallback', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.original, 'sha256', `${hash}.mp4`), 'corrupt');
      await mkdir(join(f.original, 'sha256', hash.slice(0, 2)));
      await writeFile(
        join(f.original, 'sha256', hash.slice(0, 2), `${hash}.mp4`),
        bytes,
      );
      await expect(
        f.resolver.resolveHistoricalVideo(legacy, hash),
      ).rejects.toThrow('COMPOSER_MEDIA_HASH_MISMATCH');
    } finally {
      await f.close();
    }
  });
  it('rejects a conflicting destination without overwriting either file', async () => {
    const f = await fixture();
    try {
      const source = join(f.original, 'sha256', `${hash}.mp4`);
      const destination = join(
        f.target,
        'sha256',
        hash.slice(0, 2),
        `${hash}.mp4`,
      );
      await writeFile(source, bytes);
      await mkdir(join(f.target, 'sha256', hash.slice(0, 2)), {
        recursive: true,
      });
      await writeFile(destination, 'conflict');
      await expect(
        f.storage.materializeHistorical(legacy, {
          legacyRoot: f.original,
          contentHash: hash,
        }),
      ).rejects.toThrow();
      expect(await readFile(source)).toEqual(bytes);
      expect(await readFile(destination, 'utf8')).toBe('conflict');
    } finally {
      await f.close();
    }
  });
  it('rejects source symlinks and destination junctions', async () => {
    const f = await fixture();
    try {
      const outside = join(f.root, 'outside');
      await mkdir(outside);
      await writeFile(join(outside, `${hash}.mp4`), bytes);
      await rm(join(f.original, 'sha256'), { recursive: true });
      await symlink(outside, join(f.original, 'sha256'), 'junction');
      await expect(
        f.resolver.resolveHistoricalVideo(legacy, hash),
      ).rejects.toThrow();
      await mkdir(f.target);
      await symlink(outside, join(f.target, 'sha256'), 'junction');
      await expect(f.storage.store(bytes)).rejects.toThrow();
      expect(await readFile(join(outside, `${hash}.mp4`))).toEqual(bytes);
      await expect(lstat(join(outside, hash.slice(0, 2)))).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
});
