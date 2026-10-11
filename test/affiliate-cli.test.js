import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAffiliateCli } from '../src/affiliate-cli.js';
import { PipelineRunRepository } from '../src/pipeline-run-repository.js';
import { product, campaign, project, startRun } from './affiliate-fixtures.js';

test('CLI/JSON cadastra, consulta e vincula com novas conexões e entrada real', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-cli-'));
  const database = join(directory, 'catalog.sqlite');
  const input = join(directory, 'input.json');
  try {
    const base = new PipelineRunRepository(database);
    try { base.create(project()); startRun(base); } finally { base.close(); }
    const execute = (command, payload) => {
      writeFileSync(input, JSON.stringify(payload));
      const result = runAffiliateCli([command, '--database', database, '--input', input]);
      assert.equal(result.exitCode, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const p = execute('product-put', { idempotencyKey: 'create_prod', product: product() });
    assert.deepEqual(execute('product-put', { idempotencyKey: 'create_prod', product: product() }), p);
    const c = execute('campaign-put', { idempotencyKey: 'create_campaign', campaign: campaign() });
    const b = execute('briefing-create', { idempotencyKey: 'create_brief', briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 });
    execute('run-bind', { idempotencyKey: 'bind_run', pipelineRunId: 'run_001', briefingId: 'brief_001' });
    for (const [command, id, expected] of [['product-get', 'prod_001', p], ['campaign-get', 'camp_001', c], ['briefing-get', 'brief_001', b]]) {
      const result = runAffiliateCli([command, '--database', database, '--id', id, ...(command === 'briefing-get' ? [] : ['--revision', '1'])]);
      assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), expected);
    }
    const run = runAffiliateCli(['run-get', '--database', database, '--id', 'run_001']);
    assert.deepEqual(JSON.parse(run.stdout).briefing, b);
    const external = spawnSync(process.execPath, ['src/affiliate-cli.js', 'product-get', '--database', database, '--id', 'prod_001', '--revision', '1'], { encoding: 'utf8' });
    assert.equal(external.status, 0, external.stderr); assert.deepEqual(JSON.parse(external.stdout), p);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI rejeita comando/opções/JSON inválidos e conflitos com erro sanitizado', () => {
  for (const argv of [[], ['unknown'], ['product-put'], ['product-get', '--revision', '0'], ['product-get', '--id', 'prod_001', '--revision', '1', '--live', 'yes']]) {
    assert.equal(runAffiliateCli(argv).exitCode, 1);
  }
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-cli-errors-'));
  const input = join(directory, 'input.json'); const database = join(directory, 'catalog.sqlite');
  try {
    writeFileSync(input, 'invalid PRIVATE payload');
    const invalid = runAffiliateCli(['product-put', '--database', database, '--input', input]);
    assert.equal(invalid.exitCode, 1); assert.ok(!invalid.stderr.includes('PRIVATE'));
    writeFileSync(input, JSON.stringify({ idempotencyKey: 'prod_key', product: product() }));
    assert.equal(runAffiliateCli(['product-put', '--database', database, '--input', input]).exitCode, 0);
    writeFileSync(input, JSON.stringify({ idempotencyKey: 'prod_key', product: product({ name: 'Outro' }) }));
    const conflict = runAffiliateCli(['product-put', '--database', database, '--input', input]);
    assert.equal(conflict.exitCode, 1); assert.match(conflict.stderr, /AFFILIATE_IDEMPOTENCY_CONFLICT/);
    const missing = runAffiliateCli(['product-get', '--database', database, '--id', 'prod_missing', '--revision', '1']);
    assert.equal(missing.exitCode, 1); assert.match(missing.stderr, /AFFILIATE_RECORD_NOT_FOUND/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
