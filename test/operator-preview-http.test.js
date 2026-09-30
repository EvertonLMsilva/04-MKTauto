import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleOperatorPreviewRequest } from "../src/operator-preview-http.js";

test("HTTP expõe catálogo, status, início e decisão humana", async () => {
  const calls = { start: 0, decide: 0 };
  const adapter = {
    catalog: async () => ({ projects: [{ id: "project_console" }], versions: [], runs: [], selections: [] }),
    status: async (scope) => ({ scope, stages: [] }),
    start: (scope) => { calls.start += 1; return Promise.resolve({ scope }); },
    decide: async (value) => { calls.decide += 1; return { ...value, humanApprovalDecisionId: "human_approval:http" }; },
  };
  await withServer(adapter, async (base) => {
    assert.equal((await getJson(`${base}/api/operator-preview/catalog`)).status, 200);
    const query = "projectId=project_console&projectVersion=1&pipelineRunId=run_console&selectionId=selection_console";
    assert.equal((await getJson(`${base}/api/operator-preview/status?${query}`)).body.scope.selectionId, "selection_console");
    const started = await fetch(`${base}/api/operator-preview/executions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "project_console", projectVersion: 1, pipelineRunId: "run_console", selectionId: "selection_console" }) });
    assert.equal(started.status, 202);
    assert.equal(calls.start, 1);
    const approval = await fetch(`${base}/api/operator-preview/approvals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "APPROVED" }) });
    assert.equal(approval.status, 200);
    assert.equal((await approval.json()).humanApprovalDecisionId, "human_approval:http");
    assert.equal(calls.decide, 1);
  });
});

test("HTTP cria run/bootstrap e registra seleção de ideia pelos endpoints mínimos", async () => {
  const adapter = { createRun: async (value) => ({ pipelineRun: { id: value.pipelineRunId }, candidates: [] }), selectIdea: async (value) => ({ ...value, persisted: true }) };
  await withServer(adapter, async (base) => {
    const run = await fetch(`${base}/api/operator-preview/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipelineRunId: "run_http_001" }) });
    assert.equal(run.status, 201); assert.equal((await run.json()).pipelineRun.id, "run_http_001");
    const selection = await fetch(`${base}/api/operator-preview/idea-selections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ideaCandidateId: "idea_http_001" }) });
    assert.equal(selection.status, 201); assert.equal((await selection.json()).persisted, true);
  });
});

test("HTTP transmite MP4 exato com range sem aceitar path do cliente", async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-console-http-"));
  try {
    const path = join(root, "video.mp4"); writeFileSync(path, "0123456789");
    const adapter = { openVideo: async (id, hash) => ({ path, size: 10, id, sha256: hash }) };
    await withServer(adapter, async (base) => {
      const rejected = await fetch(`${base}/api/operator-preview/videos/video_console?sha256=${"a".repeat(64)}&path=C:%5Csecret`);
      assert.equal(rejected.status, 400);
      const response = await fetch(`${base}/api/operator-preview/videos/video_console?sha256=${"a".repeat(64)}`, { headers: { Range: "bytes=2-5" } });
      assert.equal(response.status, 206);
      assert.equal(await response.text(), "2345");
      assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("HTTP sanitiza erro público sem stack, path ou segredo", async () => {
  const adapter = { catalog: async () => { throw new Error("sk-secret C:\\Users\\private payload"); } };
  await withServer(adapter, async (base) => {
    const response = await getJson(`${base}/api/operator-preview/catalog`);
    assert.equal(response.status, 500);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of ["sk-secret", "C:\\Users", "payload", "stack"]) assert.equal(serialized.includes(forbidden), false);
    assert.equal(response.body.error.code, "INTERNAL_ERROR");
  });
});

async function withServer(adapter, operation) {
  const server = createServer(async (request, response) => {
    if (!await handleOperatorPreviewRequest(request, response, adapter)) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function getJson(url) { const response = await fetch(url); return { status: response.status, body: await response.json() }; }
