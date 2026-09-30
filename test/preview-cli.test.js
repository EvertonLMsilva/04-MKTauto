import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreviewCli } from "../src/preview-cli.js";
import { createPreviewReadRuntime, createPreviewRuntime } from "../src/preview-runtime.js";

test("package expõe npm run preview com carregamento opcional do .env", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.preview, "node --env-file-if-exists=.env src/preview-cli.js");
});

test("CLI executa seleção explícita e informa nova execução com referência local", async () => {
  const fixture = scenario();
  const progress = [];
  const result = await runPreviewCli(args(fixture.database), {
    runtimeFactory: () => fixture.runtime,
    now: () => "2026-09-30T15:00:00.000Z",
    onProgress: (event) => progress.push(event),
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    executionMode: "NEW",
    localPath: fixture.localPath,
    logicalReference: fixture.preview.logicalReference,
    pipelineRunId: fixture.run.pipelineRunId,
    qualityControl: {
      approvalBlocked: false,
      findings: [{ code: "VIDEO_SHA256_MATCH", status: "PASS" }],
      reportId: "quality_control:fixture",
      result: "PASS",
    },
    sha256: fixture.preview.contentHash,
    status: "SUCCEEDED",
    videoRenderId: fixture.preview.id,
  });
  assert.deepEqual(progress.map(({ stage }) => stage), ["VALIDATING", "PREPARING", "EXECUTING", "QUALITY_CONTROL", "COMPLETED"]);
  assert.equal(fixture.calls.resume.length, 1);
  assert.equal(fixture.calls.execute.length, 1);
  assert.equal(fixture.calls.qualityControl.length, 1);
  assert.equal(fixture.calls.close, 1);
  assert.equal(fixture.calls.execute[0].ideaSelectionId, fixture.selection.ideaSelectionId);
  assert.equal(fixture.calls.execute[0].contentHash.length, 64);
  assert.equal("localPath" in fixture.calls.execute[0], false);
});

test("CLI distingue retomada e reutilização de estado terminal", async () => {
  for (const [state, script, expected] of [["RUNNING", { scriptId: "script_existing" }, "RESUMED"], ["SUCCEEDED", null, "REUSED_TERMINAL"]]) {
    const fixture = scenario({ state, script });
    const result = await runPreviewCli(args(fixture.database), { runtimeFactory: () => fixture.runtime });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).executionMode, expected);
    assert.equal(fixture.calls.execute.length, 1);
    assert.equal(fixture.calls.qualityControl.length, 1);
  }
});

test("CLI exige projeto, versão e seleção, rejeita escopo divergente e não executa pipeline", async () => {
  const missing = await runPreviewCli([]);
  assertError(missing, "REQUIRED_OPTION", "projectId");

  const fixture = scenario({ selection: { projectVersion: 2 } });
  const mismatch = await runPreviewCli(args(fixture.database), { runtimeFactory: () => fixture.runtime });
  assertError(mismatch, "SELECTION_SCOPE_MISMATCH", "projectVersion");
  assert.equal(fixture.calls.execute.length, 0);
  assert.equal(fixture.calls.close, 1);
});

test("CLI sanitiza falhas sem credencial, path privado, payload ou stack", async () => {
  const fixture = scenario();
  const secret = "sk-private-credential";
  fixture.runtime.previews.execute = async () => {
    const error = new Error(`payload ${secret} ${fixture.database}`);
    error.code = "PREVIEW_FAILED";
    error.field = "preview";
    throw error;
  };
  const result = await runPreviewCli(args(fixture.database), { runtimeFactory: () => fixture.runtime });
  assertError(result, "PREVIEW_FAILED", "preview");
  for (const forbidden of [secret, fixture.database, "payload", "stack", " at "]) assert.equal(result.stderr.includes(forbidden), false);
});

test("runtime compõe somente adapters e services reais e fecha repositórios", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-preview-runtime-"));
  try {
    const database = join(root, "mktauto.sqlite");
    const runtime = createPreviewRuntime({ database, env: runtimeEnv(root) });
    assert.equal(typeof runtime.pipelineRuns.resume, "function");
    assert.equal(typeof runtime.previews.execute, "function");
    assert.equal(typeof runtime.qualityControl.inspect, "function");
    assert.equal(typeof runtime.selections.get, "function");
    assert.equal(typeof runtime.lookup.getScript, "function");
    assert.equal(typeof runtime.referenceResolver.resolveVideo, "function");
    runtime.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime de leitura recupera catálogo sem exigir providers ou FFmpeg", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-preview-read-runtime-"));
  try {
    const runtime = createPreviewReadRuntime({ database: join(root, "mktauto.sqlite"), env: {} });
    assert.deepEqual(runtime.catalog.listProjects(), []);
    assert.equal(typeof runtime.referenceResolver.resolveVideo, "function");
    runtime.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function args(database) {
  return ["--project-id", "project_e07", "--project-version", "1", "--selection-id", "selection_e07_001", "--database", database];
}

function scenario({ state = "RUNNING", script = null, selection: selectionOverrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-preview-cli-"));
  const database = join(root, "mktauto.sqlite");
  writeFileSync(database, "fixture", "utf8");
  const selection = { ideaSelectionId: "selection_e07_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1, contentHash: "9".repeat(64), ...selectionOverrides };
  const run = { pipelineRunId: selection.pipelineRunId, projectId: "project_e07", projectVersion: 1, state, startedAt: "2026-09-30T14:00:00.000Z" };
  const preview = { id: "video_render:subtitle:preview", contentHash: "f".repeat(64), logicalReference: `render:sha256_${"f".repeat(64)}` };
  const localPath = join(root, "render", `${preview.contentHash}.mp4`);
  const calls = { resume: [], execute: [], qualityControl: [], close: 0 };
  const runtime = {
    selections: { get: () => selection },
    pipelineRuns: {
      get: () => run,
      resume: (value) => { calls.resume.push(value); return run; },
    },
    lookup: { getScript: () => script },
    previews: { execute: async (value) => { calls.execute.push(value); run.state = "SUCCEEDED"; return { previewVideoRender: preview }; } },
    qualityControl: { inspect: async (value) => { calls.qualityControl.push(value); return { qualityControlReportId: "quality_control:fixture", result: "PASS", approvalBlocked: false, findings: [{ code: "VIDEO_SHA256_MATCH", status: "PASS" }] }; } },
    referenceResolver: { resolveVideo: async () => localPath },
    close: () => { calls.close += 1; rmSync(root, { recursive: true, force: true }); },
  };
  return { database, selection, run, preview, localPath, runtime, calls };
}

function runtimeEnv(root) {
  return {
    OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model",
    OPENAI_VOICE_COMMERCIAL_USE_ALLOWED: "true", OPENAI_VOICE_STORAGE_ROOT: join(root, "voice"),
    OPENAI_IMAGE_COMMERCIAL_USE_ALLOWED: "true", OPENAI_IMAGE_TERMS_VERSION: "2026-09-30", OPENAI_IMAGE_STORAGE_ROOT: join(root, "media"),
    FFMPEG_PATH: join(root, "ffmpeg.exe"), FFPROBE_PATH: join(root, "ffprobe.exe"),
    FFMPEG_VOICE_ROOT: join(root, "voice"), FFMPEG_MEDIA_ROOT: join(root, "media"), FFMPEG_RENDER_ROOT: join(root, "render"),
  };
}

function assertError(result, code, field) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr).error;
  assert.deepEqual({ code: error.code, field: error.field }, { code, field });
  assert.equal(typeof error.message, "string");
  assert.equal("stack" in error, false);
}
