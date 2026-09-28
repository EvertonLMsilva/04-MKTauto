import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_ASSET_CONTRACT_VERSION,
  mediaAssetIdentityHash,
  validateMediaAsset,
} from "../src/domain/media-asset-contracts.js";

test("valida e congela ativo com identidade reproduzível", () => {
  const value = validateMediaAsset(mediaAsset());
  assert.equal(value.schemaVersion, MEDIA_ASSET_CONTRACT_VERSION);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.technicalProperties), true);
  assert.equal(Object.isFrozen(value.rights), true);
  assert.equal(mediaAssetIdentityHash(value), mediaAssetIdentityHash(structuredClone(value)));
});

test("separa tipo lógico das propriedades técnicas aplicáveis", () => {
  assert.throws(() => validateMediaAsset(mediaAsset({ assetType: "EXECUTABLE" })), contractError("INVALID_ASSET_TYPE", "assetType"));
  assert.throws(() => validateMediaAsset(mediaAsset({ technicalProperties: technical({ format: "exe" }) })), contractError("INVALID_MEDIA_FORMAT", "technicalProperties.format"));
  assert.throws(() => validateMediaAsset(mediaAsset({ technicalProperties: technical({ durationMilliseconds: 1 }) })), contractError("DURATION_NOT_APPLICABLE", "technicalProperties.durationMilliseconds"));
  assert.throws(() => validateMediaAsset(mediaAsset({ assetType: "VIDEO", technicalProperties: technical({ format: "mp4" }) })), contractError("DURATION_REQUIRED", "technicalProperties.durationMilliseconds"));
  assert.doesNotThrow(() => validateMediaAsset(mediaAsset({
    assetType: "VIDEO",
    technicalProperties: technical({ format: "mp4", durationMilliseconds: 4120 }),
  })));
});

test("exige direitos comerciais explícitos e provider somente para origem dependente", () => {
  const missingRights = mediaAsset();
  delete missingRights.rights;
  assert.throws(() => validateMediaAsset(missingRights), contractError("REQUIRED_FIELD", "mediaAsset.rights"));
  assert.throws(() => validateMediaAsset(mediaAsset({ rights: { usageBasis: "UNKNOWN", commercialUseAllowed: true } })), contractError("INVALID_USAGE_BASIS", "rights.usageBasis"));
  assert.throws(() => validateMediaAsset(mediaAsset({ rights: { usageBasis: "OWNED", commercialUseAllowed: false } })), contractError("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"));
  assert.throws(() => validateMediaAsset(mediaAsset({ origin: "AUTHORIZED_THIRD_PARTY" })), contractError("RIGHTS_ORIGIN_MISMATCH", "rights.usageBasis"));
  assert.throws(() => validateMediaAsset(mediaAsset({ origin: "SOCIAL_REFERENCE" })), contractError("INVALID_MEDIA_ORIGIN", "origin"));
  assert.doesNotThrow(() => validateMediaAsset(mediaAsset({ provider: null })));
  assert.throws(() => validateMediaAsset(mediaAsset({ origin: "PROVIDER_GENERATED", provider: null, rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true } })), contractError("PROVIDER_REQUIRED", "provider"));
  assert.throws(() => validateMediaAsset(mediaAsset({ origin: "OPERATOR_OWNED", provider: "provider_test" })), contractError("PROVIDER_NOT_APPLICABLE", "provider"));
});

test("mantém referência lógica opaca e rejeita bytes, URL, caminho e localização", () => {
  for (const mediaReference of [
    "https://private.example/media.png",
    "file:///private/media.png",
    "data:base64payload",
    "C:\\private\\media.png",
    "/var/private/media.png",
    "s3:private_bucket_key",
    "storage:bucket_asset",
    "media:token_secret",
  ]) {
    assert.throws(() => validateMediaAsset(mediaAsset({ mediaReference })), contractError("INVALID_MEDIA_REFERENCE", "mediaReference"));
  }
  for (const field of ["bytes", "base64", "signedUrl", "localPath", "storageLocation", "token"]) {
    assert.throws(() => validateMediaAsset(mediaAsset({ [field]: "private" })), contractError("UNKNOWN_FIELD", `mediaAsset.${field}`));
  }
});

test("exige posição visual, hashes e revisão coerentes", () => {
  assert.throws(() => validateMediaAsset(mediaAsset({ visualDirectionPosition: 0 })), contractError("INVALID_VISUAL_DIRECTION_POSITION", "visualDirectionPosition"));
  assert.throws(() => validateMediaAsset(mediaAsset({ contentHash: "x".repeat(64) })), contractError("INVALID_HASH", "contentHash"));
  assert.throws(() => validateMediaAsset(mediaAsset({ revision: 2 })), contractError("SUPERSEDED_MEDIA_ASSET_REQUIRED", "supersedesMediaAssetId"));
  assert.throws(() => validateMediaAsset(mediaAsset({ technicalProperties: technical({ widthPixels: null }) })), contractError("INVALID_MEDIA_DIMENSION", "technicalProperties.widthPixels"));
});

function technical(overrides = {}) {
  return { format: "png", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: null, ...overrides };
}

function mediaAsset(overrides = {}) {
  return {
    schemaVersion: MEDIA_ASSET_CONTRACT_VERSION,
    mediaAssetId: "media_asset_001",
    pipelineRunId: "run_e06_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    scriptId: "script_001",
    scriptContentHash: "a".repeat(64),
    visualDirectionPosition: 1,
    assetType: "IMAGE",
    technicalProperties: technical(),
    contentHash: "b".repeat(64),
    mediaReference: "media:asset_001",
    origin: "OPERATOR_OWNED",
    provider: null,
    rights: { usageBasis: "OWNED", commercialUseAllowed: true },
    createdAt: "2026-09-28T21:00:00.000Z",
    revision: 1,
    supersedesMediaAssetId: null,
    ...overrides,
  };
}

function contractError(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
