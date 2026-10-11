import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AffiliateRepository } from './affiliate-repository.js';
import { PipelineRunRepository } from './pipeline-run-repository.js';

const MUTATIONS = new Set(['product-put', 'campaign-put', 'briefing-create', 'run-bind']);
const READS = new Set(['product-get', 'campaign-get', 'briefing-get', 'run-get']);

export function runAffiliateCli(argv) {
  let base;
  try {
    const [command, ...args] = argv;
    if (!MUTATIONS.has(command) && !READS.has(command)) throw error('INVALID_AFFILIATE_COMMAND', 'command');
    const allowed = MUTATIONS.has(command) ? ['database', 'input'] : ['database', 'id', ...(['product-get', 'campaign-get'].includes(command) ? ['revision'] : [])];
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace(/^--/, ''); const value = args[i + 1];
      if (!args[i]?.startsWith('--') || !allowed.includes(key) || options[key] !== undefined || !value || value.startsWith('--')) throw error('INVALID_AFFILIATE_OPTION', 'options');
      options[key] = value;
    }
    const path = resolve(options.database ?? 'data/mktauto.sqlite');
    let payload;
    if (MUTATIONS.has(command)) {
      if (!options.input) throw error('AFFILIATE_INPUT_REQUIRED', 'input');
      try { payload = JSON.parse(readFileSync(resolve(options.input), 'utf8')); }
      catch { throw error('INVALID_AFFILIATE_JSON', 'input'); }
      const fields = { 'product-put': ['idempotencyKey', 'product'], 'campaign-put': ['idempotencyKey', 'campaign'],
        'briefing-create': ['idempotencyKey', 'briefingId', 'campaignId', 'campaignRevision'], 'run-bind': ['idempotencyKey', 'pipelineRunId', 'briefingId'] }[command];
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== fields.length || fields.some(field => !Object.hasOwn(payload, field))) throw error('INVALID_AFFILIATE_INPUT', 'input');
    } else {
      if (!options.id) throw error('AFFILIATE_ID_REQUIRED', 'id');
      if (allowed.includes('revision') && (!/^[1-9]\d*$/.test(options.revision ?? '') || !Number.isSafeInteger(Number(options.revision)))) throw error('INVALID_AFFILIATE_REVISION', 'revision');
      if (!existsSync(path)) throw error('DATABASE_NOT_FOUND', 'database');
    }
    base = new PipelineRunRepository(path);
    const catalog = new AffiliateRepository(base);
    let result;
    switch (command) {
      case 'product-put': result = catalog.registerProduct(payload.product, payload.idempotencyKey); break;
      case 'campaign-put': result = catalog.registerCampaign(payload.campaign, payload.idempotencyKey); break;
      case 'briefing-create': {
        const { idempotencyKey, ...value } = payload; result = catalog.createBriefing(value, idempotencyKey); break;
      }
      case 'run-bind': {
        const { idempotencyKey, ...value } = payload; result = catalog.bindRun(value, idempotencyKey); break;
      }
      case 'product-get': result = catalog.getProduct(options.id, Number(options.revision)); break;
      case 'campaign-get': result = catalog.getCampaign(options.id, Number(options.revision)); break;
      case 'briefing-get': result = catalog.getBriefing(options.id); break;
      case 'run-get': {
        if (!base.getRun(options.id)) throw error('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
        result = { binding: catalog.getRunBinding(options.id), briefing: catalog.resolveRunBriefing(options.id) }; break;
      }
    }
    if (result === null) throw error('AFFILIATE_RECORD_NOT_FOUND', 'id');
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '' };
  } catch (caught) {
    const code = typeof caught.code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(caught.code) ? caught.code : 'AFFILIATE_COMMAND_FAILED';
    const candidate = caught.field ?? caught.path;
    const field = typeof candidate === 'string' && /^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(candidate) ? candidate : 'command';
    return { exitCode: 1, stdout: '', stderr: `${JSON.stringify({ error: { code, field } })}\n` };
  } finally { base?.close(); }
}

function error(code, field) { return Object.assign(new Error(code), { code, field }); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runAffiliateCli(process.argv.slice(2));
  process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
}
