import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RESEARCH_SHORTLIST_POLICY,
  RESEARCH_SHORTLIST_CONTRACT_VERSION,
  createResearchShortlist,
} from "../src/domain/research-shortlist-contracts.js";

test("contrato de shortlist aceita resultado vazio com lacunas e congela a linhagem", () => {
  const artifact = createResearchShortlist(validShortlist());
  assert.equal(artifact.schemaVersion, RESEARCH_SHORTLIST_CONTRACT_VERSION);
  assert.equal(artifact.policy.shortlistLimit, 5);
  assert.equal(Object.isFrozen(artifact.policy), true);
  assert.equal(Object.isFrozen(artifact.coverage), true);
});

test("preserva ID oficial misto nas decisões da shortlist", () => {
  const value = validShortlist();
  const mixed = "youtube:AbC_123-X";
  value.decisions = [{ candidateId: mixed, decision: "EXCLUDED", position: null, reasons: ["CATALOG_EXCLUSION"] }];
  assert.equal(createResearchShortlist(value).decisions[0].candidateId, mixed);
});

test("contrato rejeita versão, política, direitos e campos desconhecidos", () => {
  assert.throws(() => createResearchShortlist({ ...validShortlist(), schemaVersion: "research-shortlist/9.0.0" }), (error) => error.code === "UNSUPPORTED_SCHEMA_VERSION");
  assert.throws(() => createResearchShortlist({ ...validShortlist(), policy: { ...DEFAULT_RESEARCH_SHORTLIST_POLICY, shortlistLimit: 10 } }), (error) => error.code === "INVALID_POLICY");
  assert.throws(() => createResearchShortlist({ ...validShortlist(), rights: { usageCondition: "USAGE_CONFIRMED", mediaDownloaded: false, republicationAllowed: false } }), (error) => error.code === "INVALID_RIGHTS");
  assert.throws(() => createResearchShortlist({ ...validShortlist(), referenceInsightHash: "a".repeat(64) }), (error) => error.code === "UNKNOWN_FIELD");
});

function validShortlist() {
  return {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION,
    artifactId: "research-shortlist:0123456789abcdef01234567",
    artifactType: "research_shortlist",
    revision: 1,
    pipelineRunId: "pipeline_e02_r04_001",
    projectId: "canal_educacao",
    projectVersion: 1,
    logicalDate: "2026-09-27",
    timezone: "America/Sao_Paulo",
    createdAt: "2026-09-27T12:00:00.000Z",
    createdBy: "SYSTEM",
    researchInputHash: "a".repeat(64),
    researchTopicCatalogArtifactId: "research:0123456789abcdef01234567",
    researchTopicCatalogHash: "b".repeat(64),
    trendRunId: "trend:0123456789abcdef01234567",
    trendCatalogHash: "c".repeat(64),
    policy: structuredClone(DEFAULT_RESEARCH_SHORTLIST_POLICY),
    state: "COMPLETED_WITH_GAPS",
    orderedCandidates: [],
    decisions: [],
    coverage: [],
    gaps: ["INSUFFICIENT_ELIGIBLE_CANDIDATES:0/5"],
    contentHash: "d".repeat(64),
    rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
  };
}
