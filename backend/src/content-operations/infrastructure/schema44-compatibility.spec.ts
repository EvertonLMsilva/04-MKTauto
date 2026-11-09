import { SqliteProjectRepository } from '../../project/infrastructure/sqlite-project.repository.js';
const { project } = await import(
  new URL('../../../../test/affiliate-fixtures.js', import.meta.url).href
);
import { product, campaign } from '../../../test/support/affiliate-fixture.js';
import { SqliteAffiliateRepository } from '../../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { provisionSchema } from '../../administration/schema-provisioner.js';
import { SqliteCampaignOperationsPersistence } from './campaign-operations.persistence.js';
function fixture(version: number) {
  const dir = mkdtempSync(join(tmpdir(), 'mktauto-campaign-schema44-')),
    path = join(dir, 'isolated.sqlite'),
    db = new DatabaseSync(path);
  provisionSchema(db, version);
  return {
    path,
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}
test.each([41, 42, 43, 44])(
  'Content Operations accepts schema %s and reads historical contract',
  (v) => {
    const f = fixture(v);
    try {
      const s = new SqliteCampaignOperationsPersistence(f.path).open();
      try {
        expect(s.repository.operationalExecutions()).toEqual([]);
      } finally {
        s.close();
      }
    } finally {
      f.cleanup();
    }
  },
);
test.each([40, 45])('Content Operations rejects schema %s', (v) => {
  const f = fixture(v === 45 ? 43 : v);
  try {
    if (v === 45) f.db.exec('PRAGMA user_version=45');
    expect(() =>
      new SqliteCampaignOperationsPersistence(f.path).open(),
    ).toThrow('CAMPAIGN_SCHEMA_41_REQUIRED');
  } finally {
    f.cleanup();
  }
});
test('schema 44 preserves campaign SQL objects, rows and history; scheduling remains idempotent', () => {
  const f = fixture(43);
  const projects = new SqliteProjectRepository(f.path);
  try {
    projects.create(project());
  } finally {
    projects.close();
  }
  const catalog = new SqliteAffiliateRepository(f.path);
  try {
    catalog.registerProduct(product(), 'compat_product');
    catalog.registerCampaign(campaign(), 'compat_campaign', true);
  } finally {
    catalog.close();
  }
  const input = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'schema44_run',
      scheduledAt: '2026-11-09T13:00:00Z',
    },
    request = { fixture: true };
  try {
    let session = new SqliteCampaignOperationsPersistence(f.path).open();
    let old;
    try {
      old = session.repository.schedule(input, request, '2026-11-09T12:00:00Z');
    } finally {
      session.close();
    }
    const objects = () =>
      f.db
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE tbl_name IN ('campaign_executions','campaign_execution_events') ORDER BY name",
        )
        .all();
    const before = objects(),
      rows = f.db.prepare('SELECT * FROM campaign_executions').all(),
      history = f.db.prepare('SELECT * FROM campaign_execution_events').all();
    provisionSchema(f.db, 44);
    expect(objects()).toEqual(before);
    expect(f.db.prepare('SELECT * FROM campaign_executions').all()).toEqual(
      rows,
    );
    expect(
      f.db.prepare('SELECT * FROM campaign_execution_events').all(),
    ).toEqual(history);
    session = new SqliteCampaignOperationsPersistence(f.path).open();
    try {
      expect(session.repository.get(old.execution_id)).toEqual(old);
      expect(
        session.repository.schedule(input, request, '2026-11-09T12:01:00Z'),
      ).toEqual(old);
      const next = session.repository.schedule(
        {
          ...input,
          runId: 'schema44_second',
          scheduledAt: '2026-11-10T13:00:00Z',
        },
        request,
        '2026-11-09T12:01:00Z',
      );
      expect(next.execution_id).not.toBe(old.execution_id);
      expect(
        session.repository.operationalHistory(next.execution_id),
      ).toHaveLength(1);
    } finally {
      session.close();
    }
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(f.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
  } finally {
    f.cleanup();
  }
});
