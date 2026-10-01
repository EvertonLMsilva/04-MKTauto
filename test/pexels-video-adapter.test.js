import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { PexelsVideoAdapter } from "../src/adapters/pexels-video.js";
import { PEXELS_VIDEO_ENDPOINT, loadPexelsVideoConfig } from "../src/pexels-video-config.js";

test("usa endpoint V1, seleção determinística e preserva atribuição Pexels", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return response(200, "application/json", JSON.stringify(searchBody()));
    return response(200, "video/mp4", Buffer.from("physical-video"));
  };
  const storage = { async store(bytes) {
    assert.equal(bytes.toString(), "physical-video");
    return { format: "mp4", mimeType: "video/mp4", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: 30000, hasAudio: false, contentHash: "a".repeat(64), mediaReference: `media:sha256_${"a".repeat(64)}` };
  } };
  const output = await new PexelsVideoAdapter(config(), { fetchImpl, storage }).provide(input());
  const requested = new URL(calls[0].url);
  assert.equal(`${requested.origin}${requested.pathname}`, PEXELS_VIDEO_ENDPOINT);
  assert.equal(requested.searchParams.get("orientation"), "portrait");
  assert.equal(requested.searchParams.get("size"), "medium");
  assert.equal(calls[0].options.headers.authorization, "pexels-secret");
  assert.equal(output.assetType, "VIDEO");
  assert.deepEqual(output.source, {
    externalAssetId: "2499611", licenseName: "Pexels License", licenseUrl: "https://www.pexels.com/license/",
    photographerName: "Joey Farina", photographerUrl: "https://www.pexels.com/@joey",
    sourceUrl: "https://www.pexels.com/video/2499611/",
  });
  assert.equal(output.technicalProperties.hasAudio, false);
});

test("não repete ID externo e falha de forma sanitizada sem candidato", async () => {
  const adapter = new PexelsVideoAdapter(config(), { fetchImpl: async () => response(200, "application/json", JSON.stringify(searchBody())), storage: { store: async () => assert.fail("não deve baixar") } });
  await assert.rejects(adapter.provide(input({ excludedExternalAssetIds: ["2499611"] })), (error) => error.code === "PROVIDER_NO_ELIGIBLE_VIDEO" && !error.message.includes("pexels-secret"));
});

test("descarta clipe físico inválido e tenta o próximo candidato elegível", async () => {
  const body = searchBody();
  body.videos.push({ ...structuredClone(body.videos[0]), id: 2499612, url: "https://www.pexels.com/video/2499612/", video_files: [{ ...body.videos[0].video_files[0], id: 3, link: "https://videos.pexels.com/video-2.mp4" }] });
  let downloads = 0; let stores = 0;
  const fetchImpl = async (_url, _options) => downloads++ === 0 ? response(200, "application/json", JSON.stringify(body)) : response(200, "video/mp4", Buffer.from(`video-${downloads}`));
  const storage = { async store() { stores += 1; if (stores === 1) throw Object.assign(new Error("private decode"), { code: "PROVIDER_INVALID_VIDEO" }); return { format: "mp4", mimeType: "video/mp4", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: 30000, hasAudio: false, contentHash: "b".repeat(64), mediaReference: `media:sha256_${"b".repeat(64)}` }; } };
  const output = await new PexelsVideoAdapter(config(), { fetchImpl, storage }).provide(input());
  assert.equal(output.source.externalAssetId, "2499612"); assert.equal(stores, 2);
});

test("configuração recusa endpoint antigo e mantém chave fora da configuração pública", () => {
  const env = { PEXELS_API_KEY: "secret", PEXELS_VIDEO_STORAGE_ROOT: "data/media", FFMPEG_PATH: "ffmpeg", FFPROBE_PATH: "ffprobe" };
  assert.equal(loadPexelsVideoConfig(env).endpoint, PEXELS_VIDEO_ENDPOINT);
  assert.throws(() => loadPexelsVideoConfig({ ...env, PEXELS_VIDEO_ENDPOINT: "https://api.pexels.com/videos/search" }), (error) => error.code === "PEXELS_VIDEO_CONFIGURATION_INVALID");
});

function input(overrides = {}) { return { logicalCallId: "media_acquisition_001", assetType: "VIDEO", excludedExternalAssetIds: [], visualDirection: { position: 1, blockPosition: 1, description: "pessoa usando tecnologia" }, projectContext: { projectId: "project_e06", projectVersion: 2, language: "pt-BR", audienceProfile: "Público geral", niche: "tecnologia", contentFormat: "short_video", aspectRatio: "9:16", visualStyle: "dynamic", productionProfile: "MIXED_MEDIA_V2", minDurationSeconds: 25, maxDurationSeconds: 45 }, ...overrides }; }
function config() { return { apiKey: "pexels-secret", endpoint: PEXELS_VIDEO_ENDPOINT, storageRoot: "data/media", ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", timeoutMs: 1000, maxResponseBytes: 100000, maxVideoBytes: 100000, perPage: 15, minimumWidthPixels: 720, minimumHeightPixels: 1280, rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }, licenseName: "Pexels License", licenseUrl: "https://www.pexels.com/license/" }; }
function searchBody() { return { videos: [{ id: 2499611, duration: 30, url: "https://www.pexels.com/video/2499611/", user: { name: "Joey Farina", url: "https://www.pexels.com/@joey" }, video_files: [{ id: 2, file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.pexels.com/video.mp4" }] }] }; }
function response(status, contentType, value) { return { ok: status >= 200 && status < 300, status, headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null }, body: Readable.from([value]) }; }
