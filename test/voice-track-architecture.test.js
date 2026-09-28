import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../src/domain/voice-track-contracts.js",
  "../src/voice-track-service.js",
  "../src/voice-track-repository.js",
];

test("domínio e aplicação de voz não dependem de SDK ou provider específico", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:openai|elevenlabs|google|azure|aws)[^"']*["']/i);
  }
});

test("serviço exige identidades explícitas e não oferece consulta latest", async () => {
  const { VoiceTrackService } = await import("../src/voice-track-service.js");
  const calls = [];
  const service = new VoiceTrackService({
    registerVoiceTrack: (value) => (calls.push(["register", value]), value),
    getVoiceTrack: (id) => (calls.push(["get", id]), null),
    listVoiceTracksByPipelineRun: (id) => (calls.push(["run", id]), []),
    listVoiceTracksByScript: (id) => (calls.push(["script", id]), []),
  });
  service.get("voice_track_001");
  service.listByPipelineRun("run_e05_001");
  service.listByScript("script_001");
  assert.deepEqual(calls, [["get", "voice_track_001"], ["run", "run_e05_001"], ["script", "script_001"]]);
  assert.equal("latest" in service, false);
});
