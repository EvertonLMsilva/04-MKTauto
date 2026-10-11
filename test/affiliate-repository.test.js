import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PipelineRunRepository } from '../src/pipeline-run-repository.js';
import { AffiliateRepository } from '../src/affiliate-repository.js';
import { product, campaign, project, startRun } from './affiliate-fixtures.js';

function withCatalog(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-'));
  const path = join(dir, 'catalog.sqlite');
  const base = new PipelineRunRepository(path);
  try { base.create(project()); callback(new AffiliateRepository(base), base, path); }
  finally { base.close(); rmSync(dir, { recursive: true, force: true }); }
}
const code = expected => error => error.code === expected;

test('cadastro idempotente, revisões consecutivas, conflitos e reabertura preservam dados exatos', () => {
  withCatalog((catalog, base, path) => {
    const p = catalog.registerProduct(product(), 'create_prod');
    assert.deepEqual(catalog.registerProduct(product(), 'create_prod'), p);
    assert.deepEqual(catalog.registerProduct(product(), 'same_revision'), p);
    assert.throws(() => catalog.registerProduct(product({ name: 'Outro' }), 'create_prod'), code('AFFILIATE_IDEMPOTENCY_CONFLICT'));
    assert.throws(() => catalog.registerProduct(product({ name: 'Outro' }), 'other_key'), code('AFFILIATE_REVISION_CONFLICT'));
    assert.throws(() => catalog.registerProduct(product({ revision: 3 }), 'skip_revision'), code('AFFILIATE_REVISION_CONFLICT'));
    catalog.registerProduct(product({ revision: 2, name: 'Nome novo' }), 'version_prod');
    const c = catalog.registerCampaign(campaign(), 'create_campaign');
    assert.deepEqual(catalog.registerCampaign(campaign(), 'create_campaign'), c);
    const brief = catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'create_brief');
    assert.deepEqual(catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'create_brief'), brief);
    const run = startRun(base);
    const binding = catalog.bindRun({ pipelineRunId: run.pipelineRunId, briefingId: brief.briefingId }, 'bind_run');
    assert.deepEqual(catalog.bindRun({ pipelineRunId: run.pipelineRunId, briefingId: brief.briefingId }, 'bind_run'), binding);
    catalog.registerCampaign(campaign({ revision: 2, cta: 'CTA novo', productRevision: 2 }), 'version_campaign');
    const reopenedBase = new PipelineRunRepository(path);
    try {
      const reopened = new AffiliateRepository(reopenedBase);
      assert.deepEqual(reopened.getProduct('prod_001', 1), p);
      assert.deepEqual(reopened.getCampaign('camp_001', 1), c);
      assert.deepEqual(reopened.getBriefing('brief_001'), brief);
      assert.deepEqual(reopened.getRunBinding('run_001'), binding);
      assert.deepEqual(reopened.resolveRunBriefing('run_001'), brief);
      assert.equal(reopenedBase.db.prepare('SELECT COUNT(*) AS n FROM pipeline_runs').get().n, 1);
    } finally { reopenedBase.close(); }
  });
});

test('referências inválidas e falha transacional não deixam campanha/vínculo/chave parcial', () => {
  withCatalog((catalog, base) => {
    for (const c of [campaign(), campaign({ projectId: 'project_missing' })]) {
      assert.throws(() => catalog.registerCampaign(c, 'bad_campaign'));
    }
    assert.equal(base.db.prepare('SELECT COUNT(*) AS n FROM affiliate_campaign_revisions').get().n, 0);
    assert.equal(base.db.prepare('SELECT COUNT(*) AS n FROM affiliate_commands').get().n, 0);
    catalog.registerProduct(product(), 'create_prod');
    assert.throws(() => catalog.registerCampaign(campaign({ projectId: 'project_missing' }), 'bad_project'), code('PROJECT_NOT_FOUND'));
    catalog.registerCampaign(campaign(), 'create_campaign');
    catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief');
    base.create(project({ id: 'project_other' })); startRun(base, 'run_other', 'project_other');
    assert.throws(() => catalog.bindRun({ pipelineRunId: 'run_other', briefingId: 'brief_001' }, 'bad_bind'), code('AFFILIATE_RUN_SCOPE_MISMATCH'));
    startRun(base);
    base.db.exec("CREATE TRIGGER force_command_failure BEFORE INSERT ON affiliate_commands WHEN NEW.idempotency_key = 'rollback' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
    assert.throws(() => catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'rollback'));
    assert.equal(catalog.getRunBinding('run_001'), null);
    assert.throws(() => catalog.registerProduct(product({ revision: 2 }), 'rollback'));
    assert.equal(catalog.getProduct('prod_001', 2), null);
    assert.throws(() => catalog.registerCampaign(campaign({ revision: 2 }), 'rollback'));
    assert.equal(catalog.getCampaign('camp_001', 2), null);
  });
});

test('SQL impede update/delete de revisões, briefing, comandos e vínculo; vínculo divergente é rejeitado', () => {
  withCatalog((catalog, base) => {
    catalog.registerProduct(product(), 'prod'); catalog.registerCampaign(campaign(), 'camp');
    catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief');
    catalog.createBriefing({ briefingId: 'brief_002', campaignId: 'camp_001', campaignRevision: 1 }, 'brief_other');
    startRun(base); catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'bind');
    assert.throws(() => catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_002' }, 'bind_other'), code('AFFILIATE_RUN_BINDING_CONFLICT'));
    for (const table of ['affiliate_product_revisions', 'affiliate_campaign_revisions', 'affiliate_briefings', 'affiliate_run_bindings', 'affiliate_commands']) {
      assert.throws(() => base.db.exec(`DELETE FROM ${table}`));
      const column = table === 'affiliate_run_bindings' ? 'briefing_hash' : table === 'affiliate_commands' ? 'payload_hash' : 'content_hash';
      assert.throws(() => base.db.exec(`UPDATE ${table} SET ${column} = '${'a'.repeat(64)}'`));
    }
  });
});

test('adulteração em disco é detectada na leitura; vínculo sem briefing ou hash divergente interrompe recuperação', () => {
  withCatalog((catalog, base) => {
    catalog.registerProduct(product(), 'prod'); catalog.registerCampaign(campaign(), 'camp');
    catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief');
    startRun(base); catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'bind');
    base.db.exec('DROP TRIGGER affiliate_run_bindings_no_update');
    base.db.prepare('UPDATE affiliate_run_bindings SET briefing_hash = ?').run('a'.repeat(64));
    assert.throws(() => catalog.resolveRunBriefing('run_001'), code('AFFILIATE_HASH_MISMATCH'));
    base.db.exec('DROP TRIGGER affiliate_briefings_no_update');
    const brief = catalog.getBriefing('brief_001');
    base.db.prepare('UPDATE affiliate_briefings SET content_json = ?').run(JSON.stringify({ ...brief, cta: 'Adulterado' }));
    assert.throws(() => catalog.getBriefing('brief_001'));
  });
});

test('briefing referenciado ausente impede recuperação; comandos conflitam entre tipos', () => {
  withCatalog((catalog, base) => {
    catalog.registerProduct(product(), 'prod');
    assert.throws(() => catalog.registerCampaign(campaign(), 'prod'), code('AFFILIATE_IDEMPOTENCY_CONFLICT'));
    catalog.registerCampaign(campaign(), 'camp');
    catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief');
    catalog.registerCampaign(campaign({ revision: 2, cta: 'CTA atualizado' }), 'camp_next');
    assert.throws(() => catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 2 }, 'brief'), code('AFFILIATE_IDEMPOTENCY_CONFLICT'));
    assert.throws(() => catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 2 }, 'brief_conflict'), code('AFFILIATE_REVISION_CONFLICT'));
    startRun(base); catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'bind');
    base.db.exec('PRAGMA foreign_keys = OFF; DROP TRIGGER affiliate_briefings_no_delete; DELETE FROM affiliate_briefings;');
    assert.throws(() => catalog.resolveRunBriefing('run_001'), code('AFFILIATE_BRIEFING_NOT_FOUND'));
  });
});

test('reserva de contexto genérico bloqueia vínculo tardio e rejeita reutilização divergente', () => {
  withCatalog((catalog, base) => {
    catalog.registerProduct(product(), 'prod'); catalog.registerCampaign(campaign(), 'camp');
    catalog.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief');
    startRun(base);
    const request = { generationRequestId: 'generation_001', contentHash: 'a'.repeat(64) };
    assert.equal(catalog.prepareScriptGeneration(request, 'run_001'), null);
    assert.equal(catalog.prepareScriptGeneration(request, 'run_001'), null);
    assert.throws(() => catalog.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'late'), code('AFFILIATE_RUN_BINDING_TOO_LATE'));
    assert.throws(() => catalog.prepareScriptGeneration({ ...request, contentHash: 'b'.repeat(64) }, 'run_001'), code('AFFILIATE_SCRIPT_CONTEXT_CONFLICT'));
    assert.equal(base.db.prepare('SELECT COUNT(*) AS n FROM affiliate_script_contexts').get().n, 1);
    assert.throws(() => base.db.exec('DELETE FROM affiliate_script_contexts'));
    assert.throws(() => base.db.exec("UPDATE affiliate_script_contexts SET briefing_hash = NULL"));
  });
});

test('migração 029 preserva projeto/run do schema 028 e rollback não deixa schema parcial', () => {
  withCatalog((catalog, base, path) => {
    const run = startRun(base);
    const snapshot = base.get('project_001', 1);
    // Reconstruct the pre-P1 schema using only the additive P1 tables.
    base.db.exec(`DROP TABLE fal_financial_settlements; DELETE FROM schema_migrations WHERE version = 32; DROP TABLE fal_generation_requests; DROP TABLE fal_generations; DELETE FROM schema_migrations WHERE version = 31; DROP TABLE script_generation_claims; DROP TABLE affiliate_commands; DROP TABLE affiliate_script_contexts;
      DROP TABLE affiliate_run_bindings; DROP TABLE affiliate_briefings;
      DROP TABLE affiliate_campaign_revisions; DROP TABLE affiliate_product_revisions;
      DELETE FROM schema_migrations WHERE version >= 29; PRAGMA user_version = 28;
      CREATE TABLE affiliate_commands (fixture_blocker TEXT);`);
    assert.throws(() => new PipelineRunRepository(path), error => error.code === 'PROJECT_MIGRATION_FAILED');
    assert.equal(base.db.prepare('PRAGMA user_version').get().user_version, 28);
    assert.equal(base.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'affiliate_product_revisions'").get().n, 0);
    assert.deepEqual(base.getRun('run_001'), run);
    base.db.exec('DROP TABLE affiliate_commands');
    const migrated = new PipelineRunRepository(path);
    try {
      assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version, 32);
      assert.deepEqual(migrated.get('project_001', 1), snapshot);
      assert.deepEqual(migrated.getRun('run_001'), run);
      assert.equal(new AffiliateRepository(migrated).getRunBinding('run_001'), null);
    } finally { migrated.close(); }
  });
});
