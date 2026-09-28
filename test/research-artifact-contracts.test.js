import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_ARTIFACT_CONTRACT_VERSION,
  createResearchArtifact,
} from "../src/domain/research-artifact-contracts.js";

test("valida e congela profundamente o primeiro artefato versionado de Research", () => {
  const artifact = createResearchArtifact(validArtifact());
  assert.equal(artifact.schemaVersion, RESEARCH_ARTIFACT_CONTRACT_VERSION);
  assert.equal(artifact.pipelineRunId, "pipeline_e02_r02_001");
  assert.equal(artifact.sourcePlan[0].role, "TECHNICAL_DEPENDENCY");
  assert.equal(Object.isFrozen(artifact.analysisContext), true);
  assert.equal(Object.isFrozen(artifact.sourcePlan[0]), true);
  assert.equal(artifact.rights.usageCondition, "REFERENCE_ONLY");
});

test("rejeita versão, direitos, fontes duplicadas e campos desconhecidos com códigos estáveis", () => {
  assert.throws(
    () => createResearchArtifact({ ...validArtifact(), schemaVersion: "research-topic-catalog/9.0.0" }),
    (error) => error.code === "UNSUPPORTED_SCHEMA_VERSION" && error.path === "schemaVersion",
  );
  assert.throws(
    () => createResearchArtifact({ ...validArtifact(), rights: { usageCondition: "USAGE_CONFIRMED", mediaDownloaded: false, republicationAllowed: false } }),
    (error) => error.code === "INVALID_RIGHTS" && error.path === "rights",
  );
  const duplicate = validArtifact();
  duplicate.sourcePlan.push({ ...duplicate.sourcePlan[0] });
  assert.throws(
    () => createResearchArtifact(duplicate),
    (error) => error.code === "DUPLICATE_NETWORK" && error.path === "sourcePlan[1].network",
  );
  assert.throws(
    () => createResearchArtifact({ ...validArtifact(), accessToken: "não-vazar" }),
    (error) => error.code === "UNKNOWN_FIELD" && error.path === "artifact.accessToken",
  );
});

function validArtifact() {
  return {
    schemaVersion: RESEARCH_ARTIFACT_CONTRACT_VERSION,
    artifactId: "research:0123456789abcdef01234567",
    artifactType: "topic_discovery",
    revision: 1,
    pipelineRunId: "pipeline_e02_r02_001",
    projectId: "canal_educacao",
    projectVersion: 1,
    logicalDate: "2026-09-27",
    timezone: "America/Sao_Paulo",
    createdAt: "2026-09-27T12:00:00.000Z",
    createdBy: "SYSTEM",
    researchInputHash: "a".repeat(64),
    analysisContext: { niche: "educação", subniches: ["ciência"], audience: "adultos", language: "pt-BR" },
    sourcePlan: [{
      network: "youtube", role: "TECHNICAL_DEPENDENCY", adapter: "YOUTUBE",
      status: "SUCCESS", sourceRunIds: ["youtube-source"], gaps: [],
    }],
    trendRunId: "trend:0123456789abcdef01234567",
    state: "COMPLETED",
    gaps: [],
    contentHash: "b".repeat(64),
    rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
  };
}
