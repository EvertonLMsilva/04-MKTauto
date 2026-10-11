import test from "node:test";
import { materializeAffiliateBriefing } from '../src/domain/affiliate-contracts.js';
import { product as affiliateProduct, campaign as affiliateCampaign } from './affiliate-fixtures.js';

test('P1 adapter inclui briefing/evidências e regras comerciais com fetch fake', async () => {
  const briefing = materializeAffiliateBriefing('brief_001', affiliateCampaign(), affiliateProduct());
  let sent;
  const adapter = new OpenAIAdapter(config(), { fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body); return response(200, providerResponse(validOutput()));
  } });
  await adapter.generate({ ...input(), affiliateBriefing: briefing });
  assert.deepEqual(JSON.parse(sent.input[1].content[0].text).affiliateBriefing, briefing);
  assert.match(sent.input[0].content[0].text, /não invente/i);
  assert.match(sent.input[0].content[0].text, /disclosure/);
  await assert.rejects(adapter.generate({ ...input(), affiliateBriefing: { ...briefing, cta: 'adulterado' } }));
});
import assert from "node:assert/strict";
import { OpenAIAdapter, OpenAIAdapterError } from "../src/adapters/openai.js";
import { loadOpenAIConfig } from "../src/openai-config.js";
import { SCRIPT_PROMPT_POLICY_VERSION } from "../src/script-generation-policy.js";

test("configuração vem do ambiente, expõe somente valores públicos e hash estável", () => {
  const config = loadOpenAIConfig({
    OPENAI_API_KEY: "sk-test-only",
    OPENAI_MODEL: "model-test",
    OPENAI_TIMEOUT_MS: "1500",
    OPENAI_MAX_OUTPUT_TOKENS: "1200",
  });
  assert.equal(config.apiKey, "sk-test-only");
  assert.deepEqual(config.publicConfiguration, {
    outputLimit: 1200,
    responseFormat: "json_schema",
    store: false,
    timeoutMs: 1500,
  });
  assert.equal(config.configurationHash.length, 64);
  assert.equal(JSON.stringify(config.publicConfiguration).includes("sk-test"), false);
  assert.throws(() => loadOpenAIConfig({ OPENAI_MODEL: "model-test" }), adapterError("OPENAI_CONFIGURATION_MISSING", "OPENAI_API_KEY"));
  assert.throws(() => loadOpenAIConfig({ OPENAI_API_KEY: "secret" }), adapterError("OPENAI_CONFIGURATION_MISSING", "OPENAI_MODEL"));
});

test("adapter usa Responses com schema estrito e não devolve payload bruto", async () => {
  let captured;
  const times = [Date.parse("2026-09-28T18:00:00.000Z"), Date.parse("2026-09-28T18:00:00.125Z")];
  const adapter = new OpenAIAdapter(config(), { now: () => times.shift(), fetchImpl: async (url, options) => {
    captured = { url, options };
    return response(200, providerResponse(validOutput(), { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 40 } }));
  } });
  const result = await adapter.generate(input());
  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(JSON.stringify(body).includes("sk-test-only"), false);
  assert.deepEqual(result.output, validOutput());
  assert.deepEqual(result.generationMetadata, {
    provider: "openai",
    model: "model-test",
    taskType: "script_generation",
    promptVersion: SCRIPT_PROMPT_POLICY_VERSION,
    configurationHash: config().configurationHash,
    publicConfiguration: config().publicConfiguration,
  });
  assert.equal(result.telemetry.inputTokens, 120);
  assert.equal(result.telemetry.outputTokens, 30);
  assert.equal(result.telemetry.cachedInputTokens, 40);
  assert.equal(result.telemetry.usageOrigin, "provider_response");
  assert.equal(result.telemetry.costAmount, null);
  assert.equal(result.telemetry.currency, null);
  assert.equal(result.telemetry.latencyMs, 125);
  assert.equal(result.telemetry.occurredAt, "2026-09-28T18:00:00.000Z");
  assert.equal(result.telemetry.inputHash.length, 64);
  assert.equal(result.telemetry.outputHash.length, 64);
  assert.deepEqual(Object.keys(result).sort(), ["generationMetadata", "output", "telemetry"]);
});

test("adapter envia faixa alvo segura sem mutar os limites físicos", async () => {
  const requests = [];
  const source = input();
  const original = structuredClone(source);
  const adapter = new OpenAIAdapter(config(), { fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(200, providerResponse(validOutput()));
  } });

  await adapter.generate(source);
  await adapter.generate(source);

  const contexts = requests.map((body) => JSON.parse(body.input[1].content[0].text));
  assert.equal(contexts[0].channel.minDurationSeconds, 28);
  assert.equal(contexts[0].channel.maxDurationSeconds, 36);
  assert.deepEqual(contexts[1], contexts[0]);
  assert.deepEqual(source, original);
  assert.equal(source.projectSnapshot.channel.minDurationSeconds, 25);
  assert.equal(source.projectSnapshot.channel.maxDurationSeconds, 45);
});

test("adapter usa fallback físico determinístico quando as margens inverteriam a faixa", async () => {
  const requests = [];
  const source = input();
  source.projectSnapshot.channel.minDurationSeconds = 10;
  source.projectSnapshot.channel.maxDurationSeconds = 11;
  const original = structuredClone(source);
  const adapter = new OpenAIAdapter(config(), { fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(200, providerResponse(validOutput()));
  } });

  await adapter.generate(source);
  await adapter.generate(source);

  const contexts = requests.map((body) => JSON.parse(body.input[1].content[0].text));
  assert.deepEqual(
    [contexts[0].channel.minDurationSeconds, contexts[0].channel.maxDurationSeconds],
    [10, 11],
  );
  assert.deepEqual(contexts[1], contexts[0]);
  assert.deepEqual(source, original);
});

test("adapter classifica resposta inválida, falhas HTTP, timeout e cancelamento sem vazar detalhes", async () => {
  const invalid = new OpenAIAdapter(config(), { fetchImpl: async () => response(200, providerResponse({ secret: "private" })) });
  await assert.rejects(invalid.generate(input()), adapterError("PROVIDER_INVALID_RESPONSE", "response"));

  const unauthorized = new OpenAIAdapter(config(), { fetchImpl: async () => response(401, { error: { message: "sk-private" } }) });
  let caught;
  try { await unauthorized.generate(input()); } catch (error) { caught = error; }
  assert.equal(caught?.code, "PROVIDER_AUTHENTICATION_FAILED");
  assert.equal(caught?.message.includes("sk-private"), false);
  assert.equal(caught?.telemetry.outcome, undefined);
  assert.equal(caught?.telemetry.costAmount, null);
  assert.equal(JSON.stringify(caught?.telemetry).includes("sk-private"), false);

  const timeout = new OpenAIAdapter({ ...config(), timeoutMs: 5, publicConfiguration: { ...config().publicConfiguration, timeoutMs: 5 } }, {
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(abortError()), { once: true })),
  });
  await assert.rejects(timeout.generate(input()), adapterError("PROVIDER_TIMEOUT", "timeoutMs"));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(invalid.generate(input(), { signal: controller.signal }), adapterError("PROVIDER_CANCELLED", "signal"));
});

function config() {
  return loadOpenAIConfig({
    OPENAI_API_KEY: "sk-test-only", OPENAI_MODEL: "model-test",
    OPENAI_TIMEOUT_MS: "1000", OPENAI_MAX_OUTPUT_TOKENS: "1200",
  });
}

function input() {
  return {
    idea: { title: "IA para organizar a rotina", editorialAngle: "Ferramentas práticas para produtividade" },
    projectSnapshot: {
      project: { niche: "tecnologia", subniches: ["produtividade"], audience: { profile: "adultos", language: "pt-BR" } },
      channel: { format: "short_video", aspectRatio: "9:16", minDurationSeconds: 25, maxDurationSeconds: 45, editorialStyle: "informative", visualStyle: "dynamic", voiceStyle: "informative" },
    },
  };
}

function validOutput() {
  return {
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Escolha uma tarefa pequena e defina um resultado claro." }],
    visualDirections: [{ position: 1, blockPosition: 1, description: "Uma lista simples aparece em tela." }],
    cta: "Salve para testar depois.", estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [],
  };
}

function providerResponse(output, usage) {
  return { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }], ...(usage ? { usage } : {}) };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function abortError() { const error = new Error("aborted private reason"); error.name = "AbortError"; return error; }
function adapterError(code, field) { return (caught) => caught instanceof OpenAIAdapterError && caught.code === code && caught.field === field; }
