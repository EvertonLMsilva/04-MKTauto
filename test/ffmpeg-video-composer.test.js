import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegVideoComposer } from "../src/adapters/ffmpeg-video-composer.js";
import { runProcess } from "../src/adapters/ffmpeg-video-composer.js";
import { CompositionArtifactCatalog } from "../src/adapters/composition-artifact-catalog.js";
import { LocalCompositionReferenceResolver } from "../src/adapters/local-composition-reference-resolver.js";
import { LocalVideoStorage } from "../src/adapters/local-video-storage.js";
import { compositionPlanContentHash } from "../src/domain/composition-plan-contracts.js";
import { png, sha256, wav } from "../test-support/physical-fixtures.js";
import { DeterministicVideoComposer } from "../test-support/fake-video-composer.js";

test("catálogo dedicado e fake determinístico preservam as portas existentes", async () => {
  const voice = { id: "voice" }; const media = { id: "media" };
  const catalog = new CompositionArtifactCatalog({ voiceRepository: { getVoiceTrack: () => voice }, mediaRepository: { getMediaAsset: () => media } });
  assert.equal(catalog.getVoiceTrack("voice"), voice); assert.equal(catalog.getMediaAsset("media"), media);
  const fake = new DeterministicVideoComposer(); assert.equal((await fake.compose({ plan: "exact" })).contentHash, "f".repeat(64)); assert.equal(fake.calls.length, 1);
});

test("resolver aceita referências exatas e bloqueia desconhecida, traversal, ausência e symlink fora do root", async () => withRoots(async ({ voiceRoot, mediaRoot, outside }) => {
  const voice = wav(); const image = png();
  const voiceHash = store(voiceRoot, voice, "wav"); const imageHash = store(mediaRoot, image, "png");
  const resolver = new LocalCompositionReferenceResolver({ voiceRoot, mediaRoot });
  assert.equal(await resolver.resolveVoice(`object:voice/sha256/${voiceHash}`), join(voiceRoot, "sha256", voiceHash.slice(0, 2), `${voiceHash}.wav`));
  assert.equal(await resolver.resolveMedia(`media:sha256_${imageHash}`), join(mediaRoot, "sha256", imageHash.slice(0, 2), `${imageHash}.png`));
  await assert.rejects(resolver.resolveMedia("media:../../private"), adapterError("COMPOSER_REFERENCE_INVALID"));
  await assert.rejects(resolver.resolveMedia(`media:sha256_${"a".repeat(64)}`), adapterError("COMPOSER_INPUT_NOT_FOUND"));
  const escapedRoot = join(outside, "escaped"); const escapedHash = "e".repeat(64); const escapedPrefix = join(escapedRoot, escapedHash.slice(0, 2)); mkdirSync(escapedPrefix, { recursive: true });
  writeFileSync(join(escapedPrefix, `${escapedHash}.png`), image);
  const linkedMediaRoot = join(outside, "linked-media-root"); mkdirSync(linkedMediaRoot); symlinkSync(escapedRoot, join(linkedMediaRoot, "sha256"), "junction");
  const linkedResolver = new LocalCompositionReferenceResolver({ voiceRoot, mediaRoot: linkedMediaRoot });
  await assert.rejects(linkedResolver.resolveMedia(`media:sha256_${escapedHash}`), adapterError("COMPOSER_REFERENCE_OUTSIDE_ROOT"));
}));

test("storage promove por hard-link, reutiliza conteúdo íntegro e recusa conflito", async () => withRoots(async ({ renderRoot }) => {
  const storage = new LocalVideoStorage({ root: renderRoot, maxBytes: 1024 });
  const staging = await storage.createStaging(); const source = join(staging, "render.mp4");
  const bytes = Buffer.from("real-mp4"); writeFileSync(source, bytes); const hash = sha256(bytes);
  const first = await storage.promote(source, hash); const second = await storage.promote(source, hash);
  assert.equal(first.logicalReference, `render:sha256_${hash}`); assert.equal(second.reused, true);
  writeFileSync(first.physicalPath, Buffer.from("corrupt"));
  await assert.rejects(storage.promote(source, hash), adapterError("COMPOSER_STORAGE_HASH_CONFLICT"));
  await storage.cleanup(staging);
}));

test("adapter valida cadeia, cópias consumidas, timeline e argumentos allowlisted", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots);
  const calls = []; let consumed; let graph;
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "ffmpeg-bin" && args.includes("-filter_complex_script")) {
      const inputs = args.flatMap((value, index) => value === "-i" ? [args[index + 1]] : []);
      consumed = inputs.map((path) => sha256(readFileSync(path)));
      graph = readFileSync(args[args.indexOf("-filter_complex_script") + 1], "utf8");
      writeFileSync(args.at(-1), Buffer.from("physical-mp4"));
    }
    if (command === "ffprobe-bin") return { stdout: probeJson(1000) };
    return { stdout: "", stderr: "" };
  };
  const composer = makeComposer(roots, fixture.catalog, runner);
  const output = await composer.compose(input(fixture));
  assert.deepEqual(consumed, [fixture.imageHash, fixture.image2Hash, fixture.voiceHash]);
  assert.equal(output.contentHash, sha256(Buffer.from("physical-mp4")));
  assert.match(output.logicalReference, /^render:sha256_[a-f0-9]{64}$/);
  const encode = calls.find(({ args }) => args.includes("-filter_complex_script"));
  assert.equal(encode.options.shell, false); assert.equal(encode.options.windowsHide, true);
  for (const value of ["libx264", "high", "4.0", "20", "medium", "yuv420p", "aac", "192k", "48000", "60", "+faststart"]) assert.ok(encode.args.includes(value), value);
  assert.match(graph, /gte\(t\\,0\.517\)/); assert.match(graph, /fps=30/);
  assert.doesNotMatch(encode.args.join(" "), /object:voice|media:sha256|PRIVATE/);
}));

test("falha antes do processo para cadeia divergente, direitos, formato, limites e cancelamento", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots); let calls = 0;
  const runner = async () => { calls += 1; return {}; };
  const cases = [
    { catalog: { ...fixture.catalog, getVoiceTrack: () => ({ ...fixture.voice, contentHash: "a".repeat(64) }) }, code: "COMPOSER_VOICE_HASH_MISMATCH" },
    { catalog: { ...fixture.catalog, getMediaAsset: () => ({ ...fixture.image, rights: { usageBasis: "OWNED", commercialUseAllowed: false } }) }, code: "COMPOSER_INPUT_INVALID" },
    { catalog: { ...fixture.catalog, getMediaAsset: () => ({ ...fixture.image, assetType: "VIDEO", technicalProperties: { ...fixture.image.technicalProperties, format: "mp4", durationMilliseconds: 1000 } }) }, code: "COMPOSER_MEDIA_UNSUPPORTED" },
  ];
  for (const item of cases) await assert.rejects(makeComposer(roots, item.catalog, runner).compose(input(fixture)), adapterError(item.code));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(makeComposer(roots, fixture.catalog, runner).compose(input(fixture), { signal: controller.signal }), adapterError("COMPOSER_CANCELLED"));
  assert.equal(calls, 0);
}));

test("falha sanitizada para saída ausente, probe malformado, timeout e limpa staging", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots);
  await assert.rejects(makeComposer(roots, fixture.catalog, async () => ({ stdout: "" })).compose(input(fixture)), adapterError("COMPOSER_OUTPUT_INVALID"));
  const invalidProbe = async (command, args) => { if (command === "ffmpeg-bin" && args.includes("-filter_complex_script")) writeFileSync(args.at(-1), Buffer.from("mp4")); return { stdout: command === "ffprobe-bin" ? "{" : "" }; };
  await assert.rejects(makeComposer(roots, fixture.catalog, invalidProbe).compose(input(fixture)), adapterError("COMPOSER_PROBE_INVALID"));
  const timeout = Object.assign(new Error("PRIVATE path"), { code: "COMPOSER_TIMEOUT" });
  await assert.rejects(makeComposer(roots, fixture.catalog, async () => { throw timeout; }).compose(input(fixture)), adapterError("COMPOSER_TIMEOUT"));
  assert.deepEqual(readdirSync(join(roots.renderRoot, ".staging")), []);
}));

test("rejeita hash físico divergente da voz copiada antes de executar processo", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots); const path = join(roots.voiceRoot, "sha256", fixture.voiceHash.slice(0, 2), `${fixture.voiceHash}.wav`); writeFileSync(path, wav({ durationMilliseconds: 1100 }));
  let calls = 0; await assert.rejects(makeComposer(roots, fixture.catalog, async () => { calls += 1; }).compose(input(fixture)), adapterError("COMPOSER_PHYSICAL_HASH_MISMATCH"));
  assert.equal(calls, 0);
}));

test("rejeita streams e propriedades medidas divergentes sem promover render", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots);
  for (const mutate of [
    (value) => { value.streams[0].codec_name = "hevc"; },
    (value) => { value.streams[0].width = 720; },
    (value) => { value.streams[0].pix_fmt = "yuv444p"; },
    (value) => { value.streams[0].r_frame_rate = "25/1"; },
    (value) => { value.streams[1].codec_name = "mp3"; },
    (value) => { value.format.duration = "0.900000"; },
    (value) => { value.streams.pop(); },
  ]) {
    const runner = async (command, args) => {
      if (command === "ffmpeg-bin" && args.includes("-filter_complex_script")) writeFileSync(args.at(-1), Buffer.from("mp4"));
      if (command === "ffprobe-bin") { const value = JSON.parse(probeJson(1000)); mutate(value); return { stdout: JSON.stringify(value) }; }
      return { stdout: "" };
    };
    await assert.rejects(makeComposer(roots, fixture.catalog, runner).compose(input(fixture)), adapterError("COMPOSER_OUTPUT_POLICY_MISMATCH"));
  }
}));

test("classifica binário ausente e falha de decode sem expor detalhes", async () => withRoots(async (roots) => {
  const fixture = physicalFixture(roots); const missing = Object.assign(new Error("C:/PRIVATE/ffmpeg"), { code: "ENOENT" });
  await assert.rejects(makeComposer(roots, fixture.catalog, async () => { throw missing; }).compose(input(fixture)), adapterError("COMPOSER_UNAVAILABLE"));
  let call = 0; const decodeFailure = async (_command, args) => { call += 1; if (args.includes("-filter_complex_script")) { writeFileSync(args.at(-1), Buffer.from("truncated")); return { stdout: "" }; } throw new Error("PRIVATE stderr"); };
  await assert.rejects(makeComposer(roots, fixture.catalog, decodeFailure).compose(input(fixture)), adapterError("COMPOSER_PROCESS_FAILED"));
  assert.equal(call, 2);
}));

test("executor limita logs e encerra por timeout ou cancelamento", async () => {
  const logged = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(200))"], { timeoutMs: 1000, maxLogBytes: 32, shell: false, windowsHide: true });
  assert.ok(Buffer.byteLength(logged.stdout) <= 32);
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 10, maxLogBytes: 32, shell: false, windowsHide: true }), adapterError("COMPOSER_TIMEOUT"));
  const controller = new AbortController(); const pending = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 1000, maxLogBytes: 32, shell: false, windowsHide: true, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, adapterError("COMPOSER_CANCELLED"));
});

function makeComposer(roots, catalog, processRunner) {
  return new FfmpegVideoComposer(config(roots), { artifactCatalog: catalog, processRunner });
}
function config({ voiceRoot, mediaRoot, renderRoot }) { return {
  policyVersion: "ffmpeg-video-policy/1.0.0", ffmpegPath: "ffmpeg-bin", ffprobePath: "ffprobe-bin",
  voiceRoot, mediaRoot, renderRoot, stagingRoot: join(renderRoot, ".staging"), widthPixels: 1080, heightPixels: 1920,
  frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium",
  pixelFormat: "yuv420p", audioCodec: "aac", audioProfile: "aac_low", audioBitrate: "192k", audioSampleRate: 48000,
  audioChannels: 1, gopSize: 60, maxSegments: 60, maxDurationMilliseconds: 180000, maxVoiceBytes: 20971520,
  maxImageBytes: 20971520, maxTotalInputBytes: 536870912, maxOutputBytes: 524288000, timeoutMs: 300000, maxLogBytes: 65536,
  publicConfiguration: {},
}; }
function physicalFixture(roots) {
  const voiceBytes = wav({ durationMilliseconds: 1000 }); const imageBytes = png({ color: 32 }); const image2Bytes = png({ color: 96 });
  const voiceHash = store(roots.voiceRoot, voiceBytes, "wav"); const imageHash = store(roots.mediaRoot, imageBytes, "png"); const image2Hash = store(roots.mediaRoot, image2Bytes, "png");
  const voice = { schemaVersion: "voice-track/1.0.0", voiceTrackId: "voice_track_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_001", scriptContentHash: "b".repeat(64), language: "pt-BR", voiceStyle: "informative", durationMilliseconds: 1000, audioFormat: "wav",
    contentHash: voiceHash, storageReference: `object:voice/sha256/${voiceHash}`, origin: "SYNTHETIC_TTS", provider: "openai", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
    createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesVoiceTrackId: null };
  const media = (id, hash, position) => ({ schemaVersion: "media-asset/1.0.0", mediaAssetId: id, pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_001", scriptContentHash: "b".repeat(64), visualDirectionPosition: position, assetType: "IMAGE", technicalProperties: { format: "png", widthPixels: 90, heightPixels: 160, durationMilliseconds: null },
    contentHash: hash, mediaReference: `media:sha256_${hash}`, origin: "PROVIDER_GENERATED", provider: "openai", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
    createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesMediaAssetId: null });
  const image = media("media_asset_001", imageHash, 1); const image2 = media("media_asset_002", image2Hash, 2);
  const catalog = { getVoiceTrack: (id) => id === voice.voiceTrackId ? voice : null, getMediaAsset: (id) => id === image.mediaAssetId ? image : id === image2.mediaAssetId ? image2 : null };
  return { voice, image, image2, voiceHash, imageHash, image2Hash, catalog };
}
function input(fixture) { const plan = {
  schemaVersion: "composition-plan/1.0.0", compositionPlanId: "composition_plan_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
  scriptId: "script_001", scriptContentHash: "b".repeat(64), voiceTrackId: fixture.voice.voiceTrackId, voiceTrackContentHash: fixture.voiceHash,
  outputAspectRatio: "9:16", timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS", durationMilliseconds: 1000,
  segments: [{ position: 1, visualDirectionPosition: 1, mediaAssetId: fixture.image.mediaAssetId, mediaAssetContentHash: fixture.imageHash, startMilliseconds: 0, endMilliseconds: 517 },
    { position: 2, visualDirectionPosition: 2, mediaAssetId: fixture.image2.mediaAssetId, mediaAssetContentHash: fixture.image2Hash, startMilliseconds: 517, endMilliseconds: 1000 }],
  createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesCompositionPlanId: null, contentHash: "0".repeat(64),
}; plan.contentHash = compositionPlanContentHash(plan); return { logicalCallId: "video_composition_001", compositionPlan: plan, output: { containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920 } }; }
function probeJson(duration) { return JSON.stringify({ streams: [
  { index: 0, codec_name: "h264", profile: "High", codec_type: "video", width: 1080, height: 1920, pix_fmt: "yuv420p", level: 40, r_frame_rate: "30/1", avg_frame_rate: "30/1", duration: ((duration - 1) / 1000).toFixed(6) },
  { index: 1, codec_name: "aac", profile: "LC", codec_type: "audio", sample_rate: "48000", channels: 1, duration: (duration / 1000).toFixed(6) },
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: (duration / 1000).toFixed(6), size: "12" } }); }
function store(root, bytes, extension) { const hash = sha256(bytes); const directory = join(root, "sha256", hash.slice(0, 2)); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${hash}.${extension}`), bytes); return hash; }
async function withRoots(run) { const root = mkdtempSync(join(tmpdir(), "mktauto-ffmpeg-test-")); const roots = { voiceRoot: join(root, "voice"), mediaRoot: join(root, "media"), renderRoot: join(root, "render"), outside: join(root, "outside") }; Object.values(roots).forEach((path) => mkdirSync(path, { recursive: true })); try { await run(roots); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
function adapterError(code) { return (caught) => caught?.code === code && !caught.message.includes("PRIVATE"); }
