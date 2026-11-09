import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignOrchestrationModule } from './campaign-orchestration.module.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';

test('local API owns identities, binds real catalog/run records, returns the package and replays without inference', async () => {
  const f = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
  provisionSchema(f.base.db);
  vi.stubEnv('PROJECT_API_DATABASE', f.database);
  vi.stubEnv('SOCIAL_HISTORY_DATABASE', f.database);
  vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
  vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
  const provider = new FakeEditorialProvider(),
    generate = vi.spyOn(provider, 'script');
  const image = { mediaAssetId: 'image_fixture', contentHash: 'a'.repeat(64) };
  const local = {
    prepareImage: vi.fn(() => image),
    automaticAudio: vi.fn(async () => {
      throw Object.assign(new Error('LOCAL_TTS_CONFIGURATION_REQUIRED'), {
        code: 'LOCAL_TTS_CONFIGURATION_REQUIRED',
      });
    }),
    authorizedAudio: () => null,
    automaticAudioReady: () => false,
  };
  const module = await Test.createTestingModule({
    imports: [CampaignOrchestrationModule],
  })
    .overrideProvider(EDITORIAL_PROVIDER)
    .useValue(provider)
    .overrideProvider(LocalFlowService)
    .useValue(local)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    const input = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'local_request_001',
      requestedAt: '2026-10-18T00:00:00Z',
      localImage: { mediaReference: 'authorized-image-001' },
    };
    const endpoint = '/content-operations/campaign-executions';
    const { body: first } = await request(app.getHttpServer())
      .post(endpoint + '/local')
      .send(input)
      .expect(201);
    await module.get(CampaignAdministration).tick();
    const { body: result } = await request(app.getHttpServer())
      .get(endpoint + '/' + first.execution_id + '/result')
      .expect(200);
    expect(result.script.pipelineRunId).toBe(first.run_id);
    expect(result.cta).toBe('Confira pelo link');
    expect(result.affiliateUrl).toContain('example.com/item');
    expect(result.publication).toBe('NOT_REQUESTED');
    expect(local.automaticAudio).toHaveBeenCalledTimes(1);
    const { body: replay } = await request(app.getHttpServer())
      .post(endpoint + '/local')
      .send(input)
      .expect(201);
    expect(replay.execution_id).toBe(first.execution_id);
    await module.get(CampaignAdministration).tick();
    expect(generate).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer())
      .post(endpoint + '/local')
      .send({ ...input, localImage: { mediaReference: 'changed' } })
      .expect(409);
    const db = new DatabaseSync(f.database, { readOnly: true });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM voice_tracks').get()?.n).toBe(
      0,
    );
    db.close();
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    f.cleanup();
  }
});
