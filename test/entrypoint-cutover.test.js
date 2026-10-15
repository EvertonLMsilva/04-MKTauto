import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
test('official entries use no legacy executable and start stays NestJS', () => {
  assert.equal(pkg.scripts.start, 'node --env-file-if-exists=.env backend/dist/main.js');
  for (const [name, value] of Object.entries(pkg.scripts)) {
    if (name !== 'test') assert.doesNotMatch(value, /(?:^|\s)src\/.*\.js/);
  }
});
test('unavailable operations fail explicitly without loading legacy', () => {
  for (const command of ['video:live', 'trend:daily', 'trend:shortlist', 'trend:export', 'drive:authorize', 'drive:upload', 'start:legacy', 'project handoff', 'preview']) {
    const result = spawnSync(process.execPath, ['scripts/operational-cli.mjs', ...command.split(' ')], { encoding: 'utf8' });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /COMMAND_UNAVAILABLE/, command);
    assert.equal(result.stdout, '');
  }
});
test('Research E2E uses Nest schema provisioning', () => {
  const text = readFileSync(new URL('../backend/src/research/research-http.e2e-spec.ts', import.meta.url), 'utf8');
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
