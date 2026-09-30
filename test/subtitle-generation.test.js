import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SUBTITLE_STYLE_POLICY,
  SubtitleGenerationError,
  generateSubtitleCues,
  normalizeSubtitleNarration,
  serializeSubtitleAss,
  serializeSubtitleSrt,
  subtitleCueContentHash,
} from "../src/domain/subtitle-generation.js";
import { SUBTITLE_STYLE_POLICY_VERSION, SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { SubtitleGenerationService } from "../src/subtitle-generation-service.js";

const REQUESTED_AT = "2026-09-29T20:00:00.000Z";

test("política fechada normaliza Unicode e segmenta sem perda, duplicação ou invenção", () => {
  assert.deepEqual(SUBTITLE_STYLE_POLICY, {
    version: SUBTITLE_STYLE_POLICY_VERSION, maximumWordsPerCue: 12,
    maximumLinesPerCue: 2, maximumCharactersPerLine: 34,
    minimumCueDurationMilliseconds: 600, gapMilliseconds: 80, tailMilliseconds: 120,
  });
  assert.ok(Object.isFrozen(SUBTITLE_STYLE_POLICY));
  const narration = "  Cafe\u0301,   ação e 🚀.\n\nSegundo trecho; com Unicode.  ";
  const normalized = normalizeSubtitleNarration(narration);
  const cues = generateSubtitleCues(narration, 5000);
  assert.equal(normalized, "Café, ação e 🚀. Segundo trecho; com Unicode.");
  assert.equal(cues.map(({ text }) => text).join(" "), normalized);
  assert.deepEqual(cues, generateSubtitleCues(narration, 5000));
});

test("segmentação respeita limites e rejeita texto vazio, controles, token e quantidade excessivos", () => {
  const cues = generateSubtitleCues(Array.from({ length: 30 }, (_, index) => `palavra${index}`).join(" "), 10000);
  assert.ok(cues.every(({ text }) => text.split(" ").length <= 12));
  assert.throws(() => generateSubtitleCues(" \n ", 1000), generationError("EMPTY_SUBTITLE_TEXT", "fullNarration"));
  assert.throws(() => generateSubtitleCues("texto\u0000privado", 1000), generationError("INVALID_SUBTITLE_TEXT", "fullNarration"));
  assert.throws(() => generateSubtitleCues("x".repeat(1001), 2000), generationError("SUBTITLE_TOKEN_TOO_LONG", "fullNarration"));
  const many = Array.from({ length: 1001 }, (_, index) => `p${index} ${"x".repeat(80)}`).join(" ");
  assert.throws(() => generateSubtitleCues(many, 1_000_000), generationError("TOO_MANY_SUBTITLE_CUES", "fullNarration"));
});

test("timings são proporcionais, ordenados, positivos e preservam gaps e tail", () => {
  const cues = generateSubtitleCues("Curto. Este é um segundo trecho consideravelmente mais longo para leitura clara por qualquer pessoa interessada.", 5000);
  assert.equal(cues[0].startMilliseconds, 0);
  assert.equal(cues[1].startMilliseconds - cues[0].endMilliseconds, 80);
  assert.equal(5000 - cues.at(-1).endMilliseconds, 120);
  assert.ok(cues[1].endMilliseconds - cues[1].startMilliseconds > cues[0].endMilliseconds);
  assert.ok(cues.every((cue, index) => cue.endMilliseconds > cue.startMilliseconds
    && (index === 0 || cue.startMilliseconds >= cues[index - 1].endMilliseconds)));
});

test("duração insuficiente usa código público estável antes de escrever", () => {
  assert.throws(
    () => generateSubtitleCues("Primeiro trecho. Segundo trecho longo que deve formar outro cue com palavras suficientes para ultrapassar o limite definido.", 1279),
    generationError("SUBTITLE_DURATION_INSUFFICIENT", "durationMilliseconds"),
  );
  const repository = fakeRepository({ durationMilliseconds: 1279 });
  assert.throws(() => new SubtitleGenerationService(repository).generate(request()), generationError("SUBTITLE_DURATION_INSUFFICIENT", "durationMilliseconds"));
  assert.equal(repository.writes.length, 0);
});

test("SRT e ASS são determinísticos, escapados e não alteram a timeline canônica", () => {
  const track = subtitleTrack([
    { position: 1, text: "Use <tag> & {bloco} \\ seguro.", startMilliseconds: 0, endMilliseconds: 1234 },
  ], 2000);
  const original = structuredClone(track.cues);
  const srt = serializeSubtitleSrt(track);
  const ass = serializeSubtitleAss(track);
  assert.match(srt, /00:00:00,000 --> 00:00:01,234/);
  assert.match(srt, /&lt;tag&gt; &amp; \{bloco\}/);
  assert.match(ass, /^\[Script Info\]/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.24,Default,,0,0,0,,/);
  assert.match(ass, /\\\{bloco\\\} \\\\ seguro/);
  assert.deepEqual(track.cues, original);
  assert.equal(serializeSubtitleSrt(track), srt);
  assert.equal(serializeSubtitleAss(track), ass);
});

test("serviço exige cadeia explícita, gera hashes derivados e persiste pelo repository existente", () => {
  const repository = fakeRepository();
  const result = new SubtitleGenerationService(repository).generate(request());
  assert.equal(repository.writes.length, 1);
  assert.equal(result.subtitleTrack.createdAt, REQUESTED_AT);
  assert.equal(result.subtitleTrack.stylePolicyVersion, SUBTITLE_STYLE_POLICY_VERSION);
  assert.equal(result.subtitleTrack.cues.map(({ text }) => text).join(" "), normalizeSubtitleNarration(repository.script.fullNarration));
  assert.equal(result.cueContentHash, subtitleCueContentHash(result.subtitleTrack.cues));
  assert.equal(result.srtContentHash, sha256(result.srt));
  assert.equal(result.assContentHash, sha256(result.ass));
  assert.match(result.subtitleTrack.subtitleTrackId, /^subtitle_track:[a-f0-9]{64}$/);
});

test("retry retorna identidade persistida sem duplicar e ignora novo relógio", () => {
  const repository = fakeRepository();
  const service = new SubtitleGenerationService(repository);
  const first = service.generate(request());
  const second = service.generate(request({ requestedAt: "2026-09-29T21:00:00.000Z" }));
  assert.deepEqual(second, first);
  assert.equal(repository.writes.length, 1);
});

test("hash, escopo e idioma divergentes falham sem estado parcial", () => {
  const cases = [
    [{ scriptContentHash: "f".repeat(64) }, "SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash"],
    [{ voiceTrackContentHash: "e".repeat(64) }, "VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash"],
    [{ projectVersion: 2 }, "SUBTITLE_GENERATION_SCOPE_MISMATCH", "projectVersion"],
  ];
  for (const [change, code, field] of cases) {
    const repository = fakeRepository();
    assert.throws(() => new SubtitleGenerationService(repository).generate(request(change)), generationError(code, field));
    assert.equal(repository.writes.length, 0);
  }
  const repository = fakeRepository();
  repository.voice = { ...repository.voice, language: "en-US" };
  assert.throws(() => new SubtitleGenerationService(repository).generate(request()), generationError("SUBTITLE_GENERATION_LANGUAGE_MISMATCH", "language"));
  assert.equal(repository.writes.length, 0);
});

test("solicitação fechada rejeita política, campos e timestamp não autorizados", () => {
  const repository = fakeRepository();
  const service = new SubtitleGenerationService(repository);
  assert.throws(() => service.generate(request({ stylePolicyVersion: "subtitle-style-policy/2.0.0" })), generationError("UNSUPPORTED_STYLE_POLICY", "stylePolicyVersion"));
  assert.throws(() => service.generate(request({ requestedAt: "agora" })), generationError("INVALID_TIMESTAMP", "requestedAt"));
  assert.throws(() => service.generate({ ...request(), style: "custom" }), generationError("UNKNOWN_FIELD", "request.style"));
  assert.equal(repository.writes.length, 0);
});

function request(overrides = {}) { return {
  pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia", projectVersion: 1,
  scriptId: "script_001", scriptContentHash: "a".repeat(64),
  voiceTrackId: "voice_track_001", voiceTrackContentHash: "b".repeat(64),
  stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, requestedAt: REQUESTED_AT, ...overrides,
}; }

function fakeRepository(overrides = {}) {
  const repository = {
    writes: [], stored: null,
    run: { pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia", projectVersion: 1,
      projectSnapshot: { project: { id: "project_curiosidades_ia", version: 1, audience: { language: "pt-BR" } } } },
    script: { scriptId: "script_001", pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia",
      projectVersion: 1, contentHash: "a".repeat(64), language: "pt-BR",
      fullNarration: "Primeiro trecho. Segundo trecho longo que deve formar outro cue com palavras suficientes para ultrapassar o limite definido." },
    voice: { voiceTrackId: "voice_track_001", pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia",
      projectVersion: 1, scriptId: "script_001", scriptContentHash: "a".repeat(64),
      contentHash: "b".repeat(64), language: "pt-BR", durationMilliseconds: overrides.durationMilliseconds ?? 5000 },
    getRun(id) { return id === this.run.pipelineRunId ? this.run : null; },
    getScript(id) { return id === this.script.scriptId ? this.script : null; },
    getVoiceTrack(id) { return id === this.voice.voiceTrackId ? this.voice : null; },
    getSubtitleTrack(id) { return this.stored?.subtitleTrackId === id ? this.stored : null; },
    registerSubtitleTrack(value) { this.writes.push(value); this.stored = value; return value; },
  };
  return repository;
}

function subtitleTrack(cues, durationMilliseconds) {
  const value = { schemaVersion: SUBTITLE_TRACK_CONTRACT_VERSION, subtitleTrackId: "subtitle_track:test",
    pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    scriptId: "script_001", scriptContentHash: "a".repeat(64), voiceTrackId: "voice_track_001",
    voiceTrackContentHash: "b".repeat(64), language: "pt-BR", timeUnit: "MILLISECONDS",
    durationMilliseconds, stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, cues,
    createdAt: REQUESTED_AT, revision: 1, supersedesSubtitleTrackId: null, contentHash: "0".repeat(64) };
  value.contentHash = subtitleTrackContentHash(value);
  return value;
}

function generationError(code, field) { return (caught) => caught instanceof SubtitleGenerationError && caught.code === code && caught.field === field; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
