import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

test('test commands scope Node discovery and retain the supported runners', () => {
  assert.equal(pkg.scripts.test, 'npm run test:node && npm run test:unit');
  assert.equal(pkg.scripts['test:node'], 'npm run build && node --test "test/*.test.js" "scripts/ops-local/*.test.mjs"');
  assert.equal(pkg.scripts['test:all'], 'npm test && npm run test:e2e && npm run test:python');
  assert.equal(pkg.scripts['test:python'], 'python -B -m unittest discover -s python/alignment -p "test_*.py" && python -B -m unittest discover -s python/tts -p "test_*.py"');
});
test('official entries use no legacy executable and start stays NestJS', () => {
  assert.equal(pkg.scripts.start, 'node --env-file-if-exists=.env dist/main.js');
  for (const [name, value] of Object.entries(pkg.scripts)) {
    if (name !== 'test') assert.doesNotMatch(value, /(?:^|\s)src\/.*\.js/);
  }
});
test('unavailable operations fail explicitly without loading legacy', () => {
  for (const command of ['video:live', 'trend:daily', 'trend:export', 'drive:authorize', 'drive:upload', 'start:legacy', 'project handoff', 'preview']) {
    const result = spawnSync(process.execPath, ['scripts/operational-cli.mjs', ...command.split(' ')], { encoding: 'utf8' });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /COMMAND_UNAVAILABLE/, command);
    assert.equal(result.stdout, '');
  }
});
test('Research E2E uses Nest schema provisioning', () => {
  const text = readFileSync(new URL('../src/modules/research/research-http.e2e-spec.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /src\/project-repository\.js|ProjectRepository/);
  assert.match(text, /provisionSchema/);
});
test('Project forwards exact public command payloads and read routes; HTTP failures remain failures', async () => {
  const { run } = await import('../scripts/operational-cli.mjs');
  const payload = { project: { id: 'project_001' }, projectId: 'project_001', expectedVersion: 2, idempotencyKey: 'key' };
  for (const [command, path] of [['create', '/projects'], ['version', '/projects/project_001/versions'], ['archive', '/projects/project_001/archive']]) {
    let called = false;
    const value = await run(['project', command, '--input', 'command.json'], {
      env: { MKTAUTO_API_URL: 'http://127.0.0.1:3000' }, readText: () => JSON.stringify(payload),
      fetch: async (url, init) => {
        assert.equal(url.pathname, path); assert.equal(init.method, 'POST');
        assert.deepEqual(JSON.parse(init.body), payload); called = true;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      },
    });
    assert.deepEqual(value, { ok: true }); assert.equal(called, true);
  }
  for (const [args, path] of [
    [['project', 'latest', '--project-id', 'project_001'], '/projects/project_001'],
    [['project', 'get', '--project-id', 'project_001', '--version', '2'], '/projects/project_001/versions/2'],
    [['project', 'review', '--project-id', 'project_001', '--version', '2'], '/projects/project_001/versions/2'],
    [['project', 'select', '--project-id', 'project_001', '--version', '2'], '/projects/project_001/versions/2'],
    [['preview', '--render-id', 'render_001'], '/media/renders/render_001'],
  ]) {
    await run(args, { env: { MKTAUTO_API_URL: 'http://localhost:3000' }, fetch: async (url, init) => {
      assert.equal(url.pathname, path); assert.equal(init.method, 'GET'); return Response.json({ id: 'result' });
    } });
  }
  await assert.rejects(run(['project', 'latest', '--project-id', 'project_001'], {
    env: { MKTAUTO_API_URL: 'http://localhost:3000' }, fetch: async () => Response.json({ code: 'NOT_FOUND' }, { status: 404 }),
  }), /HTTP_404/);
  await assert.rejects(run(['project', 'latest', '--database', 'main.sqlite']), /INVALID_OPTION/);
});

test('trend:shortlist forwards the complete JSON to Research without rewriting its contract', async () => {
  const { run } = await import('../scripts/operational-cli.mjs');
  const base = {
    researchInput: { execution: { pipelineRunId: 'run_001' }, window: { logicalDate: '2026-10-15' } },
    researchTopicCatalog: { contentHash: 'a'.repeat(64), topics: [{ title: 'Ação' }] },
  };
  for (const payload of [base, { ...base, policy: { version: 'fixture-policy', nested: [null, false, 0] }, unknown: 'backend validates' }]) {
    let calls = 0;
    const result = await run(['trend:shortlist', '--input', 'shortlist.json', '--api-url', 'http://localhost:3000'], {
      env: { MKTAUTO_API_URL: 'http://unused.invalid' },
      readText: file => { assert.equal(file, 'shortlist.json'); return JSON.stringify(payload); },
      fetch: async (url, init) => {
        calls++;
        assert.equal(url.href, 'http://localhost:3000/research/shortlists');
        assert.equal(init.method, 'POST');
        assert.deepEqual(init.headers, { 'content-type': 'application/json' });
        assert.deepEqual(JSON.parse(init.body), payload);
        assert.equal(init.redirect, 'error');
        assert.ok(init.signal instanceof AbortSignal);
        return Response.json({ shortlistId: 'shortlist_001' }, { status: 201 });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { shortlistId: 'shortlist_001' });
  }
});

test('trend:shortlist propagates HTTP and connection failures once without a fallback', async () => {
  const { run } = await import('../scripts/operational-cli.mjs');
  for (const status of [400, 404, 409, 500, null]) {
    let calls = 0;
    await assert.rejects(run(['trend:shortlist', '--input', 'shortlist.json'], {
      env: { MKTAUTO_API_URL: 'http://localhost:3000' }, readText: () => '{}',
      fetch: async () => {
        calls++;
        if (status === null) throw new Error('offline');
        return Response.json({ code: 'RESEARCH_FAILURE' }, { status });
      },
    }), status === null ? /offline/ : new RegExp(`NEST_HTTP_${status}`));
    assert.equal(calls, 1);
  }
});

test('trend:shortlist rejects invalid CLI inputs before any HTTP request', async () => {
  const { run } = await import('../scripts/operational-cli.mjs');
  const dependencies = {
    env: { MKTAUTO_API_URL: 'http://localhost:3000' }, readText: () => '{}',
    fetch: () => assert.fail('invalid input must not reach HTTP'),
  };
  await assert.rejects(run(['trend:shortlist'], dependencies), /REQUIRED_OPTION: input/);
  await assert.rejects(run(['trend:shortlist', '--input', 'a', '--database', 'catalog.sqlite'], dependencies), /INVALID_OPTION/);
  await assert.rejects(run(['trend:shortlist', '--input', 'a', '--input', 'b'], dependencies), /INVALID_OPTION/);
  await assert.rejects(run(['trend:shortlist', '--input', 'a', '--api-url', 'http://user:secret@localhost:3000'], dependencies), /INVALID_API_URL/);
  await assert.rejects(run(['trend:shortlist', '--input', 'a'], { ...dependencies, env: {} }), /API_URL_REQUIRED/);
  await assert.rejects(run(['trend:shortlist', '--input', 'a'], { ...dependencies, readText: () => '{invalid' }), SyntaxError);
});
test('every official cutover script is wired to its own guarded command', () => {
  for (const entry of ['project', 'preview', 'video:live', 'trend:daily', 'trend:shortlist', 'trend:export', 'drive:authorize', 'drive:upload', 'start:legacy']) {
    assert.equal(pkg.scripts[entry], `node --env-file-if-exists=.env scripts/operational-cli.mjs ${entry}`);
  }
});
test('connection failure has no legacy fallback and unsupported flags cannot select a database', async () => {
  const { run } = await import('../scripts/operational-cli.mjs');
  let calls = 0;
  await assert.rejects(run(['project', 'latest', '--project-id', 'project_001'], {
    env: { MKTAUTO_API_URL: 'http://localhost:3000' },
    fetch: async () => { calls++; throw new Error('offline'); },
  }), /offline/);
  assert.equal(calls, 1);
  await assert.rejects(run(['preview', '--project-id', 'project_001', '--selection-id', 'selection_001']), /COMMAND_UNAVAILABLE/);
  await assert.rejects(run(['project', 'export']), /COMMAND_UNAVAILABLE/);
});
