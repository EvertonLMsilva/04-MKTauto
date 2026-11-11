import { batch } from '../../../test/support/research-catalog-fixture.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { provisionSchema } from './schema-provisioner.js';
import { provisionTtsReadiness } from './tts-readiness.js';
import { validateConfiguration, bootstrap } from '../../bootstrap.js';
import { FinanceDatabase } from '../../modules/finance/infrastructure/finance.database.js';
import { CampaignAdministration } from '../../modules/content-operations/application/campaign-administration.js';
import { SqliteProjectRepository } from '../../modules/project/infrastructure/sqlite-project.repository.js';
import { SqliteResearchRepository } from '../../modules/research/infrastructure/sqlite-research.repository.js';
import { ContentDatabase } from '../../modules/content/infrastructure/content-database.js';
import { MediaDatabase } from '../../modules/media/infrastructure/media-database.js';
import { SqliteAffiliateRepository } from '../../modules/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { product, campaign } from '../../../test/support/affiliate-fixture.js';
const { project } = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
function fixture(version: number) {
  const dir = mkdtempSync(join(tmpdir(), 'mktauto-runtime44-')),
    path = join(dir, 'test.sqlite'),
    db = new DatabaseSync(path);
  provisionSchema(db, Math.min(version, 43));
  if (version >= 39) {
    const p = new SqliteProjectRepository(path);
    try {
      p.create(project());
    } finally {
      p.close();
    }
    const a = new SqliteAffiliateRepository(path);
    try {
      a.registerProduct(product(), 'seed_product');
      a.registerCampaign(campaign(), 'seed_campaign', true);
    } finally {
      a.close();
    }
    db.prepare(
      'INSERT INTO video_generation_campaign_budgets VALUES(?,?,?,?)',
    ).run('camp_001', 1, 'project_001', '{}');
  }
  if (version === 44) provisionSchema(db, 44);
  if (version === 45) db.exec('PRAGMA user_version=45');
  return {
    dir,
    path,
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}
const noop = { get: () => null } as any;
const checks = [
  {
    name: 'Finance',
    min: 39,
    error: 'FINANCE_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const s = new FinanceDatabase(f.path);
      try {
        expect(s.get('project_001')).not.toBeNull();
      } finally {
        s.close();
      }
    },
  },
  {
    name: 'Bootstrap',
    min: 41,
    error: 'SCHEMA_41_REQUIRED',
    run: async (f: any) => {
      expect(
        validateConfiguration({ PROJECT_API_DATABASE: f.path, PORT: '0' }),
      ).toEqual({ port: 0 });
    },
  },
  {
    name: 'CampaignAdministration',
    min: 41,
    error: 'CAMPAIGN_SCHEMA_41_REQUIRED',
    run: async (f: any) => {
      const s = new CampaignAdministration(f.path, {} as any, false);
      try {
        expect(s.list()).toEqual([]);
      } finally {
        await s.onModuleDestroy();
      }
    },
  },
  {
    name: 'Project',
    min: 39,
    error: 'PROJECT_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const s = new SqliteProjectRepository(f.path);
      try {
        const created = s.create(project({ id: 'project_schema44' }));
        expect(s.get('project_schema44', 1)).toEqual(created);
      } finally {
        s.close();
      }
    },
  },
  {
    name: 'Research',
    min: 39,
    error: 'RESEARCH_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const s = new SqliteResearchRepository(f.path);
      try {
        expect(s.getRun('not_recorded')).toBeNull();
        const operation = batch({
          key: 'schema44_research',
          at: '2026-11-09T00:00:00Z',
          views: 100,
        });
        const saved = s.recordOperation(operation);
        expect(s.recordOperation(operation)).toEqual(saved);
        expect(s.getRun(operation.run.id)).toEqual(saved);
      } finally {
        s.close();
      }
    },
  },
  {
    name: 'Content',
    min: 39,
    error: 'CONTENT_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const s = new ContentDatabase(f.path, noop, {} as any);
      try {
        expect(s.getRun('not_recorded')).toBeNull();
        expect(s.db.prepare('SELECT count(*) n FROM scripts').get()?.n).toBe(0);
      } finally {
        s.close();
      }
    },
  },
  {
    name: 'Media',
    min: 39,
    error: 'MEDIA_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const s = new MediaDatabase(f.path, noop, {
        getScript: () => null,
      } as any);
      try {
        expect(s.getRun('not_recorded')).toBeNull();
        expect(
          s.db.prepare('SELECT count(*) n FROM p4_artifacts').get()?.n,
        ).toBe(0);
      } finally {
        s.close();
      }
    },
  },
  {
    name: 'TTSReadiness',
    min: 40,
    error: 'TTS_SCHEMA_VERSION_UNSUPPORTED',
    run: async (f: any) => {
      const result = await provisionTtsReadiness(
        f.path,
        join(f.dir, 'backup.sqlite'),
        'camp_001',
      );
      expect(result.protectedTablesUnchanged).toBe(true);
    },
  },
];
for (const c of checks) {
  describe(c.name, () => {
    test.each([...new Set([c.min, 43, 44])])(
      'accepts schema %s without changing schema history',
      async (v) => {
        const f = fixture(v);
        try {
          const history = f.db.prepare('SELECT * FROM schema_migrations').all();
          await c.run(f);
          expect(f.db.prepare('SELECT * FROM schema_migrations').all()).toEqual(
            history,
          );
          expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        } finally {
          f.close();
        }
      },
    );
    test.each([c.min - 1, 45])('rejects unvalidated schema %s', async (v) => {
      const f = fixture(v);
      try {
        await expect(c.run(f)).rejects.toThrow(c.error);
      } finally {
        f.close();
      }
    });
  });
}
test('migration 44 leaves every non-Publishing table, SQL object and row unchanged', () => {
  const f = fixture(43);
  try {
    const objects = () =>
      f.db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE 'social_publication_%' AND tbl_name NOT LIKE 'publication_%' AND name NOT LIKE 'publication_%' ORDER BY name",
        )
        .all();
    const before = objects();
    const names = f.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','social_publication_operations')",
      )
      .all();
    const rows = () =>
      Object.fromEntries(
        names.map((t) => [
          String(t.name),
          f.db.prepare('SELECT * FROM ' + t.name + ' ORDER BY rowid').all(),
        ]),
      );
    const data = rows();
    provisionSchema(f.db, 44);
    expect(objects()).toEqual(before);
    expect(rows()).toEqual(data);
    expect(f.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
  } finally {
    f.close();
  }
});
test('schema 44 initializes Nest modules and HTTP locally without external calls', async () => {
  const f = fixture(44);
  let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
  const original = globalThis.fetch;
  const calls: any[] = [];
  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const u = new URL(String(input));
    if (
      u.hostname !== '127.0.0.1' &&
      u.hostname !== 'localhost' &&
      u.hostname !== '[::1]'
    ) {
      calls.push(u.hostname);
      throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    }
    return original(input, init);
  });
  try {
    for (const [k, v] of Object.entries({
      PROJECT_API_DATABASE: f.path,
      SOCIAL_HISTORY_DATABASE: f.path,
      PORT: '0',
      CAMPAIGN_SCHEDULER_ENABLED: 'false',
      INSTAGRAM_SCHEDULER_ENABLED: 'false',
      FACEBOOK_PUBLICATION_MODE: '',
      INSTAGRAM_PUBLICATION_MODE: '',
      FACEBOOK_LIVE_POSTS_ENABLED: 'false',
      INSTAGRAM_LIVE_POSTS_ENABLED: 'false',
      OPERATIONAL_NOTIFICATIONS_ENABLED: 'false',
      DISCORD_NOTIFICATIONS_ENABLED: 'false',
    }))
      vi.stubEnv(k, v);
    app = await bootstrap({ PROJECT_API_DATABASE: f.path, PORT: '0' });
    const url = await app.getUrl();
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url + '/finance/usage')).status).toBe(200);
    expect(calls).toEqual([]);
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await app?.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    f.close();
  }
});
