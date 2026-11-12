import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import {
  ManualImagePackageService,
  type ManualImageReaders,
} from './application/manual-image-package.service.js';

test.each(['png', 'jpeg'] as const)(
  'read-only native catalog + physical %s preparation needs no video, QC record or approval write',
  async (format) => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Error('EXTERNAL_HTTP_FORBIDDEN'));
    const directory = mkdtempSync(join(tmpdir(), 'manual-image-package-'));
    const f = p2EditorialFixture();
    try {
      const file = join(
        directory,
        'owned.' + (format === 'jpeg' ? 'jpg' : 'png'),
      );
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=90x160',
        '-frames:v',
        '1',
        file,
      ]);
      const bytes = readFileSync(file),
        hash = createHash('sha256').update(bytes).digest('hex');
      const reference = 'media:sha256_' + hash;
      const rights = {
        id: 'image_fixture_right',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:original-color-image',
        recordedAt: '2026-11-12T12:00:00Z',
        mediaAuthorization: {
          mediaRef: reference,
          contentHash: hash,
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders: [],
        },
      };
      const catalog = new SqliteAffiliatePersistence(f.database),
        seed = catalog.open();
      let product: any, campaign: any;
      try {
        const previous = seed.getProduct('prod_001', 1)!;
        product = seed.registerProduct(
          {
            ...previous,
            revision: 2,
            media: [{ mediaRef: reference, evidenceRef: rights.id }],
            evidence: [...previous.evidence, rights],
          },
          'image_fixture_product',
        );
      } finally {
        seed.close();
      }
      const setup = catalog.open();
      try {
        campaign = setup.registerCampaign(
          {
            ...setup.getCampaign('camp_001', 1)!,
            revision: 2,
            productRevision: 2,
          },
          'image_fixture_campaign',
          true,
        );
      } finally {
        setup.close();
      }
      const query = <T>(fn: (r: ReturnType<typeof catalog.open>) => T) => {
        const r = catalog.open(true);
        try {
          return fn(r);
        } finally {
          r.close();
        }
      };
      const input = {
        campaignId: campaign.campaignId,
        campaignRevision: 2,
        campaignHash: affiliateHash(campaign),
        productId: product.productId,
        productRevision: 2,
        productHash: affiliateHash(product),
        projectId: 'project_001',
        projectVersion: 1,
        pipelineRunId: null,
        imageArtifactId: 'image_fixture',
        imageContentHash: hash,
        mediaReference: reference,
        format,
        widthPixels: 90,
        heightPixels: 160,
        destination: 'instagram',
        account: '123456789',
        caption: 'Imagem própria de fixture.',
        externalProvider: null,
      };
      const readers: ManualImageReaders = {
        getCampaign: (id, revision) =>
          query((r) => r.getCampaign(id, revision)),
        getProduct: (id, revision) => query((r) => r.getProduct(id, revision)),
        getProject: () => ({ id: 'project_001', version: 1 }),
        getRun: () => null,
        getImage: () => ({
          imageArtifactId: 'image_fixture',
          imageContentHash: hash,
          mediaReference: reference,
          productId: product.productId,
          productRevision: 2,
          projectId: 'project_001',
          projectVersion: 1,
          format,
          widthPixels: 90,
          heightPixels: 160,
          rightsEvidence: [rights],
        }),
        readImageBytes: (requested) => {
          expect(requested).toBe(reference);
          return readFileSync(file);
        },
        inspectImage: (inputBytes) => {
          execFileSync(
            'ffmpeg',
            [
              '-v',
              'error',
              '-xerror',
              '-err_detect',
              'explode',
              '-i',
              'pipe:0',
              '-f',
              'null',
              '-',
            ],
            { input: inputBytes },
          );
          const decoded = JSON.parse(
            execFileSync(
              'ffprobe',
              ['-v', 'error', '-show_streams', '-of', 'json', 'pipe:0'],
              { input: inputBytes, encoding: 'utf8' },
            ),
          );
          const stream = decoded.streams[0];
          return {
            format: stream.codec_name === 'png' ? 'png' : 'jpeg',
            widthPixels: stream.width,
            heightPixels: stream.height,
            fullyDecoded: true,
          };
        },
        getDestination: () => ({
          destination: 'instagram',
          account: '123456789',
          projectId: 'project_001',
          enabled: true,
        }),
        getImageQc: () => null,
        getImageApproval: () => null,
      };
      const tables = () =>
        f.base.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
          )
          .all()
          .map((r) => ({
            name: r.name,
            rows: f.base.db
              .prepare(
                'SELECT * FROM "' + String(r.name).replaceAll('"', '""') + '"',
              )
              .all(),
          }));
      const before = tables(),
        files = readdirSync(directory);
      const first = await new ManualImagePackageService(readers).prepare(input);
      expect(first.status).toBe('PREPARED');
      expect(first.package).toMatchObject({
        schemaVersion: 'manual-image-package/1.0.0',
        imageContentHash: hash,
        format,
        qualityControl: { status: 'IMAGE_QC_REQUIRED' },
        review: { status: 'HUMAN_APPROVAL_REQUIRED' },
      });
      expect(first.publicationAuthorized).toBe(false);
      expect(
        await new ManualImagePackageService(readers).prepare(input),
      ).toEqual(first);
      expect(tables()).toEqual(before);
      expect(readdirSync(directory)).toEqual(files);
      expect(readFileSync(file)).toEqual(bytes);
      expect(JSON.stringify(first)).not.toContain(directory);
      expect(network).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
      rmSync(directory, { recursive: true, force: true });
      network.mockRestore();
    }
  },
  20000,
);
