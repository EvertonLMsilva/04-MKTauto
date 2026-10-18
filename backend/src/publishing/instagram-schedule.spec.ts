import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { InstagramPublicationRepository } from './infrastructure/instagram-publication.repository.js';
const at = '2026-10-18T12:00:00.000Z',
  later = '2026-10-18T13:00:00.000Z';
let db: DatabaseSync, repo: InstagramPublicationRepository, id: string;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  provisionSchema(db);
  db.exec('PRAGMA foreign_keys=OFF');
  const campaigns = new CampaignRepository(db);
  const e = campaigns.schedule(
    {
      campaignId: 'campaign_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt: at,
    },
    {},
    at,
  );
  id = e.execution_id;
  const c = campaigns.claim(id, at, 60000)!;
  campaigns.ownedEvent(id, c.claim_token!, at, 'STEP_DONE', {
    step: 'HANDOFF',
    result: {
      approvalId: 'approval_fixture',
      videoRenderId: 'render_fixture',
      contentHash: 'a'.repeat(64),
    },
  });
  campaigns.ownedEvent(id, c.claim_token!, at, 'COMPLETED', {}, 'SUCCEEDED');
  repo = new InstagramPublicationRepository(db);
});
afterEach(() => db.close());
const request = () => ({
  packageHash: 'a'.repeat(64),
  accountId: '123456789',
  scheduledAt: later,
  actor: 'operator_fixture',
  reviewHash: 'b'.repeat(64),
});
it('persists a separate authorization and preserves the terminal run under duplicate scheduling', () => {
  repo.schedule(id, request(), at);
  new InstagramPublicationRepository(db).schedule(id, request(), at);
  expect(repo.dueSchedules(at)).toEqual([]);
  expect(repo.dueSchedules(later)).toEqual([id]);
  expect(
    db
      .prepare('SELECT status FROM campaign_executions WHERE execution_id=?')
      .get(id)?.status,
  ).toBe('SUCCEEDED');
  expect(() =>
    repo.schedule(id, { ...request(), scheduledAt: at }, at),
  ).toThrow('SOCIAL_SCHEDULE_CONFLICT');
});
it('fences concurrent claims and permits recovery only after expiry', () => {
  repo.schedule(id, request(), at);
  const first = repo.claimSchedule(id, later)!;
  expect(repo.claimSchedule(id, later)).toBeNull();
  const recovered = new InstagramPublicationRepository(db).claimSchedule(
    id,
    '2026-10-18T13:03:00.000Z',
  )!;
  expect(recovered.claim_token).not.toBe(first.claim_token);
  repo.finishSchedule(
    id,
    first.claim_token,
    'COMPLETED',
    {},
    '2026-10-18T13:03:01.000Z',
  );
  expect(repo.scheduled(id)?.status).toBe('RUNNING');
  repo.finishSchedule(
    id,
    recovered.claim_token,
    'WAITING_RECONCILIATION',
    { code: 'SOCIAL_RECONCILIATION_REQUIRED' },
    '2026-10-18T13:03:02.000Z',
  );
  expect(repo.dueSchedules('2026-10-18T13:03:10.000Z')).toEqual([]);
});
it('cancels pending schedules without deleting authorization history', () => {
  repo.schedule(id, request(), at);
  repo.cancelSchedule(id, at);
  expect(repo.scheduled(id)?.status).toBe('CANCELLED');
  expect(repo.dueSchedules(later)).toEqual([]);
});

it('protects immutable authorization and rejects publication without an active schedule claim', () => {
  repo.schedule(id, request(), at);
  expect(() =>
    db
      .prepare(
        'UPDATE instagram_publication_schedules SET request_json=? WHERE execution_id=?',
      )
      .run('{}', id),
  ).toThrow('IMMUTABLE_INSTAGRAM_SCHEDULE');
  const operation = {
    operationId: 'operation_fixture',
    accountId: request().accountId,
    mediaHash: 'a'.repeat(64),
    packageHash: request().packageHash,
  };
  vi.spyOn(repo, 'reservation').mockReturnValue({
    execution_id: id,
    campaign_id: 'campaign_001',
    artifact_hash: operation.mediaHash,
    package_hash: operation.packageHash,
    destination: 'instagram:' + operation.accountId,
    review_hash: request().reviewHash,
  });
  expect(() => repo.authorize(operation, later)).toThrow(
    'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
  );
  const claim = repo.claimSchedule(id, later)!;
  expect(repo.authorize(operation, later, claim.claim_token)).toBeTruthy();
  expect(() =>
    repo.authorize(
      { ...operation, mediaHash: 'c'.repeat(64) },
      later,
      claim.claim_token,
    ),
  ).toThrow('SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
  expect(() => repo.authorize(operation, later, 'stale_claim')).toThrow(
    'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
  );
});
