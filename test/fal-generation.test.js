import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { MediaAssetRepository } from '../src/media-asset-repository.js';
import { CostLedgerRepository } from '../src/cost-ledger-repository.js';
import { AffiliateRepository } from '../src/affiliate-repository.js';
import { FalGenerationRepository } from '../src/fal-generation-repository.js';
import { FalVideoAdapter } from '../src/adapters/fal-video.js';
import { FalQueueClient } from '../src/adapters/fal-queue.js';
import { MediaAcquisitionService } from '../src/media-acquisition-service.js';
import { mediaAcquisitionRequestHash } from '../src/domain/media-acquisition-contracts.js';
import { scriptContentHash, validateScript } from '../src/domain/script-contracts.js';
import { product, campaign, project, startRun } from './affiliate-fixtures.js';

const stamp = '2026-10-11T12:00:00.000Z';
const script = { schemaVersion: 'script/1.0.0', scriptId: 'script_001', contentHash: 'a'.repeat(64), pipelineRunId: 'run_001',
  projectId: 'project_001', projectVersion: 1,
  ideaSelectionId: 'selection_001', ideaSelectionContentHash: 'd'.repeat(64), ideaCandidateId: 'candidate_001', ideaContentHash: 'e'.repeat(64),
  language: 'pt-BR', contentFormat: 'short_video', hook: 'Conheça este produto.',
  narrativeBlocks: [{ position: 1, purpose: 'EXPLANATION', narration: 'Referência autorizada.' }],
  fullNarration: 'Conheça este produto.\n\nReferência autorizada.\n\nConfira pelo link',
  cta: 'Confira pelo link', estimatedDurationSeconds: 30, sensitiveClaims: [], reviewFlags: [], origin: 'OPERATOR',
  createdAt: stamp, revision: 1, supersedesScriptId: null,
  visualDirections: [{ position: 1, blockPosition: 1, description: 'Produto sobre uma mesa' }] };
script.contentHash = scriptContentHash(script);
function request(overrides = {}) {
  const value = { schemaVersion: 'media-acquisition-request/1.0.0', mediaAcquisitionRequestId: 'acq_001',
    scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: 1,
    assetType: 'VIDEO', requestedAt: stamp, ...overrides };
  return { ...value, contentHash: mediaAcquisitionRequestHash(value) };
}
function fixture(t, config = {}, { realPersistence = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fal-p2-')); const path = join(dir, 'db.sqlite');
  const repo = new MediaAssetRepository(path);
  repo.getScript = id => id === script.scriptId ? script : null;
  repo.create(project()); startRun(repo);
  const affiliate = new AffiliateRepository(repo);
  affiliate.registerProduct(product(), 'product_key'); affiliate.registerCampaign(campaign(), 'campaign_key');
  affiliate.createBriefing({ briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 }, 'brief_key');
  affiliate.bindRun({ pipelineRunId: 'run_001', briefingId: 'brief_001' }, 'bind_key');
  if (realPersistence) seedScript(repo);
  const costs = new CostLedgerRepository(path);
  const handles = [repo, costs]; t.after(() => { handles.forEach(r => { if (r.db.isOpen) r.close(); }); rmSync(dir, { recursive: true, force: true }); });
  const queue = { submissions: 0, polls: 0, downloads: 0, state: 'IN_QUEUE',
    async submit() { this.submissions++; return { requestId: 'fal-request-001', status: 'IN_QUEUE' }; },
    async status() { this.polls++; return { status: this.state }; },
    async result() { return { video: { url: 'https://v.fal.media/output.mp4' } }; },
    async download() { this.downloads++; return Buffer.from('original-with-audio'); } };
  const storage = { async store(bytes) { assert.equal(bytes.toString(), 'original-with-audio');
    return { contentHash: 'b'.repeat(64), mediaReference: 'media:sha256_' + 'b'.repeat(64),
      format: 'mp4', mimeType: 'video/mp4', widthPixels: 768, heightPixels: 1024,
      durationMilliseconds: 5000, hasAudio: true }; }, async verify() { return true; } };
  function adapter(repository = repo, changes = {}) {
    repository.getScript = id => id === script.scriptId ? script : null;
    return new FalVideoAdapter(repository, { mediaRef: 'authorized-image-001',
      budget: { amount: '2', currency: 'USD' }, estimate: { amount: '1', currency: 'USD', source: 'fixture/1.0.0' },
      rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true }, ...config, ...changes },
    { queue, storage, costRepository: costs, resolveImage: async () => ({ url: 'https://example.com/authorized.png', contentHash: 'c'.repeat(64) }) });
  }
  async function acquire(provider = adapter(), req = request()) {
    const acquisitionRepository = provider.repository;
    // Production registration is tested separately; this fixture isolates the paid lifecycle.
    if (!realPersistence) {
      acquisitionRepository.getMediaAcquisition = () => null;
      acquisitionRepository.registerAcquiredMediaAsset = ({ mediaAsset }) => mediaAsset;
    }
    return new MediaAcquisitionService(acquisitionRepository, provider).acquire(req);
  }
  return { repo, costs, path, handles, queue, storage, adapter, acquire };
}
const code = expected => error => error.code === expected;

function reserveNext(jobs, first, amount, id = 'acq_next') {
  return jobs.reserve({ basis: { ...first.basis, mediaRef: id }, request: request({ mediaAcquisitionRequestId: id }),
    budget: { amount: '1', currency: 'USD' }, estimate: { amount, currency: 'USD', source: 'fixture/1.0.0' } });
}
const observed = (amount, final = false) => ({ amount, currency: 'USD', source: 'invoice/1.0.0', occurredAt: stamp, final });

test('FIX01 partial 0.10 against reservation 1 never admits another 0.90', async t => {
  const f = fixture(t, { budget: { amount: '1', currency: 'USD' } });
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  jobs.recordObservedCost(first.key, observed('0.10'));
  jobs.recordObservedCost(first.key, observed('0.10'));
  assert.throws(() => reserveNext(jobs, first, '0.90'), code('PROVIDER_BUDGET_EXCEEDED'));
  assert.equal(f.costs.listCostEventsByPipelineRun('run_001').length, 1);
  assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM fal_generations').get().n, 1);
});

test('FIX01 final settlement releases exactly the remaining balance after restart', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  jobs.recordObservedCost(first.key, observed('0.10'));
  assert.throws(() => jobs.recordObservedCost(first.key, observed('0.10', true)), code('PROVIDER_COST_NOT_TERMINAL'));
  jobs.state(first.key, 'COMPLETED');
  // Technical completion without financial evidence still keeps the reservation.
  assert.throws(() => reserveNext(jobs, first, '0.90'), code('PROVIDER_BUDGET_EXCEEDED'));
  jobs.recordObservedCost(first.key, observed('0.10', true));
  jobs.recordObservedCost(first.key, observed('0.10', true));
  const second = new MediaAssetRepository(f.path); f.handles.push(second);
  const reopened = new FalGenerationRepository(second, f.costs);
  assert.equal(reopened.get(first.key).financiallySettled, true);
  assert.throws(() => reserveNext(reopened, first, '0.91'), code('PROVIDER_BUDGET_EXCEEDED'));
  const next = reserveNext(reopened, first, '0.90');
  assert.equal(next.owner, true); assert.equal(reserveNext(jobs, first, '0.90').owner, false);
  assert.equal(f.costs.getCostLedgerByPipelineRun('run_001').totalsByCurrency[0].amount, '0.1');
});

test('FIX01 cumulative observations and final above estimate count once and block new spend', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  jobs.recordObservedCost(first.key, observed('0.10'));
  jobs.recordObservedCost(first.key, observed('1.20'));
  jobs.recordObservedCost(first.key, observed('0.10')); // Replay an earlier observation.
  assert.throws(() => reserveNext(jobs, first, '0.01'), code('PROVIDER_BUDGET_EXCEEDED'));
  jobs.state(first.key, 'FAILED');
  jobs.recordObservedCost(first.key, observed('1.30', true));
  jobs.recordObservedCost(first.key, observed('1.30', true));
  assert.equal(f.costs.getCostLedgerByPipelineRun('run_001').totalsByCurrency[0].amount, '1.3');
  assert.throws(() => jobs.recordObservedCost(first.key, observed('1.40')), code('PROVIDER_COST_ALREADY_SETTLED'));
  assert.throws(() => reserveNext(jobs, first, '0.01'), code('PROVIDER_BUDGET_EXCEEDED'));
});

test('FIX01 two connections competing for the remaining balance admit only one reservation', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  jobs.state(first.key, 'COMPLETED'); jobs.recordObservedCost(first.key, observed('0.10', true));
  const gate = new SharedArrayBuffer(4), ready = [], results = [];
  for (const id of ['acq_two', 'acq_three']) {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { MediaAssetRepository } = await import(workerData.media);
        const { CostLedgerRepository } = await import(workerData.costs);
        const { FalGenerationRepository } = await import(workerData.jobs);
        const repo = new MediaAssetRepository(workerData.path), costs = new CostLedgerRepository(workerData.path);
        try {
          const jobs = new FalGenerationRepository(repo, costs);
          parentPort.postMessage({ ready: true });
          Atomics.wait(new Int32Array(workerData.gate), 0, 0);
          try { parentPort.postMessage({ owner: jobs.reserve(workerData.reservation).owner }); }
          catch (error) { parentPort.postMessage({ code: error.code }); }
        } finally { repo.close(); costs.close(); }
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { path: f.path, gate,
      media: new URL('../src/media-asset-repository.js', import.meta.url).href,
      costs: new URL('../src/cost-ledger-repository.js', import.meta.url).href,
      jobs: new URL('../src/fal-generation-repository.js', import.meta.url).href,
      reservation: { basis: { ...first.basis, mediaRef: id }, request: request({ mediaAcquisitionRequestId: id }),
        budget: { amount: '1', currency: 'USD' }, estimate: { amount: '0.90', currency: 'USD', source: 'fixture/1.0.0' } } } });
    t.after(() => worker.terminate());
    ready.push(new Promise((resolve, reject) => { worker.on('message', message => { if (message.ready) resolve(); }); worker.on('error', reject); }));
    results.push(new Promise((resolve, reject) => { worker.on('message', message => { if (!message.ready) resolve(message); }); worker.on('error', reject); }));
  }
  await Promise.all(ready); Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  const completed = await Promise.all(results);
  assert.equal(completed.filter(r => r.owner === true).length, 1);
  assert.equal(completed.find(r => r.code).code, 'PROVIDER_BUDGET_EXCEEDED');
});

test('FIX01 valid POST identity survives invalid URL and restart; recovery uses official GET only', async t => {
  const f = fixture(t), calls = [];
  const id = 'fal-request-001', base = `https://queue.fal.run/minimax/h3-max-turbo/requests/${id}`;
  const queue = new FalQueueClient({ apiKey: 'fixture-secret' }, { fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    return new Response(JSON.stringify(options.method === 'POST'
      ? { request_id: id, status_url: 'https://evil.test/?token=private', response_url: base }
      : { request_id: id, status: 'IN_QUEUE' }), { headers: { 'content-type': 'application/json' } });
  } });
  const adapter = f.adapter(); adapter.queue = queue;
  await assert.rejects(f.acquire(adapter), code('PROVIDER_RECONCILIATION_PENDING'));
  assert.equal(adapter.getGenerationState('acq_001').requestId, id);
  assert.equal(calls.length, 1);
  f.repo.close(); const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  const resumed = f.adapter(reopened); resumed.queue = queue;
  await assert.rejects(f.acquire(resumed), code('PROVIDER_GENERATION_PENDING'));
  await assert.rejects(f.acquire(resumed), code('PROVIDER_GENERATION_PENDING'));
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  assert.ok(calls.slice(1).every(c => c.url === `${base}/status` && c.method === 'GET'));
  assert.equal(resumed.getGenerationState('acq_001').state, 'IN_QUEUE');
});

test('FIX01 settlement and cost delta roll back together on persistence failure', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  assert.equal(first.observedCostAmount, null);
  jobs.recordObservedCost(first.key, observed('0.10')); jobs.state(first.key, 'COMPLETED');
  f.repo.db.exec("CREATE TRIGGER fixture_settlement_failure BEFORE INSERT ON fal_financial_settlements BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;");
  assert.throws(() => jobs.recordObservedCost(first.key, observed('0.20', true)), /fixture_failure/);
  assert.equal(jobs.get(first.key).financiallySettled, false);
  assert.equal(jobs.get(first.key).observedCostAmount, '0.1');
  assert.equal(f.costs.db.isTransaction, false);
  f.repo.db.exec('DROP TRIGGER fixture_settlement_failure');
  jobs.recordObservedCost(first.key, observed('0.20', true));
  assert.equal(jobs.get(first.key).observedCostAmount, '0.2');
});

test('FIX01 migration from schema 31 preserves jobs and legacy ledger conservatively', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  const jobs = new FalGenerationRepository(f.repo, f.costs), first = jobs.getByAcquisitionRequest('acq_001');
  f.costs.registerCostEvent({ schemaVersion: 'cost-event/1.0.0', costEventId: `cost:fal:${first.key}`,
    category: 'media_cost', pipelineRunId: 'run_001', projectId: 'project_001', projectVersion: 1,
    contentIdentity: null, artifactId: null, amount: '0.10', currency: 'USD', occurredAt: stamp,
    origin: 'invoice/1.0.0', attributionRuleVersion: 'fal-observed-cost/1.0.0', recordedAt: first.createdAt });
  f.repo.db.exec('DROP TABLE fal_financial_settlements; DELETE FROM schema_migrations WHERE version=32; PRAGMA user_version=31;');
  f.repo.close();
  const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  const migrated = new FalGenerationRepository(reopened, f.costs);
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 32);
  assert.equal(migrated.get(first.key).requestId, first.requestId);
  assert.equal(migrated.get(first.key).observedCostAmount, '0.1');
  assert.throws(() => reserveNext(migrated, first, '0.90'), code('PROVIDER_BUDGET_EXCEEDED'));
  migrated.state(first.key, 'COMPLETED'); migrated.recordObservedCost(first.key, observed('0.10', true));
  assert.equal(reserveNext(migrated, first, '0.90').owner, true);
  assert.equal(f.costs.listCostEventsByPipelineRun('run_001').length, 1);
});

test('FIX01 POST response without identity stays uncertain after reopen with no second POST', async t => {
  const f = fixture(t); let posts = 0;
  const queue = new FalQueueClient({ apiKey: 'fixture-secret' }, { fetchImpl: async () => {
    posts++; return new Response('{}', { headers: { 'content-type': 'application/json' } });
  } });
  const adapter = f.adapter(); adapter.queue = queue;
  await assert.rejects(f.acquire(adapter), code('PROVIDER_RECONCILIATION_PENDING'));
  const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  const resumed = f.adapter(reopened); resumed.queue = queue;
  await assert.rejects(f.acquire(resumed), code('PROVIDER_RECONCILIATION_PENDING'));
  assert.equal(resumed.getGenerationState('acq_001').requestId, null); assert.equal(posts, 1);
});

test('P2 persists queue ID, resumes after restart, returns original audio and reuses result', async t => {
  const f = fixture(t);
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  assert.equal(f.repo.db.prepare('SELECT request_id FROM fal_generations').get().request_id, 'fal-request-001');
  f.repo.close();
  const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  f.queue.state = 'IN_PROGRESS';
  await assert.rejects(f.acquire(f.adapter(reopened)), code('PROVIDER_GENERATION_PENDING'));
  f.queue.state = 'COMPLETED';
  const asset = await f.acquire(f.adapter(reopened));
  assert.equal(asset.schemaVersion, 'media-asset/2.0.0'); assert.equal(asset.technicalProperties.hasAudio, true);
  assert.equal(asset.provider, 'fal_ai'); assert.equal(f.queue.submissions, 1);
  assert.deepEqual(await f.acquire(f.adapter(reopened)), asset); assert.equal(f.queue.downloads, 1);
});

test('P2 concurrent equivalent requests across connections submit once', async t => {
  const f = fixture(t); const second = new MediaAssetRepository(f.path); f.handles.push(second);
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.queue.submit = async () => { f.queue.submissions++; await gate; return { requestId: 'fal-request-001', status: 'IN_QUEUE' }; };
  const first = f.acquire();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.acquire(f.adapter(second), request({ mediaAcquisitionRequestId: 'acq_002' })), code('PROVIDER_RECONCILIATION_PENDING'));
  release(); await assert.rejects(first, code('PROVIDER_GENERATION_PENDING'));
  assert.equal(f.queue.submissions, 1); assert.equal(f.repo.db.prepare('SELECT COUNT(*) n FROM fal_generations').get().n, 1);
});

test('P2 unknown submission never resubmits after restart', async t => {
  const f = fixture(t); f.queue.submit = async () => { f.queue.submissions++; throw new Error('timeout secret'); };
  await assert.rejects(f.acquire(), code('PROVIDER_RECONCILIATION_PENDING'));
  const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  await assert.rejects(f.acquire(f.adapter(reopened)), code('PROVIDER_RECONCILIATION_PENDING'));
  assert.equal(f.queue.submissions, 1);
});

test('P2 budget, unavailable estimate and unauthorized image reject before POST', async t => {
  const f = fixture(t);
  for (const [changes, expected] of [
    [{ budget: { amount: '0.5', currency: 'USD' } }, 'PROVIDER_BUDGET_EXCEEDED'],
    [{ estimate: null }, 'PROVIDER_COST_ESTIMATE_REQUIRED'],
    [{ mediaRef: 'unapproved' }, 'PROVIDER_IMAGE_NOT_AUTHORIZED'],
    [{ rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: false } }, 'PROVIDER_RIGHTS_REQUIRED'],
  ]) await assert.rejects(async () => f.acquire(f.adapter(f.repo, changes)), code(expected));
  assert.equal(f.queue.submissions, 0);
});

test('P2 reservations and CostLedger both count before next submission', async t => {
  const f = fixture(t, { budget: { amount: '1.5', currency: 'USD' } });
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  script.visualDirections.push({ position: 2, blockPosition: 1, description: 'Outro ângulo' });
  t.after(() => script.visualDirections.pop());
  await assert.rejects(f.acquire(f.adapter(), request({ mediaAcquisitionRequestId: 'acq_002', visualDirectionPosition: 2 })), code('PROVIDER_BUDGET_EXCEEDED'));
  const jobs = new FalGenerationRepository(f.repo, f.costs);
  const key = f.repo.db.prepare('SELECT generation_key FROM fal_generations').get().generation_key;
  jobs.recordObservedCost(key, { amount: '1.2', currency: 'USD', source: 'invoice/1.0.0', occurredAt: stamp });
  jobs.recordObservedCost(key, { amount: '1.2', currency: 'USD', source: 'invoice/1.0.0', occurredAt: stamp });
  assert.equal(f.costs.getCostLedgerByPipelineRun('run_001').totalsByCurrency[0].amount, '1.2');
  assert.equal(f.costs.listCostEventsByPipelineRun('run_001').length, 1);
  assert.equal(f.queue.submissions, 1);
});

test('P2 polling failures and terminal failures never create paid fallback', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  f.queue.status = async () => { throw new Error('network'); };
  await assert.rejects(f.acquire()); assert.equal(f.queue.submissions, 1);
  f.queue.status = async () => ({ status: 'COMPLETED', error: 'private failure' });
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_FAILED'));
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_FAILED')); assert.equal(f.queue.submissions, 1);
});

test('P2 real acquisition stores artifact and lineage; equivalent new ID reuses exact version after reopen', async t => {
  const f = fixture(t, {}, { realPersistence: true });
  await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING')); f.queue.state = 'COMPLETED';
  const asset = await f.acquire();
  assert.equal(f.repo.getMediaAsset(asset.mediaAssetId).technicalProperties.hasAudio, true);
  assert.equal(f.repo.getArtifact(asset.mediaAssetId).inputs[0].inputId, script.scriptId);
  const second = new MediaAssetRepository(f.path); f.handles.push(second);
  const same = await f.acquire(f.adapter(second), request({ mediaAcquisitionRequestId: 'acq_002' }));
  assert.deepEqual(same, asset); assert.equal(f.queue.submissions, 1); assert.equal(f.queue.downloads, 1);
  assert.equal(second.db.prepare('SELECT COUNT(*) n FROM media_assets').get().n, 1);
  f.storage.verify = async () => false;
  await assert.rejects(f.acquire(f.adapter(second)), code('PROVIDER_ARTIFACT_UNAVAILABLE'));
  assert.equal(f.queue.submissions, 1);
});

test('P2 conflicts and corrupt results prevent additional POSTs', async t => {
  const f = fixture(t); await assert.rejects(f.acquire(), code('PROVIDER_GENERATION_PENDING'));
  await assert.rejects(f.acquire(f.adapter(), request({ requestedAt: '2026-10-11T13:00:00.000Z' })), code('PROVIDER_REQUEST_CONFLICT'));
  f.queue.state = 'COMPLETED'; f.storage.store = async () => { throw new Error('invalid MP4'); };
  await assert.rejects(f.acquire()); await assert.rejects(f.acquire()); assert.equal(f.queue.submissions, 1);
  assert.equal(f.repo.db.prepare('SELECT state FROM fal_generations').get().state, 'COMPLETED');
});

test('P2 persisted DISPATCHING without request ID blocks recovery after a crash', async t => {
  const f = fixture(t);
  const basis = { pipelineRunId: script.pipelineRunId, scriptId: script.scriptId, scriptContentHash: script.contentHash,
    visualDirectionPosition: 1, briefingHash: new AffiliateRepository(f.repo).resolveRunBriefing('run_001').contentHash,
    mediaRef: 'authorized-image-001', imageHash: 'c'.repeat(64), endpoint: 'minimax/h3-max-turbo/image-to-video',
    parameters: { prompt: script.visualDirections[0].description, image_url: 'authorized-image-001', duration: 5,
      resolution: '768P', prompt_expansion_mode: 'disabled', enable_safety_checker: true },
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true } };
  const jobs = new FalGenerationRepository(f.repo, f.costs);
  jobs.reserve({ basis, request: request(), budget: { amount: '2', currency: 'USD' },
    estimate: { amount: '1', currency: 'USD', source: 'fixture/1.0.0' } });
  const reopened = new MediaAssetRepository(f.path); f.handles.push(reopened);
  const adapter = f.adapter(reopened);
  await assert.rejects(f.acquire(adapter), code('PROVIDER_RECONCILIATION_PENDING'));
  assert.equal(f.queue.submissions, 0); assert.equal(adapter.getGenerationState('acq_001').state, 'DISPATCHING');
});

test('P2 a lower budget cannot bypass existing ledger costs with a fresh generation', async t => {
  const f = fixture(t);
  f.costs.registerCostEvent({ schemaVersion: 'cost-event/1.0.0', costEventId: 'cost:other_001', category: 'ai_cost',
    pipelineRunId: 'run_001', projectId: 'project_001', projectVersion: 1, contentIdentity: null, artifactId: null,
    amount: '1.5', currency: 'USD', occurredAt: stamp, origin: 'fixture', attributionRuleVersion: 'fixture/1.0.0', recordedAt: stamp });
  await assert.rejects(f.acquire(), code('PROVIDER_BUDGET_EXCEEDED')); assert.equal(f.queue.submissions, 0);
});

// Upstream script fixture follows the existing MediaAssetRepository tests; asset
// scope/revision/lineage triggers remain enabled throughout the tested acquisition.
function seedScript(repo) {
  const value = validateScript(script);
  repo.registerArtifact({ schemaVersion: 'artifact-lineage/1.0.0', artifactId: value.scriptId,
    artifactType: 'script', artifactVersion: 1, pipelineRunId: value.pipelineRunId, projectId: value.projectId,
    projectVersion: value.projectVersion, contentIdentity: 'script:selection_001', hashAlgorithm: 'sha256',
    contentHash: value.contentHash, inputs: [], generationMetadata: null, createdAt: stamp });
  repo.db.exec('PRAGMA foreign_keys = OFF; DROP TRIGGER scripts_validate_scope;');
  repo.db.prepare(`INSERT INTO scripts (script_id,schema_version,pipeline_run_id,project_id,project_version,
    idea_selection_id,idea_selection_content_hash,idea_candidate_id,idea_content_hash,language,content_format,
    estimated_duration_seconds,origin,created_at,revision,supersedes_script_id,content_hash,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.scriptId,value.schemaVersion,value.pipelineRunId,value.projectId,value.projectVersion,
    value.ideaSelectionId,value.ideaSelectionContentHash,value.ideaCandidateId,value.ideaContentHash,value.language,value.contentFormat,
    value.estimatedDurationSeconds,value.origin,value.createdAt,value.revision,value.supersedesScriptId,value.contentHash,JSON.stringify(value));
  repo.db.exec('PRAGMA foreign_keys = ON;');
}
