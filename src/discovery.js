import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { identifyCandidates } from "./adapters/openai.js";
import { fetchPopularYouTubeSignals } from "./adapters/youtube.js";
import { validateCandidates } from "./domain/contracts.js";
import { rankCandidates } from "./domain/ranking.js";

const fixtureUrl = new URL("../fixtures/round1.json", import.meta.url);

export async function runFixture({ config, store }) {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const candidates = withIds(validateCandidates(
    { candidates: fixture.candidates },
    fixture.evidence.map((item) => item.id),
  ));
  return persistRun({
    mode: "fixture",
    evidence: fixture.evidence,
    candidates,
    config,
    store,
  });
}

export async function runLive({ config, store, env = process.env, fetchImpl = fetch }) {
  const signals = await fetchPopularYouTubeSignals({
    apiKey: env.YOUTUBE_API_KEY,
    regionCode: config.regionCode,
    maxResults: config.maxSignals,
    fetchImpl,
  });
  const candidates = withIds(await identifyCandidates({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || "gpt-6-astra",
    signals,
    fetchImpl,
  }));
  return persistRun({
    mode: "live",
    evidence: signals,
    candidates,
    config,
    store,
  });
}

function persistRun({ mode, evidence, candidates, config, store }) {
  const ranking = rankCandidates(candidates, config);
  return store.save({
    id: randomUUID(),
    mode,
    createdAt: new Date().toISOString(),
    evidence,
    ...ranking,
  });
}

function withIds(candidates) {
  return candidates.map((candidate) => ({
    ...candidate,
    reviewDecision: "pending",
    id: createHash("sha256")
      .update(`${candidate.macroNiche}:${candidate.name}`)
      .digest("hex")
      .slice(0, 12),
  }));
}
