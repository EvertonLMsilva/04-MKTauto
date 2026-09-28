import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectSnapshot } from "../src/domain/project-contracts.js";
import { RESEARCH_INPUT_CONTRACT_VERSION, createResearchInput } from "../src/domain/research-contracts.js";
import {
  ReferenceAnalysisError,
  analysisWindowFor,
  analyzeStrategicReferences,
} from "../src/reference-analysis.js";
import { TrendCatalogStore, TrendStoreError } from "../src/trend-store.js";

const NOW = "2026-09-27T15:00:00.000Z";

test("analisa somente handles configurados, agrega sinais e não persiste texto-fonte", async () => {
  await withStore(async (store) => {
    const calls = [];
    const providers = {
      youtube: async ({ handle }) => {
        calls.push(["youtube", handle]);
        return providerResult("youtube", handle);
      },
    };
    const artifact = await analyzeStrategicReferences({
      researchInput: input({ references: [reference("youtube", "@CanalOficial"), reference("facebook", "PaginaPublica")] }),
      store, providers, clock: () => NOW,
    });

    assert.deepEqual(calls, [["youtube", "@CanalOficial"]]);
    assert.deepEqual(artifact.references.map(({ platform, status }) => [platform, status]), [
      ["youtube", "SUCCESS"], ["facebook", "UNSUPPORTED"],
    ]);
    assert.equal(artifact.state, "COMPLETED_WITH_GAPS");
    assert.equal(artifact.patterns.some(({ dimension, value }) => dimension === "FORMAT_MIX" && value === "VIDEO"), true);
    assert.equal(artifact.patterns.some(({ dimension, value }) => dimension === "CTA_STYLE" && value === "FOLLOW"), true);
    assert.equal(JSON.stringify(artifact).includes("texto exclusivo"), false);
    assert.equal(JSON.stringify(store.getReferenceAnalysisRun(runId(artifact))).includes("texto exclusivo"), false);
    assert.equal(artifact.rights.usageCondition, "strategic_reference_only");
  });
});

test("retry retorna o mesmo artefato sem consultar provider novamente", async () => {
  await withStore(async (store) => {
    let calls = 0;
    const providers = { youtube: async () => { calls += 1; return providerResult("youtube", "canal"); } };
    const researchInput = input({ references: [reference("youtube", "canal")] });
    const first = await analyzeStrategicReferences({ researchInput, store, providers, clock: () => NOW });
    const retry = await analyzeStrategicReferences({ researchInput, store, providers, clock: () => "2026-09-27T16:00:00.000Z" });
    assert.deepEqual(retry, first);
    assert.equal(calls, 1);
  });
});

test("pipelineRunId não pode misturar projeto, versão ou snapshot", async () => {
  await withStore(async (store) => {
    const providers = { youtube: async () => providerResult("youtube", "canal") };
    await analyzeStrategicReferences({ researchInput: input({ references: [reference("youtube", "canal")] }), store, providers, clock: () => NOW });
    await assert.rejects(
      () => analyzeStrategicReferences({
        researchInput: input({ projectId: "outro_projeto", references: [reference("youtube", "canal")] }),
        store, providers, clock: () => NOW,
      }),
      (error) => error instanceof TrendStoreError && error.code === "PIPELINE_RUN_ID_REUSED",
    );
  });
});

test("colisão canônica falha antes de chamar provider", async () => {
  await withStore(async (store) => {
    let calls = 0;
    await assert.rejects(
      () => analyzeStrategicReferences({
        researchInput: input({ references: [reference("instagram", "@Perfil"), reference("instagram", "perfil")] }),
        store,
        providers: { instagram: async () => { calls += 1; return providerResult("instagram", "perfil"); } },
        clock: () => NOW,
      }),
      (error) => error instanceof ReferenceAnalysisError && error.code === "DUPLICATE_REFERENCE_TARGET",
    );
    assert.equal(calls, 0);
  });
});

test("sem referências produz artefato vazio e nenhuma chamada externa", async () => {
  await withStore(async (store) => {
    const artifact = await analyzeStrategicReferences({ researchInput: input({ references: [] }), store, providers: {}, clock: () => NOW });
    assert.deepEqual(artifact.references, []);
    assert.deepEqual(artifact.patterns, []);
    assert.deepEqual(artifact.gaps, ["NO_CONFIGURED_REFERENCES"]);
  });
});

test("persistência recusa texto-fonte mesmo fora do orquestrador", async () => {
  await withStore(async (store) => {
    const researchInput = input({ references: [] });
    await analyzeStrategicReferences({ researchInput, store, providers: {}, clock: () => NOW });
    const artifact = store.db.prepare("SELECT reference_analysis_run_id AS id FROM reference_insights").get();
    store.startReferenceAnalysisStep({ referenceAnalysisRunId: artifact.id, referenceKey: "reference:ffffffffffffffffffffffff", startedAt: NOW });
    assert.throws(
      () => store.finishReferenceAnalysisStep({
        referenceAnalysisRunId: artifact.id,
        referenceKey: "reference:ffffffffffffffffffffffff",
        state: "COMPLETED", completedAt: NOW, durationMs: 0,
        result: { sourceText: "não persistir" },
      }),
      (error) => error instanceof TrendStoreError && error.code === "FORBIDDEN_REFERENCE_STEP_FIELD",
    );
  });
});

test("janela usa trinta dias civis no timezone do snapshot", () => {
  assert.deepEqual(analysisWindowFor("2026-09-27", "America/Sao_Paulo"), {
    start: "2026-08-29T03:00:00.000Z",
    end: "2026-09-28T03:00:00.000Z",
    timezone: "America/Sao_Paulo",
    maxItemsPerReference: 25,
  });
});

function providerResult(platform, handle) {
  const host = platform === "instagram" ? "instagram.com" : "youtube.com";
  return {
    capability: "PUBLIC_HANDLE_UPLOADS",
    status: "SUCCESS",
    gaps: [],
    items: [1, 2, 3].map((index) => ({
      providerContentId: `video-${index}`,
      canonicalUrl: platform === "instagram"
        ? `https://${host}/reel/item-${index}`
        : `https://${host}/watch?v=item-${index}`,
      publishedAt: `2026-09-2${index}T12:00:00.000Z`,
      mediaType: "VIDEO",
      durationSeconds: 45,
      sourceText: `Como usar produtividade, siga para mais texto exclusivo ${index}`,
    })),
  };
}

function input({ projectId = "project_curiosidades_ia", version = 1, references = [] } = {}) {
  return createResearchInput({
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution: { pipelineRunId: "run_e02_r03_001", projectId, projectVersion: version, startedAt: NOW },
    window: { logicalDate: "2026-09-27" },
    projectSnapshot: createProjectSnapshot({
      id: projectId,
      name: "Projeto",
      version,
      niche: "inteligência artificial",
      subniches: ["produtividade"],
      audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" },
      references,
      channel: { publishing: { contentsPerDay: 1, networks: ["youtube"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
    }),
  });
}

function reference(platform, handle) { return { platform, handle, purpose: "strategic_reference" }; }
function runId(artifact) { return `reference-analysis:${artifact.artifactId.split(":")[1]}`; }

async function withStore(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-references-"));
  const store = new TrendCatalogStore(join(directory, "catalog.sqlite"));
  try { await callback(store); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}
