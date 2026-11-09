import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { createProjectSnapshot } from '../project/domain/project-contracts.js';
import { createHash } from 'node:crypto';
import { validateCostEvent } from '../finance/domain/cost-event-contracts.js';

const directory = fileURLToPath(
  new URL('../../../src/db/migrations/', import.meta.url),
);
const historical = (name: string) =>
  readFileSync(`${directory}/${name}.sql`, 'utf8');

describe('preserve both applied 031/032 histories', () => {
  it('rejects damaged complementary schema without rewriting history', async () => {
    const { provisionSchema } = await import('./schema-provisioner.js');
    const db = new DatabaseSync(':memory:');
    try {
      provisionSchema(db);
      const before = db
        .prepare('SELECT * FROM schema_migrations ORDER BY version')
        .all();
      db.exec('DROP TRIGGER fal_generation_identity_immutable');
      expect(() => provisionSchema(db)).toThrow(
        'SCHEMA_EXTENSION_INCOMPATIBLE',
      );
      expect(
        db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
      ).toEqual(before);
    } finally {
      db.close();
    }
  });
  it.each([
    ['fal', 31],
    ['fal', 32],
    ['nestjs', 31],
    ['nestjs', 32],
  ] as const)(
    'reconciles %s history at %s without rewriting its rows',
    async (lineage, historicalVersion) => {
      const { provisionSchema } = await import('./schema-provisioner.js');
      const db = new DatabaseSync(':memory:');
      try {
        provisionSchema(db, 30);
        const names =
          lineage === 'fal'
            ? ['031_fal_generations', '032_fal_financial_settlements']
            : ['031_video_generation_budget', '032_video_generation_billing'];
        names.slice(0, historicalVersion - 30).forEach((name, index) => {
          db.exec(historical(name));
          db.prepare(
            'INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',
          ).run(index + 31, name, 'historical-stamp');
        });
        db.exec(`PRAGMA user_version=${historicalVersion}`);
        db.exec(
          "INSERT INTO trend_runs VALUES('preserved','1','COMPLETED','old','old','1','{}')",
        );
        let jobsBefore: unknown[] = [];
        if (lineage === 'fal') {
          const stamp = '2026-10-11T12:00:00Z';
          const snapshot = createProjectSnapshot({
            id: 'project_001',
            version: 1,
            name: 'Historical',
            niche: 'Technology',
            subniches: [],
            audience: { profile: 'Adults', language: 'pt-BR' },
            references: [],
            channel: {
              publishing: {
                contentsPerDay: 1,
                networks: ['instagram'],
                timezone: 'America/Sao_Paulo',
                times: ['10:00'],
              },
            },
          });
          db.prepare('INSERT INTO projects VALUES(?,1,NULL,?,?)').run(
            'project_001',
            stamp,
            stamp,
          );
          db.prepare('INSERT INTO project_snapshots VALUES(?,1,?,?,?)').run(
            'project_001',
            snapshot.schemaVersion,
            JSON.stringify(snapshot),
            stamp,
          );
          db.prepare(
            "INSERT INTO pipeline_runs VALUES(?,?,?,?,?,?,'RUNNING',?,NULL,NULL)",
          ).run(
            'historical_run',
            'pipeline-run/1.0.0',
            'a'.repeat(64),
            'project_001',
            1,
            JSON.stringify(snapshot),
            stamp,
          );
          db.prepare(
            "INSERT INTO pipeline_run_transitions(pipeline_run_id,previous_state,next_state,changed_at,error_json) VALUES(?,NULL,'RUNNING',?,NULL)",
          ).run('historical_run', stamp);
          const basis = { pipelineRunId: 'historical_run' };
          const key = affiliateHash(basis);
          db.prepare(
            "INSERT INTO fal_generations(generation_key,pipeline_run_id,basis_json,state,request_id,estimate_amount,currency,estimate_source,created_at,updated_at) VALUES(?,?,?,'RECONCILIATION_PENDING',?,'0.8','USD','historical/1',?,?)",
          ).run(
            key,
            'historical_run',
            JSON.stringify(basis),
            'historical_request',
            stamp,
            stamp,
          );
          db.prepare('INSERT INTO fal_generation_requests VALUES(?,?,?)').run(
            'historical_acquisition',
            key,
            'b'.repeat(64),
          );
          jobsBefore = db.prepare('SELECT * FROM fal_generations').all();
          const cost = validateCostEvent({
            schemaVersion: 'cost-event/1.0.0',
            costEventId: `cost:fal:${key}`,
            category: 'media_cost',
            pipelineRunId: 'historical_run',
            projectId: 'project_001',
            projectVersion: 1,
            contentIdentity: null,
            artifactId: null,
            amount: '0.10',
            currency: 'USD',
            occurredAt: stamp,
            origin: 'invoice/1.0.0',
            attributionRuleVersion: 'fal-observed-cost/1.0.0',
            recordedAt: stamp,
          });
          db.prepare(
            'INSERT INTO cost_events(cost_event_id,schema_version,identity_hash,category,pipeline_run_id,project_id,project_version,content_identity,artifact_id,amount,currency,occurred_at,origin,attribution_rule_version,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).run(
            cost.costEventId,
            cost.schemaVersion,
            createHash('sha256').update(JSON.stringify(cost)).digest('hex'),
            cost.category,
            cost.pipelineRunId,
            cost.projectId,
            cost.projectVersion,
            cost.contentIdentity,
            cost.artifactId,
            cost.amount,
            cost.currency,
            cost.occurredAt,
            cost.origin,
            cost.attributionRuleVersion,
            cost.recordedAt,
          );
        }
        const before = db
          .prepare('SELECT * FROM schema_migrations ORDER BY version')
          .all();
        const dataBefore = db.prepare('SELECT * FROM trend_runs').all();
        const costsBefore = db
          .prepare('SELECT * FROM cost_events ORDER BY cost_event_id')
          .all();
        provisionSchema(db);
        expect(
          db
            .prepare('SELECT * FROM schema_migrations ORDER BY version')
            .all()
            .slice(0, historicalVersion),
        ).toEqual(before);
        expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(43);
        expect(db.prepare('SELECT * FROM trend_runs').all()).toEqual(
          dataBefore,
        );
        if (lineage === 'fal') {
          expect(db.prepare('SELECT * FROM fal_generations').all()).toEqual(
            jobsBefore,
          );
          expect(
            db
              .prepare(
                'SELECT acquisition_request_id FROM fal_generation_requests',
              )
              .get()?.acquisition_request_id,
          ).toBe('historical_acquisition');
        }
        for (const table of [
          'affiliate_campaign_sources_v1',
          'fal_generations',
          'fal_financial_settlements',
          'video_generation_operations',
          'video_generation_billing',
        ])
          expect(
            db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)
              ?.name,
          ).toBe(table);
        expect(
          db.prepare('SELECT * FROM cost_events ORDER BY cost_event_id').all(),
        ).toEqual(costsBefore);
        const schema = db
          .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name')
          .all();
        const history = db
          .prepare('SELECT * FROM schema_migrations ORDER BY version')
          .all();
        provisionSchema(db);
        expect(
          db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
        ).toEqual(history);
        expect(
          db
            .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name')
            .all(),
        ).toEqual(schema);
      } finally {
        db.close();
      }
    },
  );
});
