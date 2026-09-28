import test from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_ANALYSIS_POLICY_VERSION,
  REFERENCE_INSIGHT_CONTRACT_VERSION,
  createReferenceInsight,
} from "../src/domain/reference-insight-contracts.js";

test("valida e congela insight estratégico rastreável sem conceder direitos", () => {
  const insight = createReferenceInsight(validInsight());
  assert.equal(insight.schemaVersion, REFERENCE_INSIGHT_CONTRACT_VERSION);
  assert.equal(insight.references[0].usage, "strategic_reference_only");
  assert.equal(insight.rights.mediaDownloaded, false);
  assert.equal(Object.isFrozen(insight), true);
  assert.equal(Object.isFrozen(insight.references[0].evidence[0]), true);
});

test("rejeita texto-fonte, direitos ampliados e padrões sem três evidências", () => {
  assert.throws(
    () => createReferenceInsight({ ...validInsight(), caption: "copiado" }),
    (error) => error.code === "UNKNOWN_FIELD" && error.path === "artifact.caption",
  );
  assert.throws(
    () => createReferenceInsight({ ...validInsight(), rights: { ...validInsight().rights, mediaDownloaded: true } }),
    (error) => error.code === "INVALID_RIGHTS" && error.path === "rights",
  );
  const unsupported = validInsight();
  unsupported.patterns[0] = { ...unsupported.patterns[0], itemCount: 2, evidenceIds: unsupported.patterns[0].evidenceIds.slice(0, 2) };
  assert.throws(
    () => createReferenceInsight(unsupported),
    (error) => error.code === "INVALID_INTEGER" && error.path === "patterns[0].itemCount",
  );
});

test("rejeita referência ou evidência fora da linhagem declarada", () => {
  const unknownReference = validInsight();
  unknownReference.patterns[0].referenceKeys = ["reference:ffffffffffffffffffffffff"];
  assert.throws(
    () => createReferenceInsight(unknownReference),
    (error) => error.code === "UNKNOWN_REFERENCE",
  );
  const unknownEvidence = validInsight();
  unknownEvidence.patterns[0].evidenceIds[0] = "evidence:ffffffffffffffffffffffff";
  assert.throws(
    () => createReferenceInsight(unknownEvidence),
    (error) => error.code === "UNKNOWN_EVIDENCE",
  );
});

export function validInsight(overrides = {}) {
  const evidence = [1, 2, 3].map((index) => ({
    evidenceId: `evidence:00000000000000000000000${index}`,
    providerContentId: `video-${index}`,
    canonicalUrl: `https://youtube.com/watch?v=video-${index}`,
    publishedAt: `2026-09-2${index}T12:00:00.000Z`,
    observedAt: "2026-09-27T12:00:00.000Z",
    mediaType: "VIDEO",
    durationBand: "31_60S",
  }));
  return {
    schemaVersion: REFERENCE_INSIGHT_CONTRACT_VERSION,
    artifactType: "strategic_reference_analysis",
    artifactId: "reference-insight:0123456789abcdef01234567",
    revision: 1,
    pipelineRunId: "pipeline_e02_r03_001",
    projectId: "canal_educacao",
    projectVersion: 1,
    logicalDate: "2026-09-27",
    researchInputHash: "a".repeat(64),
    projectSnapshotHash: "b".repeat(64),
    policyVersion: REFERENCE_ANALYSIS_POLICY_VERSION,
    analysisWindow: {
      start: "2026-08-29T03:00:00.000Z",
      end: "2026-09-28T03:00:00.000Z",
      timezone: "America/Sao_Paulo",
      maxItemsPerReference: 25,
    },
    createdAt: "2026-09-27T12:00:00.000Z",
    createdBy: "SYSTEM",
    state: "COMPLETED",
    references: [{
      referenceKey: "reference:0123456789abcdef01234567",
      platform: "youtube",
      configuredHandle: "@canal",
      purpose: "strategic_reference",
      usage: "strategic_reference_only",
      grantsUsageRights: false,
      capability: "PUBLIC_HANDLE_UPLOADS",
      status: "SUCCESS",
      observedItems: 3,
      evidence,
      gaps: [],
    }],
    patterns: [{
      dimension: "FORMAT_MIX",
      value: "VIDEO",
      itemCount: 3,
      referenceCount: 1,
      referenceKeys: ["reference:0123456789abcdef01234567"],
      evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
    }],
    gaps: [],
    contentHash: "c".repeat(64),
    rights: {
      usageCondition: "strategic_reference_only",
      grantsUsageRights: false,
      mediaDownloaded: false,
      sourceTextStored: false,
      republicationAllowed: false,
    },
    ...overrides,
  };
}
