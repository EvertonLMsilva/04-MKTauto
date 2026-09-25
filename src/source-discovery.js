import { randomUUID } from "node:crypto";
import { searchWikimediaVideos } from "./adapters/wikimedia-sources.js";

const SEARCH_TERMS = {
  música: "Brazilian music",
  automóveis: "motorcycle",
  jogos: "Minecraft",
  "ciência e tecnologia": "electronics technology",
};

export async function discoverApprovedSources({ run, store, fetchImpl = fetch }) {
  const selection = run.top?.length ? run.top : (run.provisionalTop ?? []);
  const approved = selection.filter((candidate) => candidate.reviewDecision === "approved");
  const selected = [];
  const macros = new Set();
  for (const candidate of approved) {
    if (macros.has(candidate.macroNiche)) continue;
    selected.push(candidate);
    macros.add(candidate.macroNiche);
    if (selected.length === 3) break;
  }
  if (selected.length < 3) throw new Error("São necessários três candidatos aprovados e diversos");

  const niches = await Promise.all(selected.map(async (candidate) => ({
    candidateId: candidate.id,
    niche: candidate.name,
    macroNiche: candidate.macroNiche,
    sources: await searchWikimediaVideos({
      query: SEARCH_TERMS[candidate.macroNiche] || candidate.name,
      maxResults: 5,
      fetchImpl,
    }),
  })));

  return store.saveSourceDiscovery({
    id: randomUUID(),
    runId: run.id,
    createdAt: new Date().toISOString(),
    niches,
  });
}
