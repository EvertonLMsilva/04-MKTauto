import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ManualImageReviewRepository } from './infrastructure/manual-image-review.repository.js';
import {
  ManualImageReviewService,
  type ManualImageReviewRequest,
} from './application/manual-image-review.service.js';

test.each(['missing', 'selfDeclared', 'unauthorized'])(
  'requires trusted authenticated authority: %s',
  async (kind) => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        readFileSync(
          new URL(
            '../../infrastructure/database/migrations/manual_image_review_v1.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const packages = { prepare: vi.fn() },
        qc = { inspect: vi.fn() };
      const authority =
        kind === 'missing'
          ? undefined
          : {
              authorize: vi.fn(() => {
                throw Error('NOT_AUTHENTICATED');
              }),
            };
      const service = new ManualImageReviewService({
        packages,
        qc,
        repository: new ManualImageReviewRepository(db),
        authority,
      });
      const request: ManualImageReviewRequest = {
        idempotencyKey: 'fixture_key',
        expectedPackageHash: 'a'.repeat(64),
        expectedReviewRevision: 0,
        decision: 'APPROVED',
        reason: null,
        input: {
          campaignId: 'campaign',
          campaignRevision: 1,
          campaignHash: 'b'.repeat(64),
          productId: 'product',
          productRevision: 1,
          productHash: 'c'.repeat(64),
          projectId: 'project',
          projectVersion: 1,
          pipelineRunId: null,
          imageArtifactId: 'image',
          imageContentHash: 'd'.repeat(64),
          mediaReference: 'media:fixture',
          format: 'png',
          widthPixels: 90,
          heightPixels: 160,
          destination: 'instagram',
          account: '123456789',
          caption: 'Fixture only',
          externalProvider: null,
        },
      };
      await expect(
        service.decide(request, {
          actorId: 'self_declared',
          authenticated: true,
          authorized: true,
        }),
      ).rejects.toThrow('HUMAN_REVIEW_AUTHORITY_REQUIRED');
      expect(packages.prepare).not.toHaveBeenCalled();
      expect(qc.inspect).not.toHaveBeenCalled();
      expect(
        db
          .prepare('SELECT count(*) AS n FROM manual_image_review_decisions_v1')
          .get()?.n,
      ).toBe(0);
    } finally {
      db.close();
    }
  },
);
