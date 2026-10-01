import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIImageAdapter, OpenAIImageAdapterError } from "../src/adapters/openai-image.js";
import { LocalMediaStorage } from "../src/adapters/local-media-storage.js";
import { inspectMvpPng } from "../src/adapters/png-image.js";
import {
  loadOpenAIImageConfig, OPENAI_IMAGE_HEIGHT, OPENAI_IMAGE_MODEL,
  OPENAI_IMAGE_POLICY_VERSION, OPENAI_IMAGE_WIDTH,
} from "../src/openai-image-config.js";
import { MediaProvider } from "../src/media-provider.js";
import { validateMediaProviderOutput } from "../src/domain/media-acquisition-contracts.js";

test("configura snapshot, 9:16 exato, direitos automáticos e pricing versionados", () => {
  const root = join(tmpdir(), "image-config-test");
  const config = loadOpenAIImageConfig(env(root), { now: () => Date.parse("2026-09-30T23:59:59.000Z") });
  assert.equal(config.model, OPENAI_IMAGE_MODEL);
  assert.equal(config.widthPixels, 1152);
  assert.equal(config.heightPixels, 2048);
  assert.equal(OPENAI_IMAGE_WIDTH * 16, OPENAI_IMAGE_HEIGHT * 9);
  assert.equal(config.policyVersion, OPENAI_IMAGE_POLICY_VERSION);
  assert.equal(config.pricing.version, "openai-image-pricing/1.0.0");
  assert.deepEqual(config.rights, { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true });
  assert.equal(config.termsVersion, "2026-09-30");
  assert.equal(JSON.stringify(config.publicConfiguration).includes("sk-test"), false);
  assert.equal(JSON.stringify(config.publicConfiguration).includes(root), false);
  assert.doesNotThrow(() => loadOpenAIImageConfig(env(root, { OPENAI_IMAGE_COMMERCIAL_USE_ALLOWED: undefined, OPENAI_IMAGE_TERMS_VERSION: undefined })));
  assert.throws(() => loadOpenAIImageConfig(env(root, { OPENAI_IMAGE_MODEL: "gpt-image-other" })), adapterError("OPENAI_IMAGE_CONFIGURATION_INVALID", "OPENAI_IMAGE_MODEL"));
});

test("gera PNG físico, mede dimensões, calcula hash e persiste referência opaca", async () => {
  await withRoot(async (root) => {
    const bytes = png();
    let captured;
    const adapter = new OpenAIImageAdapter(loadOpenAIImageConfig(env(root)), {
      now: clock(),
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return jsonResponse(providerResponse(bytes, { input_tokens: 100, output_tokens: 2000 }));
      },
    });
    assert.equal(adapter instanceof MediaProvider, true);
    const output = await adapter.provide(input());
    assert.deepEqual(validateMediaProviderOutput(output), output);
    const body = JSON.parse(captured.options.body);
    assert.equal(captured.url, "https://api.openai.com/v1/images/generations");
    assert.equal(captured.options.redirect, "error");
    assert.deepEqual({ model: body.model, size: body.size, quality: body.quality, output_format: body.output_format, background: body.background, n: body.n }, {
      model: OPENAI_IMAGE_MODEL, size: "1152x2048", quality: "medium", output_format: "png", background: "opaque", n: 1,
    });
    assert.doesNotMatch(body.prompt, /https?:|www\.|@[a-z0-9_]/i);
    assert.equal(output.technicalProperties.widthPixels, 1152);
    assert.equal(output.technicalProperties.heightPixels, 2048);
    assert.equal(output.technicalProperties.durationMilliseconds, null);
    assert.equal(output.contentHash, sha256(bytes));
    assert.equal(output.mediaReference, `media:sha256_${sha256(bytes)}`);
    assert.equal(output.origin, "PROVIDER_GENERATED");
    assert.equal(output.provider, "openai");
    assert.equal(output.telemetry.costAmount, "0.0605");
    assert.equal(output.telemetry.costOrigin, "calculated_openai_image_pricing_2026_09_29");
    assert.deepEqual(readFileSync(join(root, "sha256", output.contentHash.slice(0, 2), `${output.contentHash}.png`)), bytes);
    assert.equal(JSON.stringify(output).includes(root), false);
  });
});

test("não cria custo sem usage completo e rejeita usage inválido", async () => {
  await withRoot(async (root) => {
    const config = loadOpenAIImageConfig(env(root));
    const incomplete = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(png(), { input_tokens: 10 })) });
    const output = await incomplete.provide(input());
    assert.equal(output.telemetry.inputTokens, 10);
    assert.equal(output.telemetry.outputTokens, null);
    assert.equal(output.telemetry.costAmount, null);
    const invalid = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(png(), { input_tokens: -1, output_tokens: 2 })) });
    await assert.rejects(invalid.provide(input()), adapterError("PROVIDER_INVALID_RESPONSE", "usage.input_tokens"));
  });
});

test("recusa vídeo, campos inesperados e referência estratégica antes da rede", async () => {
  await withRoot(async (root) => {
    let calls = 0;
    const adapter = new OpenAIImageAdapter(loadOpenAIImageConfig(env(root)), { fetchImpl: async () => { calls += 1; throw new Error("não chamar"); } });
    for (const [change, code, field] of [
      [{ assetType: "VIDEO" }, "PROVIDER_UNSUPPORTED_ASSET_TYPE", "assetType"],
      [{ referenceUrl: "https://social.test/x" }, "PROVIDER_INVALID_INPUT", "input.referenceUrl"],
      [{ visualDirection: { ...input().visualDirection, description: "Copie https://social.test/x" } }, "PROVIDER_FORBIDDEN_REFERENCE", "visualDirection.description"],
      [{ visualDirection: { ...input().visualDirection, description: "Copie exemplo.com/imagem" } }, "PROVIDER_FORBIDDEN_REFERENCE", "visualDirection.description"],
      [{ projectContext: { ...input().projectContext, audienceProfile: "Público @perfil" } }, "PROVIDER_FORBIDDEN_REFERENCE", "projectContext.audienceProfile"],
    ]) await assert.rejects(adapter.provide(input(change)), adapterError(code, field));
    assert.equal(calls, 0);
  });
});

test("valida PNG somente por bytes, estrutura, CRC, dimensões e conteúdo completo", async () => {
  await withRoot(async (root) => {
    const config = loadOpenAIImageConfig(env(root));
    const valid = png();
    const cases = [
      [Buffer.from("not png"), "PROVIDER_INVALID_IMAGE"],
      [valid.subarray(0, valid.length - 4), "PROVIDER_INVALID_IMAGE"],
      [mutate(valid, 20), "PROVIDER_INVALID_IMAGE"],
      [png({ width: 1024, height: 1024 }), "PROVIDER_IMAGE_DIMENSION_MISMATCH"],
    ];
    for (const [bytes, code] of cases) {
      const adapter = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(bytes)) });
      await assert.rejects(adapter.provide(input()), adapterError(code, "image"));
    }
    const wrongDeclaration = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse({ ...providerResponse(valid), output_format: "jpeg" }) });
    await assert.rejects(wrongDeclaration.provide(input()), adapterError("PROVIDER_IMAGE_FORMAT_MISMATCH", "response.output_format"));
    const wrongMime = new OpenAIImageAdapter(config, { fetchImpl: async () => new Response(JSON.stringify(providerResponse(valid)), { status: 200, headers: { "content-type": "image/png" } }) });
    await assert.rejects(wrongMime.provide(input()), adapterError("PROVIDER_INVALID_RESPONSE", "response.contentType"));
  });
});

test("aceita Base64 grande sem RangeError e preserva a validação física do PNG", async () => {
  await withRoot(async (root) => {
    const config = loadOpenAIImageConfig(env(root));
    const valid = png({ noisy: true });
    assert.ok(valid.length > 3_700_000);
    const adapter = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(valid)) });
    let output;
    await assert.doesNotReject(async () => { output = await adapter.provide(input()); });
    assert.equal(output.contentHash, sha256(valid));

    const invalid = Buffer.alloc(3_700_001, 0xa5);
    const invalidAdapter = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(invalid)) });
    await assert.rejects(invalidAdapter.provide(input()), adapterError("PROVIDER_INVALID_IMAGE", "image"));
  });
});

test("valida alfabetos e padding Base64 sem aceitar padding intermediário", async () => {
  await withRoot(async (root) => {
    const config = loadOpenAIImageConfig(env(root));
    for (const suffix of ["", "=", "=="]) {
      const bytes = pngWithBase64Suffix(suffix);
      const encoded = bytes.toString("base64");
      assert.equal(encoded.match(/=*$/)[0], suffix);
      const adapter = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponse(bytes)) });
      await assert.doesNotReject(adapter.provide(input()));
    }

    const valid = png().toString("base64");
    for (const encoded of [
      "", `${valid.slice(0, 4)}=${valid.slice(5)}`, `${valid.slice(0, -1)}!`,
      `${valid}=`, valid.slice(0, -1), `${valid}\n`,
    ]) {
      const adapter = new OpenAIImageAdapter(config, { fetchImpl: async () => jsonResponse(providerResponseBase64(encoded)) });
      await assert.rejects(adapter.provide(input()), adapterError("PROVIDER_INVALID_IMAGE", "image"));
    }
  });
});

test("limita resposta e imagem sem deixar temporários", async () => {
  await withRoot(async (root) => {
    const responseLimited = loadOpenAIImageConfig(env(root, { OPENAI_IMAGE_MAX_RESPONSE_BYTES: "1024" }));
    await assert.rejects(new OpenAIImageAdapter(responseLimited, { fetchImpl: async () => jsonResponse(providerResponse(png())) }).provide(input()), adapterError("PROVIDER_RESPONSE_TOO_LARGE", "response"));
    const imageLimited = loadOpenAIImageConfig(env(root, { OPENAI_IMAGE_MAX_IMAGE_BYTES: "1024" }));
    await assert.rejects(new OpenAIImageAdapter(imageLimited, { fetchImpl: async () => jsonResponse(providerResponse(png())) }).provide(input()), adapterError("PROVIDER_IMAGE_TOO_LARGE", "image"));
    assert.deepEqual(listFiles(root), []);
  });
});

test("storage content-addressed reutiliza conteúdo válido e não sobrescreve conflito", async () => {
  await withRoot(async (root) => {
    const bytes = png();
    const storage = new LocalMediaStorage({ root, maxBytes: 20_000_000 });
    const first = await storage.store(bytes, { inspect: inspectMvpPng });
    const second = await storage.store(bytes, { inspect: inspectMvpPng });
    assert.equal(second.reused, true);
    writeFileSync(first.physicalPath, Buffer.from("corrupted"));
    await assert.rejects(storage.store(bytes, { inspect: inspectMvpPng }), adapterError("PROVIDER_STORAGE_HASH_CONFLICT", "storage"));
    assert.deepEqual(readFileSync(first.physicalPath), Buffer.from("corrupted"));
  });
});

test("timeout, cancelamento, redirect e erros externos são sanitizados", async () => {
  await withRoot(async (root) => {
    const config = loadOpenAIImageConfig(env(root, { OPENAI_IMAGE_TIMEOUT_MS: "5" }));
    const timeout = new OpenAIImageAdapter(config, { fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(abortError("private")), { once: true })) });
    await assert.rejects(timeout.provide(input()), adapterError("PROVIDER_TIMEOUT", "timeoutMs"));
    const controller = new AbortController(); controller.abort("private reason");
    await assert.rejects(timeout.provide(input(), { signal: controller.signal }), adapterError("PROVIDER_CANCELLED", "signal"));
    const refused = new OpenAIImageAdapter(config, { fetchImpl: async () => new Response('{"error":"sk-private"}', { status: 403 }) });
    let caught; try { await refused.provide(input()); } catch (error) { caught = error; }
    assert.equal(caught?.code, "PROVIDER_PERMISSION_DENIED");
    assert.equal(caught?.message.includes("private"), false);
    assert.deepEqual(listFiles(root), []);
  });
});

function env(root, overrides = {}) {
  return {
    OPENAI_API_KEY: "sk-test-only", OPENAI_IMAGE_MODEL: OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_STORAGE_ROOT: root, OPENAI_IMAGE_TIMEOUT_MS: "1000",
    OPENAI_IMAGE_MAX_RESPONSE_BYTES: "30000000", OPENAI_IMAGE_MAX_IMAGE_BYTES: "20000000",
    ...overrides,
  };
}
function input(overrides = {}) {
  return {
    logicalCallId: "media_acquisition_001", assetType: "IMAGE",
    visualDirection: { position: 1, blockPosition: 1, description: "Lista simples aparecendo em tela." },
    projectContext: { projectId: "project_e06", projectVersion: 1, language: "pt-BR", audienceProfile: "Pessoas interessadas em tecnologia", niche: "tecnologia", contentFormat: "short_video", aspectRatio: "9:16", visualStyle: "dynamic" },
    ...overrides,
  };
}
function providerResponse(bytes, usage) { return providerResponseBase64(bytes.toString("base64"), usage); }
function providerResponseBase64(encoded, usage) { return { created: 1, output_format: "png", quality: "medium", size: "1152x2048", data: [{ b64_json: encoded, generation_id: "generation_test" }], ...(usage ? { usage } : {}) }; }
function jsonResponse(value) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }); }
function png({ width = 1152, height = 2048, noisy = false, ancillaryBytes = null } = {}) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  if (noisy) {
    let state = 0x12345678;
    for (let offset = 0; offset < raw.length; offset += 1) {
      if (offset % row === 0) continue;
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      raw[offset] = state & 0xff;
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const ancillary = ancillaryBytes === null ? [] : [chunk("tEXt", Buffer.alloc(ancillaryBytes, 65))];
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), ...ancillary, chunk("IEND", Buffer.alloc(0))]);
}
function pngWithBase64Suffix(suffix) { for (let size = 0; size < 3; size += 1) { const bytes = png({ ancillaryBytes: size }); if (bytes.toString("base64").match(/=*$/)[0] === suffix) return bytes; } throw new Error("fixture Base64 indisponível"); }
function chunk(type, data) {
  const name = Buffer.from(type); const value = Buffer.alloc(12 + data.length);
  value.writeUInt32BE(data.length, 0); name.copy(value, 4); data.copy(value, 8);
  value.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return value;
}
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function mutate(bytes, position) { const copy = Buffer.from(bytes); copy[position] ^= 1; return copy; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function clock() { let value = Date.parse("2026-09-29T12:00:00.000Z"); return () => { const current = value; value += 125; return current; }; }
function abortError(message) { const error = new Error(message); error.name = "AbortError"; return error; }
function adapterError(code, field) { return (caught) => caught instanceof OpenAIImageAdapterError && caught.code === code && caught.field === field; }
function listFiles(root) { return existsSync(root) ? readdirSync(root, { recursive: true }).filter((name) => statSync(join(root, name)).isFile()) : []; }
async function withRoot(run) { const root = mkdtempSync(join(tmpdir(), "mktauto-image-")); try { await run(root); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
