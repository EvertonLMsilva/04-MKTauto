import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../src/domain/subtitle-track-contracts.js",
  "../src/subtitle-track-service.js",
  "../src/subtitle-track-repository.js",
];

test("domínio e persistência de legendas não dependem de filesystem, FFmpeg ou formatos físicos", () => {
  for (const file of FILES) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:(?:fs|path|child_process)|ffmpeg|ffprobe|\b(?:srt|ass)\b/i);
  }
});

test("serviço é fachada mínima com identidades explícitas e sem geração ou latest", async () => {
  const { SubtitleTrackService } = await import("../src/subtitle-track-service.js");
  const calls = [];
  const service = new SubtitleTrackService({
    registerSubtitleTrack: (value) => (calls.push(["register", value]), value),
    getSubtitleTrack: (id) => (calls.push(["get", id]), null),
    listSubtitleTracksByPipelineRun: (id) => (calls.push(["run", id]), []),
    listSubtitleTracksByScript: (id) => (calls.push(["script", id]), []),
    listSubtitleTracksByVoiceTrack: (id) => (calls.push(["voice", id]), []),
  });
  const value = { subtitleTrackId: "subtitle_track_001" };
  service.register(value);
  service.get("subtitle_track_001");
  service.listByPipelineRun("run_e07_001");
  service.listByScript("script_001");
  service.listByVoiceTrack("voice_track_001");
  assert.deepEqual(calls, [["register", value], ["get", "subtitle_track_001"], ["run", "run_e07_001"], ["script", "script_001"], ["voice", "voice_track_001"]]);
  for (const forbidden of ["latest", "generate", "generateCues", "generateTimings", "render"]) assert.equal(forbidden in service, false);
});

test("geração e representações de legenda não dependem de filesystem, FFmpeg ou latest", () => {
  for (const file of ["../src/domain/subtitle-generation.js", "../src/subtitle-generation-service.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:(?:fs|path|child_process)|ffmpeg|ffprobe|\blatest\b/i);
  }
});
