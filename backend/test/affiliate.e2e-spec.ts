import { SqliteAffiliateRepository } from '../src/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/project/infrastructure/project-database.config.js';
import { PROJECT_SNAPSHOT_READER } from '../src/project/application/ports/project-snapshot-reader.port.js';
import { AFFILIATE_DATABASE } from '../src/affiliate/infrastructure/affiliate-database.config.js';
import {
  affiliateFixture,
  product,
  campaign,
} from './support/affiliate-fixture.js';

describe('Affiliate HTTP catalog (e2e)', () => {
  let app: INestApplication<App>;
  let fixture: ReturnType<typeof affiliateFixture>;
  beforeEach(async () => {
    fixture = affiliateFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(fixture.database)
      .overrideProvider(AFFILIATE_DATABASE)
      .useValue(fixture.database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    fixture?.cleanup();
  });
  it('creates/replays catalog and reads exact historical revisions', async () => {
    const http = app.getHttpServer();
    const put = { product: product(), idempotencyKey: 'product_one' };
    const first = await request(http)
      .post('/affiliate/products')
      .send(put)
      .expect(201);
    expect(
      (await request(http).post('/affiliate/products').send(put).expect(201))
        .body,
    ).toEqual(first.body);
    const v2 = product({
      revision: 2,
      schemaVersion: 'affiliate-product/2.0.0',
      brand: {
        status: 'DECLARED_UNBRANDED',
        name: null,
        evidenceRef: 'ev_spec',
      },
    });
    await request(http)
      .post('/affiliate/products')
      .send({ product: v2, idempotencyKey: 'product_two' })
      .expect(201);
    expect(
      (
        await request(http)
          .get('/affiliate/products/prod_001/revisions/1')
          .expect(200)
      ).body,
    ).toEqual(product());
    expect(
      (
        await request(http)
          .get('/affiliate/products/prod_001/revisions/2')
          .expect(200)
      ).body,
    ).toEqual(v2);
    const c = campaign({ productRevision: 2 });
    await request(http)
      .post('/affiliate/campaigns')
      .send({ campaign: c, idempotencyKey: 'campaign_one' })
      .expect(201);
    expect(
      (
        await request(http)
          .get('/affiliate/campaigns/camp_001/revisions/1')
          .expect(200)
      ).body,
    ).toEqual(c);
    const b = {
      briefingId: 'brief_001',
      campaignId: 'camp_001',
      campaignRevision: 1,
      idempotencyKey: 'brief_one',
    };
    const saved = (
      await request(http).post('/affiliate/briefings').send(b).expect(201)
    ).body;
    expect(
      (await request(http).post('/affiliate/briefings').send(b).expect(201))
        .body,
    ).toEqual(saved);
    expect(
      (await request(http).get('/affiliate/briefings/brief_001').expect(200))
        .body,
    ).toEqual(saved);
    const reader = new SqliteAffiliateRepository(fixture.database, {
      readOnly: true,
    });
    try {
      expect(reader.getBriefing('brief_001')).toEqual(saved);
    } finally {
      reader.close();
    }
    await request(http)
      .post('/affiliate/campaigns')
      .send({
        campaign: campaign({
          revision: 2,
          productRevision: 2,
          cta: 'Novo CTA',
        }),
        idempotencyKey: 'campaign_two',
      })
      .expect(201);
    expect(
      (await request(http).get('/affiliate/briefings/brief_001').expect(200))
        .body.cta,
    ).toBe(c.cta);
    expect(
      (await request(http).get('/projects/project_001').expect(200)).body
        .project.id,
    ).toBe('project_001');
  });
  it('maps validation, missing references and conflicts with original codes/fields', async () => {
    const http = app.getHttpServer();
    const invalid = await request(http)
      .post('/affiliate/products')
      .send({ product: product({ extra: true }), idempotencyKey: 'invalid' })
      .expect(400);
    expect(invalid.body).toEqual({
      code: 'UNKNOWN_FIELD',
      field: 'product.extra',
    });
    const badRevision = await request(http)
      .get('/affiliate/products/prod_001/revisions/01')
      .expect(400);
    expect(badRevision.body).toEqual({
      code: 'INVALID_AFFILIATE_REVISION',
      field: 'revision',
    });
    await request(http)
      .get('/affiliate/products/missing/revisions/1')
      .expect(404);
    await request(http)
      .post('/affiliate/campaigns')
      .send({
        campaign: campaign({ projectId: 'missing' }),
        idempotencyKey: 'missing_project',
      })
      .expect(404);
    await request(http)
      .post('/affiliate/products')
      .send({ product: product(), idempotencyKey: 'product_one' })
      .expect(201);
    const conflict = await request(http)
      .post('/affiliate/products')
      .send({
        product: product({ name: 'Changed' }),
        idempotencyKey: 'product_one',
      })
      .expect(409);
    expect(conflict.body).toEqual({
      code: 'AFFILIATE_IDEMPOTENCY_CONFLICT',
      field: 'idempotencyKey',
    });
    await request(http)
      .post('/affiliate/products')
      .send({ product: product({ revision: 3 }), idempotencyKey: 'skip' })
      .expect(409);
    await request(http)
      .post('/affiliate/briefings')
      .send({
        briefingId: 'brief_001',
        campaignId: 'missing',
        campaignRevision: 1,
        idempotencyKey: 'missing_brief',
      })
      .expect(404);
  });
  it('sanitizes Project failures and storage faults without partial writes', async () => {
    const reader = app.get<{ get: (id: string) => Promise<unknown> }>(
      PROJECT_SNAPSHOT_READER,
    );
    vi.spyOn(reader, 'get').mockRejectedValueOnce(
      new Error('private path token=secret'),
    );
    const failure = await request(app.getHttpServer())
      .post('/affiliate/campaigns')
      .send({ campaign: campaign(), idempotencyKey: 'campaign_fail' })
      .expect(500);
    expect(failure.body).toEqual({ code: 'AFFILIATE_OPERATION_FAILED' });
    fixture.base.db.exec(
      "CREATE TRIGGER force_failure BEFORE INSERT ON affiliate_commands BEGIN SELECT RAISE(ABORT,'private database path'); END;",
    );
    const storage = await request(app.getHttpServer())
      .post('/affiliate/products')
      .send({ product: product(), idempotencyKey: 'storage_fail' })
      .expect(500);
    expect(storage.body).toEqual({ code: 'AFFILIATE_OPERATION_FAILED' });
    expect(fixture.catalog.getProduct('prod_001', 1)).toBeNull();
    expect(
      fixture.base.db.prepare('SELECT count(*) n FROM affiliate_commands').get()
        .n,
    ).toBe(0);
  });
});
