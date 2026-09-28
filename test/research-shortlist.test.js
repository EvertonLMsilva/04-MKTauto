import test from "node:test";
import assert from "node:assert/strict";
import { RADAR_CONTRACT_VERSION } from "../src/domain/contracts.js";
import { DEFAULT_RESEARCH_SHORTLIST_POLICY } from "../src/domain/research-shortlist-contracts.js";
import { selectResearchShortlistCandidates } from "../src/research-shortlist.js";

test("ordena deterministicamente, aplica diversidade e registra exclusões", () => {
  const catalog = fixtureCatalog(7);
  const result = selectResearchShortlistCandidates(catalog, "COMPLETED", DEFAULT_RESEARCH_SHORTLIST_POLICY);
  assert.deepEqual(result.orderedCandidates.map(({ candidate }) => candidate.id), ["candidate-1", "candidate-2", "candidate-4", "candidate-5", "candidate-7"]);
  assert.deepEqual(result.decisions.find(({ candidateId }) => candidateId === "candidate-3").reasons, ["DIVERSITY_DEFERRED"]);
  assert.deepEqual(result.decisions.find(({ candidateId }) => candidateId === "candidate-6").reasons, ["DIVERSITY_DEFERRED"]);
  assert.equal(result.gaps.length, 0);
});

test("relaxa diversidade em ordem-base e preserva componente indisponível", () => {
  const catalog = fixtureCatalog(4);
  catalog.scores[0].components.velocity = { availability: "UNAVAILABLE", reason: "INSUFFICIENT_HISTORY", evidenceSnapshotIds: ["snapshot-1"] };
  catalog.scores[0].confidence = 0.75;
  const first = selectResearchShortlistCandidates(catalog, "COMPLETED");
  const second = selectResearchShortlistCandidates(structuredClone(catalog), "COMPLETED");
  assert.deepEqual(first, second);
  assert.deepEqual(first.orderedCandidates[0].score.components.velocity, catalog.scores[0].components.velocity);
  assert.ok(first.gaps.includes("DIVERSITY_LIMITS_RELAXED_FOR_AVAILABLE_COVERAGE"));
  assert.ok(first.gaps.includes("INSUFFICIENT_ELIGIBLE_CANDIDATES:4/5"));
});

test("catálogo falho não seleciona e não recebe ReferenceInsight", () => {
  const catalog = fixtureCatalog(2);
  const result = selectResearchShortlistCandidates(catalog, "FAILED");
  assert.deepEqual(result.orderedCandidates, []);
  assert.ok(result.decisions.every(({ reasons }) => reasons[0] === "SOURCE_CATALOG_FAILED"));
  assert.equal(Object.hasOwn(result, "referenceInsight"), false);
});

function fixtureCatalog(count) {
  const candidates = Array.from({ length: count }, (_, index) => candidate(index + 1));
  const snapshots = candidates.map((item, index) => snapshot(item.id, index + 1));
  const clusters = [cluster("cluster-a", candidates.slice(0, 3), snapshots.slice(0, 3)), cluster("cluster-b", candidates.slice(3, 6), snapshots.slice(3, 6)), cluster("cluster-c", candidates.slice(6), snapshots.slice(6))].filter(({ candidateIds }) => candidateIds.length > 0);
  return { candidates, snapshots, topicClusters: clusters, scores: candidates.map((item, index) => score(item.id, snapshots[index].id, 100 - index)) , sourceRuns: [] };
}

function candidate(position) {
  const platform = position >= 7 ? "THREADS" : position >= 4 ? "TIKTOK" : "YOUTUBE";
  const canonicalUrl = platform === "YOUTUBE" ? `https://youtube.com/watch?v=video-${position}`
    : platform === "TIKTOK" ? `https://www.tiktok.com/@public/video/video-${position}`
      : `https://www.threads.net/@public/post/video-${position}`;
  return {
    schemaVersion: RADAR_CONTRACT_VERSION, id: `candidate-${position}`, identityKey: `${platform}:video-${position}`,
    platform, platformVideoId: `video-${position}`, canonicalUrl,
    state: "ACTIVE", firstSeenAt: "2026-09-27T10:00:00.000Z", lastSeenAt: "2026-09-27T10:00:00.000Z",
    reappearanceCount: 1, durationSeconds: 45, publishedAt: "2026-09-27T09:00:00.000Z",
    region: position >= 7 ? "MX" : position >= 4 ? "US" : "BR",
    language: "pt-BR", usageCondition: "REFERENCE_ONLY", snapshotIds: [`snapshot-${position}`], topicClusterIds: [],
  };
}
function snapshot(candidateId, position) { return { schemaVersion: RADAR_CONTRACT_VERSION, id: `snapshot-${position}`, candidateId, capturedAt: "2026-09-27T10:00:00.000Z", metrics: { views: { availability: "AVAILABLE", value: 100 }, likes: { availability: "AVAILABLE", value: 10 }, comments: { availability: "AVAILABLE", value: 1 }, shares: { availability: "UNAVAILABLE", reason: "NOT_EXPOSED" } } }; }
function cluster(id, candidates, snapshots) { return { schemaVersion: RADAR_CONTRACT_VERSION, id, label: id, niche: "educação", subtheme: "ciência", likelyAudience: "adultos", narrativePattern: "explicação", localization: "Brasil", candidateIds: candidates.map(({ id: candidateId }) => candidateId), evidenceSnapshotIds: snapshots.map(({ id: snapshotId }) => snapshotId), createdBy: "OLLAMA", explanation: "evidência persistida" }; }
function score(candidateId, snapshotId, value) { const component = { availability: "AVAILABLE", value: 50, evidenceSnapshotIds: [snapshotId] }; return { schemaVersion: RADAR_CONTRACT_VERSION, id: `score-${candidateId}`, candidateId, formulaVersion: "trend-score/1.0.0", calculatedAt: "2026-09-27T10:00:00.000Z", value, confidence: 1, components: { velocity: component, engagement: component, recency: component, recurrence: component }, explanation: "score persistido" }; }
