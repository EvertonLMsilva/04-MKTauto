import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  ManualImageQcService,
  type ImageQcDecoder,
} from './application/manual-image-qc.service.js';
import {
  ManualImagePackageService,
  type ManualImageReaders,
} from './application/manual-image-package.service.js';
import { validateManualImageQcBundle } from './domain/manual-image-qc-contracts.js';
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG,
  ffprobe = process.env.MKTAUTO_TEST_FFPROBE;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// Explicit local opt-in. Synthetic images and provenance are exclusively tests.
describe.skipIf(!ffmpeg || !ffprobe).each(['png', 'jpeg'] as const)(
  'physical %s technical QC fixture',
  (format) => {
    let bytes: Buffer;
    const decoder: ImageQcDecoder = {
      id: 'fixture_local_ffmpeg',
      version: 'local-ffmpeg-rgba/1',
      decode(input) {
        const probe = JSON.parse(
          execFileSync(
            ffprobe!,
            [
              '-v',
              'error',
              '-count_frames',
              '-show_streams',
              '-of',
              'json',
              'pipe:0',
            ],
            { input, encoding: 'utf8' },
          ),
        );
        const stream = probe.streams[0];
        if (!stream || !['png', 'mjpeg'].includes(stream.codec_name))
          throw Error('UNSUPPORTED_IMAGE');
        const rgba = execFileSync(
          ffmpeg!,
          [
            '-v',
            'error',
            '-xerror',
            '-err_detect',
            'explode',
            '-i',
            'pipe:0',
            '-pix_fmt',
            'rgba',
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          {
            input,
            maxBuffer: 8 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        return {
          format: stream.codec_name === 'png' ? 'png' : 'jpeg',
          widthPixels: stream.width as number,
          heightPixels: stream.height as number,
          fullyDecoded: true,
          frameCount: Number(stream.nb_read_frames),
          rgba,
        };
      },
    };
    beforeAll(() => {
      bytes = execFileSync(ffmpeg!, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=90x160',
        '-frames:v',
        '1',
        '-c:v',
        format === 'png' ? 'png' : 'mjpeg',
        '-f',
        'image2pipe',
        'pipe:1',
      ]);
    });
    function physicalFixture(image: Buffer) {
      const hash = sha256(image),
        mediaReference = 'media:sha256_' + hash;
      const rights = {
        id: 'fixture_image_right',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:original-synthetic-image',
        recordedAt: '2026-11-12T12:00:00Z',
        mediaAuthorization: {
          mediaRef: mediaReference,
          contentHash: hash,
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders: [],
        },
      };
      const product = fixtures.product({
        media: [{ mediaRef: mediaReference, evidenceRef: rights.id }],
        evidence: [...fixtures.product().evidence, rights],
      });
      const campaign = fixtures.campaign();
      const identity = {
        imageArtifactId: 'fixture_image',
        imageContentHash: hash,
        productId: product.productId as string,
        productRevision: product.revision as number,
        mediaReference,
        format,
        widthPixels: 90,
        heightPixels: 160,
      };
      const provenance = {
        ...identity,
        schemaVersion: 'manual-image-provenance/1.0.0',
        sourceId: 'fixture_owned_images',
        contentHash: '',
      };
      provenance.contentHash = affiliateHash(provenance);
      const artifact = {
        ...identity,
        provenanceReference:
          'image-provenance:sha256:' + provenance.contentHash,
      };
      const readers = {
        getArtifact: () => artifact,
        getProvenance: () => provenance,
        readBytes: () => image,
      };
      const request = {
        imageArtifactId: identity.imageArtifactId,
        imageContentHash: hash,
        productId: identity.productId,
        productRevision: identity.productRevision,
      };
      return {
        service: new ManualImageQcService(readers, {
          trustedSourceIds: ['fixture_owned_images'],
          decoder,
        }),
        request,
        product,
        campaign,
        rights,
        identity,
      };
    }
    test('complete local decode yields verifiable evidence consumed by the unchanged image package; human approval remains required', async () => {
      const f = physicalFixture(bytes);
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(Error('NETWORK_FORBIDDEN'));
      try {
        const before = Buffer.from(bytes),
          sourceBefore = affiliateHash(f.product);
        const result = await f.service.inspect(f.request);
        expect(result.status).toBe('PASS');
        const bundle = validateManualImageQcBundle(
          JSON.parse(JSON.stringify(result.bundle)),
        );
        expect(bundle.inspection.pixelContentHash).toBe(
          sha256((await decoder.decode(bytes)).rgba),
        );
        expect(bundle.report.imageContentHash).toBe(sha256(bytes));
        expect(await f.service.inspect(f.request)).toEqual(result);
        const packageReaders: ManualImageReaders = {
          getProduct: () => f.product,
          getCampaign: () => f.campaign,
          getProject: () => ({
            id: f.campaign.projectId as string,
            version: 1,
          }),
          getRun: () => null,
          getImage: () => ({
            ...f.identity,
            projectId: f.campaign.projectId as string,
            projectVersion: 1,
            rightsEvidence: [f.rights],
          }),
          readImageBytes: () => bytes,
          inspectImage: (b) => decoder.decode(b),
          getDestination: () => ({
            destination: 'instagram',
            account: '123456789',
            projectId: f.campaign.projectId as string,
            enabled: true,
          }),
          getImageQc: () => bundle.report,
          getImageApproval: () => null,
        };
        const input = {
          ...f.identity,
          campaignId: f.campaign.campaignId,
          campaignRevision: f.campaign.revision,
          campaignHash: affiliateHash(f.campaign),
          productHash: affiliateHash(f.product),
          projectId: f.campaign.projectId,
          projectVersion: 1,
          pipelineRunId: null,
          destination: 'instagram',
          account: '123456789',
          caption: 'Fixture de imagem sintética autorizada apenas para testes.',
          externalProvider: null,
        };
        const prepared = await new ManualImagePackageService(
          packageReaders,
        ).prepare(input);
        expect(prepared.package?.qualityControl.status).toBe('PASS');
        expect(prepared.package?.qualityControl.contentHash).toBe(
          bundle.report.contentHash,
        );
        expect(prepared.blockers.map((b) => b.code)).toEqual([
          'HUMAN_APPROVAL_REQUIRED',
        ]);
        expect(prepared.publicationAuthorized).toBe(false);
        expect(prepared.package?.review.status).toBe('HUMAN_APPROVAL_REQUIRED');
        expect(bytes).toEqual(before);
        expect(affiliateHash(f.product)).toBe(sourceBefore);
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
      }
    });
    test.each(['truncated', 'malformed'])(
      'no PASS for a physically %s file even with matching source hashes',
      async (kind) => {
        const invalid =
          kind === 'truncated'
            ? bytes.subarray(0, Math.floor(bytes.length / 2))
            : Buffer.from([255, 216, 255, 217]);
        const f = physicalFixture(invalid);
        const result = await f.service.inspect(f.request);
        expect(result.status).not.toBe('PASS');
        expect(result.bundle).toBeNull();
      },
    );
  },
);
