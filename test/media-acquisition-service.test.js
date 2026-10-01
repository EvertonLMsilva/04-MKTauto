import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestHash } from "../src/domain/media-acquisition-contracts.js";
import { MediaAcquisitionError, MediaAcquisitionService } from "../src/media-acquisition-service.js";
import { MediaProvider } from "../src/media-provider.js";

test("obtém uma vez com entrada pública derivada da direção e do snapshot", async () => {
  const repository = fakeRepository();
  const provider = fakeProvider();
  const created = await new MediaAcquisitionService(repository, provider).acquire(request());
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(provider.calls[0], {
    logicalCallId: "media_acquisition_001", assetType: "IMAGE",
    visualDirection: { position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." },
    projectContext: {
      projectId: "project_e06", projectVersion: 1, language: "pt-BR",
      audienceProfile: "Pessoas interessadas em tecnologia", niche: "tecnologia",
      contentFormat: "short_video", aspectRatio: "9:16", visualStyle: "dynamic",
    },
  });
  assert.equal(created.mediaAssetId, "media_asset:media_acquisition_001");
  assert.deepEqual(created.technicalProperties, provider.result.technicalProperties);
  assert.equal(repository.persisted.length, 1);
});

test("retry terminal retorna ativo persistido sem nova chamada", async () => {
  const repository = fakeRepository();
  const first = await new MediaAcquisitionService(repository, fakeProvider()).acquire(request());
  repository.prior = { requestHash: request().contentHash, mediaAsset: first };
  const provider = fakeProvider();
  assert.deepEqual(await new MediaAcquisitionService(repository, provider).acquire(request()), first);
  assert.equal(provider.calls.length, 0);
});

test("liga telemetria e custo comprovável ao ativo sem inventar custo ausente", async () => {
  const repository = fakeRepository();
  const provider = fakeProvider({ telemetry: observation() });
  await new MediaAcquisitionService(repository, provider, { now: () => "2026-09-29T12:00:01.000Z" }).acquire(request());
  const persisted = repository.persisted[0];
  assert.equal(persisted.telemetry.artifactId, "media_asset:media_acquisition_001");
  assert.equal(persisted.telemetry.requestHash, request().contentHash);
  assert.equal(persisted.costEvent.category, "media_cost");
  assert.equal(persisted.costEvent.amount, "0.0605");

  const withoutUsage = fakeRepository();
  await new MediaAcquisitionService(withoutUsage, fakeProvider({ telemetry: observation({ inputTokens: null, outputTokens: null, usageOrigin: null, costAmount: null, currency: null, costOrigin: null }) })).acquire(request());
  assert.equal(withoutUsage.persisted[0].telemetry.costEventId, null);
  assert.equal(withoutUsage.persisted[0].costEvent, null);
});

test("conflito de identidade falha antes de roteiro e provider", async () => {
  const repository = fakeRepository();
  repository.prior = { requestHash: "f".repeat(64), mediaAsset: {} };
  const provider = fakeProvider();
  await assert.rejects(new MediaAcquisitionService(repository, provider).acquire(request()), acquisitionError("MEDIA_ACQUISITION_REQUEST_ID_REUSED", "mediaAcquisitionRequestId"));
  assert.deepEqual(repository.reads, ["acquisition"]);
  assert.equal(provider.calls.length, 0);
});

test("revalida hash, escopo e direção antes do provider", async () => {
  const invalid = fakeRepository();
  await assert.rejects(new MediaAcquisitionService(invalid, fakeProvider()).acquire({ ...request(), contentHash: "f".repeat(64) }), acquisitionError("CONTENT_HASH_MISMATCH", "contentHash"));
  assert.deepEqual(invalid.reads, []);
  const mismatch = fakeRepository();
  const provider = fakeProvider();
  await assert.rejects(new MediaAcquisitionService(mismatch, provider).acquire(request({ visualDirectionPosition: 3 })), acquisitionError("VISUAL_DIRECTION_NOT_FOUND", "visualDirectionPosition"));
  assert.equal(provider.calls.length, 0);
});

test("rejeita saída não confiável ou divergente sem persistir", async () => {
  for (const [change, code, field] of [
    [{ assetType: "VIDEO", technicalProperties: { format: "mp4", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: 1000 } }, "MEDIA_ASSET_TYPE_MISMATCH", "assetType"],
    [{ mediaReference: "C:/private/image.png" }, "INVALID_MEDIA_REFERENCE", "mediaReference"],
    [{ rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: false } }, "COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"],
    [{ telemetry: observation({ provider: "other" }) }, "PROVIDER_TELEMETRY_MISMATCH", "provider"],
    [{ telemetry: observation({ outputHash: "c".repeat(64) }) }, "PROVIDER_TELEMETRY_MISMATCH", "outputHash"],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(new MediaAcquisitionService(repository, fakeProvider(change)).acquire(request()), acquisitionError(code, field));
    assert.equal(repository.persisted.length, 0);
  }
});

test("sanitiza falha externa sem persistência parcial", async () => {
  const repository = fakeRepository();
  let caught;
  try { await new MediaAcquisitionService(repository, fakeProvider({}, new Error("PRIVATE token raw payload"))).acquire(request()); } catch (error) { caught = error; }
  assert.equal(caught?.code, "PROVIDER_FAILED");
  assert.equal(caught?.message.includes("PRIVATE"), false);
  assert.equal(repository.persisted.length, 0);

  const providerFailure = Object.assign(new Error("PRIVATE resposta e token"), { code: "PROVIDER_INVALID_IMAGE", field: "image" });
  let preserved;
  try { await new MediaAcquisitionService(fakeRepository(), fakeProvider({}, providerFailure)).acquire(request()); } catch (error) { preserved = error; }
  assert.equal(preserved?.code, "PROVIDER_INVALID_IMAGE");
  assert.equal(preserved?.field, "image");
  assert.equal(preserved?.message.includes("PRIVATE"), false);
  assert.equal(preserved?.cause, providerFailure);

  const fallbackField = Object.assign(new Error("private"), { code: "PROVIDER_RATE_LIMITED" });
  await assert.rejects(new MediaAcquisitionService(fakeRepository(), fakeProvider({}, fallbackField)).acquire(request()), acquisitionError("PROVIDER_RATE_LIMITED", "provider"));

  for (const unsafe of [
    Object.assign(new Error("private"), { code: "provider_invalid_image", field: "image" }),
    Object.assign(new Error("private"), { code: "PROVIDER-INVALID-IMAGE", field: "image" }),
  ]) await assert.rejects(new MediaAcquisitionService(fakeRepository(), fakeProvider({}, unsafe)).acquire(request()), acquisitionError("PROVIDER_FAILED", "provider"));
});

function fakeRepository() {
  return {
    prior: null, reads: [], persisted: [],
    script: {
      scriptId: "script_001", pipelineRunId: "run_e06_001", projectId: "project_e06", projectVersion: 1,
      contentHash: "a".repeat(64), visualDirections: [
        { position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." },
        { position: 2, blockPosition: 1, description: "Pessoa marcando uma tarefa concluída." },
      ],
    },
    run: {
      pipelineRunId: "run_e06_001", projectId: "project_e06", projectVersion: 1,
      projectSnapshot: {
        project: { id: "project_e06", version: 1, niche: "tecnologia", audience: { language: "pt-BR", profile: "Pessoas interessadas em tecnologia" } },
        channel: { format: "short_video", aspectRatio: "9:16", visualStyle: "dynamic" },
      },
    },
    getMediaAcquisition() { this.reads.push("acquisition"); return this.prior; },
    getScript() { this.reads.push("script"); return this.script; },
    getRun() { this.reads.push("run"); return this.run; },
    registerAcquiredMediaAsset(value) { this.persisted.push(value); return value.mediaAsset; },
  };
}

function fakeProvider(overrides = {}, failure = null) {
  return new class extends MediaProvider {
    constructor() {
      super(); this.calls = [];
      this.result = {
        assetType: "IMAGE", technicalProperties: { format: "png", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: null },
        contentHash: "b".repeat(64), mediaReference: "media:acquired_001",
        origin: "PROVIDER_GENERATED", provider: "provider_test",
        rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }, ...overrides,
      };
    }
    async provide(input) { this.calls.push(input); if (failure) throw failure; return this.result; }
  }();
}

function request(overrides = {}) {
  const value = {
    schemaVersion: MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestId: "media_acquisition_001",
    scriptId: "script_001", scriptContentHash: "a".repeat(64), visualDirectionPosition: 1,
    assetType: "IMAGE", requestedAt: "2026-09-28T22:00:00.000Z", contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = mediaAcquisitionRequestHash(value);
  return value;
}

function observation(overrides = {}) {
  return {
    provider: "provider_test", model: "gpt-image-2.5-flare-2026-09-08",
    taskType: "image_generation", promptVersion: "openai-image-prompt/1.0.0",
    inputTokens: 100, outputTokens: 2000, cachedInputTokens: null,
    usageOrigin: "provider_response", costAmount: "0.0605", currency: "USD",
    costOrigin: "calculated_openai_image_pricing_2026_09_29", latencyMs: 125,
    occurredAt: "2026-09-29T12:00:00.000Z", fallback: false,
    inputHash: "c".repeat(64), outputHash: "b".repeat(64), ...overrides,
  };
}

function acquisitionError(code, field) { return (caught) => caught instanceof MediaAcquisitionError && caught.code === code && caught.field === field; }
