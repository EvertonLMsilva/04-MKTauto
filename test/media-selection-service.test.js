import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_SELECTION_REQUEST_VERSION, mediaSelectionRequestHash } from "../src/domain/media-selection-contracts.js";
import { MediaSelectionService } from "../src/media-selection-service.js";

test("V1 adquire somente imagem e V2 prioriza vídeo", async () => {
  for (const [profile, expected] of [["STATIC_IMAGE_V1", "IMAGE"], ["MIXED_MEDIA_V2", "VIDEO"]]) {
    const fixture = setup(profile);
    const selected = await fixture.service.select(request(profile));
    assert.equal(selected.assetType, expected);
    assert.equal(fixture.video.calls.length, profile === "MIXED_MEDIA_V2" ? 1 : 0);
    assert.equal(fixture.image.calls.length, profile === "STATIC_IMAGE_V1" ? 1 : 0);
  }
});

test("V2 faz fallback somente quando não há vídeo elegível e persiste a decisão", async () => {
  const fixture = setup("MIXED_MEDIA_V2", Object.assign(new Error("sem vídeo"), { code: "PROVIDER_NO_ELIGIBLE_VIDEO" }));
  const selected = await fixture.service.select(request("MIXED_MEDIA_V2"));
  assert.equal(selected.assetType, "IMAGE");
  assert.equal(fixture.repository.selection.fallbackCode, "PROVIDER_NO_ELIGIBLE_VIDEO");
  await fixture.service.select(request("MIXED_MEDIA_V2"));
  assert.equal(fixture.video.calls.length, 1); assert.equal(fixture.image.calls.length, 1);
});

test("direitos, integridade e autenticação nunca viram fallback", async () => {
  for (const code of ["COMMERCIAL_USE_REQUIRED", "PROVIDER_INVALID_VIDEO", "PROVIDER_AUTHENTICATION_FAILED"]) {
    const fixture = setup("MIXED_MEDIA_V2", Object.assign(new Error("private"), { code }));
    await assert.rejects(fixture.service.select(request("MIXED_MEDIA_V2")), (error) => error.code === code);
    assert.equal(fixture.image.calls.length, 0); assert.equal(fixture.repository.selection, null);
  }
});

test("contrato rejeita perfil e hash implícitos antes de qualquer aquisição", async () => {
  const fixture = setup("STATIC_IMAGE_V1");
  await assert.rejects(fixture.service.select({ ...request("STATIC_IMAGE_V1"), contentHash: "0".repeat(64) }), (error) => error.code === "CONTENT_HASH_MISMATCH");
  assert.equal(fixture.image.calls.length, 0); assert.equal(fixture.video.calls.length, 0);
});

function setup(profile, videoError = null) {
  const repository = {
    selection: null,
    getMediaSelection(id) { return this.selection?.id === id ? this.selection : null; },
    getScript() { return { scriptId: "script_001", contentHash: "a".repeat(64), pipelineRunId: "run_001" }; },
    getRun() { return { projectSnapshot: { channel: { productionProfile: profile } } }; },
    registerMediaSelection({ request: source, mediaAsset, fallbackCode }) { this.selection = { id: source.mediaSelectionRequestId, requestHash: source.contentHash, fallbackCode, mediaAsset }; return mediaAsset; },
  };
  const video = acquisition("VIDEO", videoError); const image = acquisition("IMAGE");
  return { repository, video, image, service: new MediaSelectionService(repository, { video, image }) };
}
function acquisition(assetType, error = null) { return { calls: [], async acquire(value) { this.calls.push(value); if (error) throw error; return { assetType }; } }; }
function request(productionProfile) { const value = { schemaVersion: MEDIA_SELECTION_REQUEST_VERSION, mediaSelectionRequestId: "selection_001", scriptId: "script_001", scriptContentHash: "a".repeat(64), visualDirectionPosition: 1, productionProfile, requestedAt: "2026-10-01T01:00:00.000Z", contentHash: "" }; return { ...value, contentHash: mediaSelectionRequestHash(value) }; }
