import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADAR_CONTRACT_VERSION, canonicalTrendIdentity } from "../src/domain/contracts.js";
import { RESEARCH_INPUT_CONTRACT_VERSION } from "../src/domain/research-contracts.js";
import { PROJECT_CONTRACT_VERSION } from "../src/domain/project-contracts.js";
import { retryClustering, runDailyTrendCatalog } from "../src/trend-daily.js";
import { exportDailyCatalog, renderHtml } from "../src/trend-export.js";
import { TrendCatalogStore, TrendStoreError } from "../src/trend-store.js";

const DATE = "2026-09-26";
const AT = "2026-09-26T12:00:00.000Z";

test("execução diária consolida fontes, ranking e artefatos sem repetir etapas no retry", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const input = researchInput();
    const args = { store, researchInput: input, outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() };
    const first = await runDailyTrendCatalog(args);
    assert.equal(first.dailyRun.state, "COMPLETED_WITH_GAPS");
    assert.deepEqual(first.dailyRun.result.rankedCandidateIds, ["tiktok:90001", "youtube:video-1"]);
    assert.equal(first.catalog.sourceRuns.length, 4);
    assert.equal(first.catalog.candidates.length, 3);
    assert.equal(first.catalog.scores.length, 3);
    assert.equal(first.artifact.pipelineRunId, "pipeline_e02_r02_001");
    assert.equal(first.artifact.projectId, "canal_educacao");
    assert.equal(first.artifact.projectVersion, 1);
    assert.throws(
      () => store.recordResearchArtifact({
        researchDailyRunId: first.dailyRun.id,
        artifact: { ...first.artifact, projectId: "outro_canal" },
      }),
      (error) => error instanceof TrendStoreError && error.code === "RESEARCH_ARTIFACT_REFERENCE_MISMATCH",
    );
    assert.throws(
      () => store.recordResearchArtifact({
        researchDailyRunId: first.dailyRun.id,
        artifact: { ...first.artifact, gaps: [...first.artifact.gaps, "ALTERED"] },
      }),
      (error) => error instanceof TrendStoreError && error.code === "RESEARCH_ARTIFACT_HASH_MISMATCH",
    );
    assert.deepEqual(calls, { youtube: 1, instagram: 1, threads: 1, tiktok: 1, clusters: 2 });
    const target = researchOutput(output, input);
    for (const file of ["catalog.json", "ranking.csv", "report.html"]) assert.equal(existsSync(join(target, file)), true);
    assert.equal(existsSync(join(target, "candidates", "youtube%3Avideo-1", "candidate.json")), true);
    await runDailyTrendCatalog(args);
    assert.deepEqual(calls, { youtube: 1, instagram: 1, threads: 1, tiktok: 1, clusters: 2 });
    assert.equal(store.getCandidateHistory("youtube:video-1").snapshots.length, 1);
  });
});

test("retry com a mesma identidade rejeita mudança material de configuração", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    const input = researchInput();
    await runDailyTrendCatalog({ store, researchInput: input, outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    await assert.rejects(
      runDailyTrendCatalog({ store, researchInput: input, outputRoot: output, config: { ...fullConfig(), regions: ["BR", "US"] }, ...dependencies, clock: fixedClock() }),
      (error) => error instanceof TrendStoreError && error.code === "RESEARCH_RUN_CONFLICT",
    );
  });
});

test("fontes sem configuração não são chamadas e preservam resultado válido do YouTube", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const result = await runDailyTrendCatalog({
      store, researchInput: researchInput(["youtube"]), outputRoot: output,
      config: { youtube: { apiKey: "configured" }, ollama: { model: "local" }, regions: ["BR"] },
      ...dependencies, clock: fixedClock(),
    });
    assert.deepEqual(calls, { youtube: 1, instagram: 0, threads: 0, tiktok: 0, clusters: 2 });
    assert.equal(result.catalog.candidates.length, 1);
    assert.equal(result.dailyRun.state, "COMPLETED_WITH_GAPS");
    assert.deepEqual(result.catalog.sourceRuns.map(({ status }) => status), ["SUCCESS"]);
  });
});

test("CSV neutraliza fórmula, HTML escapa conteúdo e catálogo não expõe segredos", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters(), "=HYPERLINK(\"x\")<script>alert(1)</script>");
    const input = researchInput();
    await runDailyTrendCatalog({ store, researchInput: input, outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    const target = researchOutput(output, input);
    const csv = readFileSync(join(target, "ranking.csv"), "utf8");
    const html = readFileSync(join(target, "report.html"), "utf8");
    const catalog = readFileSync(join(target, "catalog.json"), "utf8");
    assert.match(csv, /'=HYPERLINK/);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    for (const secret of ["youtube-secret", "instagram-secret", "threads-secret", "tiktok-secret"]) assert.equal(catalog.includes(secret), false);
  });
});

test("exportação de Research não antecipa shortlist global", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    const input = researchInput();
    const result = await runDailyTrendCatalog({ store, researchInput: input, outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    exportDailyCatalog({ store, researchDailyRunId: result.dailyRun.id, outputRoot: output });
    const catalog = JSON.parse(readFileSync(join(researchOutput(output, input), "catalog.json"), "utf8"));
    assert.deepEqual(catalog.selectionAudit, []);
  });
});

test("falha de escrita não substitui catálogo anterior", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    const input = researchInput();
    const result = await runDailyTrendCatalog({ store, researchInput: input, outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock() });
    const target = researchOutput(output, input);
    writeFileSync(join(target, "sentinel.txt"), "preservar", "utf8");
    const fileSystem = {
      exists: existsSync,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      write: () => { throw new Error("DISK_FULL"); },
      rename: () => assert.fail("rename não deve ocorrer antes da escrita completa"),
      rm: (path) => rmSync(path, { recursive: true, force: true }),
    };
    assert.throws(() => exportDailyCatalog({ store, researchDailyRunId: result.dailyRun.id, outputRoot: output, fileSystem }), /DISK_FULL/);
    assert.equal(readFileSync(join(target, "sentinel.txt"), "utf8"), "preservar");
  });
});

test("dois projetos executam na mesma data sem colisão e ficam rastreáveis", async () => {
  await withWorkspace(async ({ store, output }) => {
    const firstInput = researchInput(["youtube"]);
    const secondInput = researchInput(["youtube"], {
      pipelineRunId: "pipeline_e02_r02_002",
      projectId: "canal_ciencia",
      projectVersion: 3,
    });
    const first = await runDailyTrendCatalog({
      store, researchInput: firstInput, outputRoot: output, config: fullConfig(),
      ...fixtureDependencies(counters(), "Vídeo projeto 1", "p1"), clock: fixedClock(),
    });
    const second = await runDailyTrendCatalog({
      store, researchInput: secondInput, outputRoot: output, config: fullConfig(),
      ...fixtureDependencies(counters(), "Vídeo projeto 2", "p2"),
      clock: () => new Date("2026-09-26T12:00:01.000Z"),
    });
    assert.notEqual(first.dailyRun.id, second.dailyRun.id);
    assert.notEqual(first.catalog.run.id, second.catalog.run.id);
    assert.equal(first.artifact.projectId, "canal_educacao");
    assert.equal(second.artifact.projectId, "canal_ciencia");
    assert.equal(existsSync(join(researchOutput(output, firstInput), "catalog.json")), true);
    assert.equal(existsSync(join(researchOutput(output, secondInput), "catalog.json")), true);
  });
});

test("pipelineRunId não pode ser reutilizado por outro projeto", async () => {
  await withWorkspace(async ({ store, output }) => {
    const dependencies = fixtureDependencies(counters());
    await runDailyTrendCatalog({
      store, researchInput: researchInput(["youtube"]), outputRoot: output,
      config: fullConfig(), ...dependencies, clock: fixedClock(),
    });
    await assert.rejects(
      runDailyTrendCatalog({
        store,
        researchInput: researchInput(["youtube"], { projectId: "outro_canal" }),
        outputRoot: output, config: fullConfig(), ...dependencies, clock: fixedClock(),
      }),
      (error) => error instanceof TrendStoreError && error.code === "PIPELINE_RUN_ID_REUSED",
    );
  });
});

test("plano registra rede sem adapter e YouTube como dependência técnica", async () => {
  await withWorkspace(async ({ store, output }) => {
    const unsupportedCalls = counters();
    const unsupported = await runDailyTrendCatalog({
      store, researchInput: researchInput(["facebook"]), outputRoot: output,
      config: fullConfig(), ...fixtureDependencies(unsupportedCalls), clock: fixedClock(),
    });
    assert.deepEqual(unsupportedCalls, counters());
    assert.equal(unsupported.dailyRun.state, "FAILED");
    assert.deepEqual(unsupported.artifact.sourcePlan, [{
      network: "facebook", role: "CONFIGURED_NETWORK", adapter: "UNAVAILABLE",
      status: "UNSUPPORTED", sourceRunIds: [], gaps: ["UNSUPPORTED_NETWORK:FACEBOOK"],
    }]);

    const dependencyCalls = counters();
    const dependencyInput = researchInput(["instagram"], { pipelineRunId: "pipeline_e02_r02_002" });
    const dependency = await runDailyTrendCatalog({
      store, researchInput: dependencyInput, outputRoot: output,
      config: fullConfig(), ...fixtureDependencies(dependencyCalls, "Vídeo", "dependency"),
      clock: () => new Date("2026-09-26T12:00:01.000Z"),
    });
    assert.deepEqual(dependencyCalls, { youtube: 1, instagram: 1, threads: 0, tiktok: 0, clusters: 2 });
    assert.equal(dependency.artifact.sourcePlan.find(({ network }) => network === "youtube").role, "TECHNICAL_DEPENDENCY");
  });
});

test("idioma e contexto vêm do snapshot enquanto regiões permanecem operacionais", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const clusterInputs = [];
    const regions = [];
    const collectors = {
      ...dependencies.collectors,
      youtube: async (args) => {
        regions.push(args.regions);
        return dependencies.collectors.youtube(args);
      },
    };
    const clusterer = async (input) => {
      clusterInputs.push(input);
      return dependencies.clusterer(input);
    };
    const result = await runDailyTrendCatalog({
      store, researchInput: researchInput(["youtube"], { language: "es-ES" }), outputRoot: output,
      config: { ...fullConfig(), regions: ["US", "MX"] }, collectors, clusterer, clock: fixedClock(),
    });
    assert.deepEqual(regions, [["US", "MX"]]);
    assert.equal(clusterInputs.length, 2);
    assert.ok(clusterInputs.every(({ language }) => language === "es-ES"));
    assert.ok(clusterInputs.every(({ context }) => context.niche === "educação" && context.audience === "adultos curiosos"));
    assert.equal(result.artifact.timezone, "America/Sao_Paulo");
    assert.equal(result.artifact.analysisContext.language, "es-ES");
  });
});

test("relatório mantém links dos candidatos quando o ranking está indisponível", () => {
  const candidate = observation({ platform: "YOUTUBE", id: "video-1", title: "Vídeo sem ranking <script>", capturedAt: AT, runId: "run" }).candidate;
  const html = renderHtml({
    dailyRun: { logicalDate: DATE, timezone: "UTC", state: "COMPLETED_WITH_GAPS", gaps: ["ANALYSIS_FAILED"] },
    sourceRuns: [],
    candidates: [candidate],
    ranking: [],
  });
  assert.match(html, /Candidatos sem ranking/);
  assert.match(html, /Vídeo sem ranking/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /https:\/\/youtube\.com\/watch\?v=video-1/);
  assert.doesNotMatch(html, /<td>1<\/td>/);
});

test("relatório exibe views e dia publicado para candidatos ranqueados e sem ranking", () => {
  const ranked = observation({ platform: "YOUTUBE", id: "video-1", title: "Ranqueado", capturedAt: AT, runId: "run" });
  const unranked = observation({ platform: "TIKTOK", id: "90001", title: "Sem ranking", capturedAt: AT, runId: "run" });
  ranked.snapshot.metrics.views = { availability: "AVAILABLE", value: 1_234_567 };
  unranked.snapshot.metrics.views = { availability: "UNAVAILABLE", reason: "NOT_RETURNED" };
  unranked.candidate.publishedAt = "2026-09-24T23:30:00.000Z";
  unranked.candidate.durationSeconds = { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_PROVIDER" };
  const html = renderHtml({
    dailyRun: { logicalDate: DATE, timezone: "UTC", state: "COMPLETED_WITH_GAPS", gaps: [] },
    sourceRuns: [],
    candidates: [ranked.candidate, unranked.candidate],
    snapshots: [ranked.snapshot, unranked.snapshot],
    ranking: [{
      position: 1,
      top5: true,
      candidate: ranked.candidate,
      score: { value: 80, confidence: 0.75 },
    }],
  });
  assert.match(html, /Visualizações/);
  assert.match(html, /Publicado em/);
  assert.match(html, /1\.234\.567/);
  assert.match(html, /indisponível/);
  assert.match(html, /25\/09\/2026/);
  assert.match(html, /24\/09\/2026/);
  assert.match(html, /duração indisponível: NOT_EXPOSED_BY_PROVIDER/);
});

test("clustering usa no máximo cinco tentativas com backoff injetável", async () => {
  let calls = 0;
  const delays = [];
  const result = await retryClustering(async () => {
    calls += 1;
    if (calls < 5) throw new SyntaxError("resposta estruturada inválida");
    return "clusters válidos";
  }, {
    maxAttempts: 5,
    baseDelayMs: 100,
    sleep: async (delay) => delays.push(delay),
  });
  assert.deepEqual(result, { value: "clusters válidos", attempts: 5 });
  assert.deepEqual(delays, [100, 200, 400, 800]);
});

test("clustering não repete erro de configuração ou HTTP 4xx", async () => {
  let calls = 0;
  await assert.rejects(retryClustering(async () => {
    calls += 1;
    throw new Error("Ollama respondeu 400");
  }, { sleep: async () => assert.fail("não deve aguardar") }), /Ollama respondeu 400/);
  assert.equal(calls, 1);
});

test("clustering registra exaustão após cinco tentativas", async () => {
  let calls = 0;
  await assert.rejects(retryClustering(async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }, { sleep: async () => {} }), (error) => error.code === "OLLAMA_RETRY_EXHAUSTED" && error.attempts === 5);
  assert.equal(calls, 5);
});

test("execução diária recupera clustering transitório e registra tentativas", async () => {
  await withWorkspace(async ({ store, output }) => {
    const calls = counters();
    const dependencies = fixtureDependencies(calls);
    const delays = [];
    let attempts = 0;
    const clusterer = async (input) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("cluster incompleto");
        error.code = "INVALID_CLUSTER_MEMBERSHIP";
        error.retryFeedback = "Inclua os aliases ausentes: C002.";
        throw error;
      }
      if (attempts === 2) assert.equal(input.validationFeedback, "Inclua os aliases ausentes: C002.");
      if (attempts < 5) throw new SyntaxError("JSON incompleto");
      return dependencies.clusterer(input);
    };
    const result = await runDailyTrendCatalog({
      store, researchInput: researchInput(), outputRoot: output,
      config: fullConfig(), collectors: dependencies.collectors, clusterer,
      sleep: async (delay) => delays.push(delay), clock: fixedClock(),
    });
    assert.equal(result.catalog.scores.length, 3);
    assert.equal(result.dailyRun.steps.find(({ stepKey }) => stepKey === "20-seed-clustering").result.clusteringAttempts, 5);
    assert.equal(result.dailyRun.steps.find(({ stepKey }) => stepKey === "60-final-analysis").result.clusteringAttempts, 1);
    assert.deepEqual(delays, [250, 500, 1000, 2000]);
    assert.equal(attempts, 6);
  });
});

function fixtureDependencies(calls, title = "Vídeo útil", suffix = "") {
  const collectors = {
    youtube: async ({ store, idempotencyKey, capturedAt }) => {
      calls.youtube += 1;
      return store.recordOperation(batch({ platform: "YOUTUBE", id: "video-1", title, idempotencyKey, capturedAt, status: "SUCCESS", suffix }));
    },
    instagram: async ({ store, idempotencyKey, capturedAt }) => {
      calls.instagram += 1;
      return store.recordOperation(batch({ platform: "INSTAGRAM", idempotencyKey, capturedAt, status: "PARTIAL", noCandidate: true, suffix }));
    },
    threads: async ({ store, idempotencyKey, capturedAt }) => {
      calls.threads += 1;
      return store.recordOperation(batch({ platform: "THREADS", id: "18000000000000123", title: "Threads público", idempotencyKey, capturedAt, status: "PARTIAL", suffix }));
    },
    tiktok: async ({ store, idempotencyKey, capturedAt }) => {
      calls.tiktok += 1;
      return store.recordOperation(batch({ platform: "TIKTOK", id: "90001", title: "TikTok público", idempotencyKey, capturedAt, status: "SUCCESS", suffix }));
    },
  };
  const clusterer = async ({ evidence }) => {
    calls.clusters += 1;
    return [{
      label: "Assunto público", niche: "educação", subtheme: "explicação", likelyAudience: "público brasileiro",
      narrativePattern: "explicação direta", localization: "aplicável ao Brasil",
      candidateIds: evidence.map(({ candidateId }) => candidateId),
      evidenceSnapshotIds: evidence.flatMap(({ snapshots }) => snapshots.map(({ id }) => id)),
      explanation: "Agrupamento baseado somente nas evidências fornecidas.",
    }];
  };
  return { collectors, clusterer };
}

function batch({ platform, id, title, idempotencyKey, capturedAt, status, noCandidate = false, suffix = "" }) {
  const runId = `${platform.toLowerCase()}-run${suffix ? `-${suffix}` : ""}`;
  const sourceId = `${platform.toLowerCase()}-source${suffix ? `-${suffix}` : ""}`;
  const hasGap = status !== "SUCCESS";
  const observations = noCandidate ? [] : [observation({ platform, id, title, capturedAt, runId })];
  return {
    idempotencyKey,
    run: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: runId, state: hasGap ? "COMPLETED_WITH_GAPS" : "COMPLETED",
      createdAt: capturedAt, updatedAt: capturedAt, sourceRunIds: [sourceId],
      candidateIds: observations.map(({ candidate }) => candidate.id), rankingConfigVersion: "trend-ranking/1.0.0",
    },
    sourceRuns: [{
      schemaVersion: RADAR_CONTRACT_VERSION, id: sourceId, trendRunId: runId, platform, status,
      startedAt: capturedAt, completedAt: capturedAt,
      capabilities: { discovery: platform === "YOUTUBE" ? "GLOBAL_TRENDS" : platform === "INSTAGRAM" ? "HASHTAG_SEARCH" : "PUBLIC_QUERY", metrics: ["VIEWS", "LIKES"], supportsRegions: platform !== "INSTAGRAM", limitations: hasGap ? ["DURATION_UNAVAILABLE"] : [] },
      coverage: { requestedRegions: ["BR"], coveredRegions: hasGap ? [] : ["BR"], complete: !hasGap },
      gaps: hasGap ? ["PUBLIC_MEDIA_NOT_RANKABLE"] : [],
      ...(status === "PARTIAL" ? { errorCode: "PUBLIC_MEDIA_NOT_RANKABLE" } : {}),
    }],
    observations,
  };
}

function observation({ platform, id, title, capturedAt, runId }) {
  const canonicalUrl = platform === "YOUTUBE" ? `https://youtube.com/watch?v=${id}`
    : platform === "THREADS" ? `https://www.threads.net/@public/post/${id}`
      : `https://www.tiktok.com/@public/video/${id}`;
  const candidateId = `${platform.toLowerCase()}:${id}`;
  return {
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: candidateId,
      identityKey: canonicalTrendIdentity({ platform, platformVideoId: id, canonicalUrl }), platform, platformVideoId: id,
      canonicalUrl, state: "DISCOVERED", firstSeenAt: capturedAt, lastSeenAt: capturedAt, reappearanceCount: 1,
      durationSeconds: platform === "THREADS" ? { availability: "UNAVAILABLE", reason: "NOT_EXPOSED_BY_THREADS_API" } : 45,
      publishedAt: "2026-09-25T12:00:00.000Z", region: "BR", language: "pt-BR",
      usageCondition: "REFERENCE_ONLY", snapshotIds: [], topicClusterIds: [], title, author: "autor público",
    },
    snapshot: {
      schemaVersion: RADAR_CONTRACT_VERSION, id: `${platform.toLowerCase()}-snapshot:${runId}:${id}`, candidateId, capturedAt,
      metrics: {
        views: { availability: "AVAILABLE", value: platform === "YOUTUBE" ? 1000 : 500 },
        likes: { availability: "AVAILABLE", value: 100 }, comments: { availability: "AVAILABLE", value: 10 },
        shares: platform === "YOUTUBE" ? { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" } : { availability: "AVAILABLE", value: 5 },
      },
    },
    reappearanceReason: "PUBLIC_DISCOVERY",
  };
}

function fullConfig() {
  return {
    regions: ["BR"], youtube: { apiKey: "youtube-secret" }, ollama: { model: "local-model" },
    instagram: {
      accessToken: "instagram-secret", igUserId: "12345", apiVersion: "v24.0",
      eligibility: { professionalAccount: true, facebookPageLinked: true, permissionsGranted: true, appAccessApproved: true },
    },
    threads: {
      accessToken: "threads-secret", apiVersion: "v1.0", searchType: "TOP",
      eligibility: { basicGranted: true, keywordSearchGranted: true, appAccessApproved: true },
    },
    tiktok: {
      product: "RESEARCH_API", accessToken: "tiktok-secret",
      eligibility: { eligibleOrganization: true, nonCommercialResearch: true, ethicalReviewApproved: true, researchProjectApproved: true, researchScopeGranted: true, retentionControlsApproved: true },
    },
  };
}

function researchInput(networks = ["instagram", "threads", "tiktok", "youtube"], overrides = {}) {
  const projectId = overrides.projectId ?? "canal_educacao";
  const projectVersion = overrides.projectVersion ?? 1;
  return {
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution: {
      pipelineRunId: overrides.pipelineRunId ?? "pipeline_e02_r02_001",
      projectId,
      projectVersion,
      startedAt: AT,
    },
    window: { logicalDate: DATE },
    projectSnapshot: {
      schemaVersion: PROJECT_CONTRACT_VERSION,
      project: {
        id: projectId,
        name: "Canal Educação",
        version: projectVersion,
        niche: "educação",
        subniches: ["ciência prática"],
        audience: { profile: "adultos curiosos", language: overrides.language ?? "pt-BR" },
      },
      channel: {
        format: "short_video", aspectRatio: "9:16", minDurationSeconds: 25, maxDurationSeconds: 45,
        editorialStyle: "informative", visualStyle: "dynamic", voiceStyle: "informative",
        publishing: { contentsPerDay: 1, networks, timezone: "America/Sao_Paulo", times: ["10:00"] },
      },
      references: [],
    },
  };
}

function researchOutput(output, input) {
  return join(output, input.execution.projectId, `v${input.execution.projectVersion}`, DATE, input.execution.pipelineRunId);
}

function counters() { return { youtube: 0, instagram: 0, threads: 0, tiktok: 0, clusters: 0 }; }
function fixedClock() { return () => new Date(AT); }

async function withWorkspace(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-daily-"));
  const store = new TrendCatalogStore(join(directory, "catalog.sqlite"));
  try {
    await callback({ store, output: join(directory, "trends") });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
