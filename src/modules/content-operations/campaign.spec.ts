import { DatabaseSync } from 'node:sqlite';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { productionDate } from './domain/campaign.js';

describe('campaign atomic persistence', () => {
  let db: DatabaseSync;
  let r: CampaignRepository;
  const at = '2026-10-15T03:00:00.000Z';
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    provisionSchema(db);
    // Campaign foreign keys are covered by the integration fixture; isolate claims here.
    db.exec('PRAGMA foreign_keys=OFF');
    r = new CampaignRepository(db);
    r.schedule(
      {
        campaignId: 'campaign_001',
        campaignRevision: 1,
        scheduledAt: at,
        runId: 'run_001',
      },
      {},
      at,
    );
  });
  afterEach(() => db.close());
  it('uses Sao Paulo day, including midnight boundary', () => {
    expect(productionDate('2026-10-15T02:59:59Z')).toBe('2026-10-14');
    expect(productionDate(at)).toBe('2026-10-15');
  });
  it('replays exactly, rejects a changed daily request', () => {
    expect(
      r.schedule(
        {
          campaignId: 'campaign_001',
          campaignRevision: 1,
          scheduledAt: at,
          runId: 'run_001',
        },
        {},
        at,
      ).execution_id,
    ).toBe(r.due(at)[0].execution_id);
    expect(() =>
      r.schedule(
        {
          campaignId: 'campaign_001',
          campaignRevision: 2,
          scheduledAt: at,
          runId: 'run_002',
        },
        {},
        at,
      ),
    ).toThrow('CAMPAIGN_DAY_CONFLICT');
  });
  it('keeps the daily slot per campaign and Sao Paulo date', () => {
    const first = r.due(at)[0];
    const other = r.schedule(
      {
        campaignId: 'campaign_002',
        campaignRevision: 1,
        scheduledAt: at,
        runId: 'run_other_campaign',
      },
      {},
      at,
    );
    const nextDay = r.schedule(
      {
        campaignId: 'campaign_001',
        campaignRevision: 1,
        scheduledAt: '2026-10-16T03:00:00Z',
        runId: 'run_next_local_day',
      },
      {},
      at,
    );
    expect(other.execution_id).not.toBe(first.execution_id);
    expect(nextDay.production_date).toBe('2026-10-16');
    expect(r.due('2026-10-16T03:00:00Z')).toHaveLength(3);
  });
  it('claims once and fences expired owners without re-dispatch', () => {
    const id = r.due(at)[0].execution_id;
    const a = r.claim(id, at, 1000)!;
    expect(r.claim(id, at, 1000)).toBeNull();
    r.recover('2026-10-15T03:00:02.000Z');
    expect(r.get(id).status).toBe('WAITING_RECONCILIATION');
    expect(() => r.ownedEvent(id, a.claim_token!, at, 'STEP_DONE', {})).toThrow(
      'CLAIM_LOST',
    );
    expect(r.claim(id, '2026-10-15T03:00:02.000Z', 1000)).toBeNull();
  });
  it('cancels atomically, blocks steps and keeps append-only history', () => {
    const id = r.due(at)[0].execution_id;
    const a = r.claim(id, at, 1000)!;
    r.cancel(id, at);
    expect(() =>
      r.ownedEvent(id, a.claim_token!, at, 'STEP_STARTED', {}),
    ).toThrow('CLAIM_LOST');
    expect(r.get(id).status).toBe('CANCELLED');
    expect(() => db.exec('DELETE FROM campaign_execution_events')).toThrow(
      'IMMUTABLE_CAMPAIGN_EVENT',
    );
  });
});
