import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
  validateArtifactLineage,
} from "../src/domain/artifact-lineage-contracts.js";

test("valida, normaliza e congela a linhagem comum", () => {
  const artifact = validateArtifactLineage(validArtifact({
    inputs: [
      { position: 1, kind: "EXTERNAL_INPUT", inputId: "research_input_001", contentHash: "b".repeat(64) },
      { position: 2, kind: "INTERNAL_ARTIFACT", inputId: "artifact_parent_001", contentHash: "c".repeat(64) },
    ],
  }));

  assert.equal(artifact.schemaVersion, ARTIFACT_LINEAGE_CONTRACT_VERSION);
  assert.equal(artifact.hashAlgorithm, "sha256");
  assert.deepEqual(artifact.inputs.map(({ position }) => position), [1, 2]);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.inputs[0]), true);
});

test("rejeita hashes, posições e campos desconhecidos com códigos e campos estáveis", () => {
  assert.throws(
    () => validateArtifactLineage(validArtifact({ contentHash: "inválido" })),
    contractError("INVALID_HASH", "contentHash"),
  );
  assert.throws(
    () => validateArtifactLineage(validArtifact({
      inputs: [{ position: 2, kind: "EXTERNAL_INPUT", inputId: "research_input_001", contentHash: "b".repeat(64) }],
    })),
    contractError("INVALID_INPUT_POSITION", "inputs.0.position"),
  );
  assert.throws(
    () => validateArtifactLineage({ ...validArtifact(), prompt: "privado" }),
    contractError("UNKNOWN_FIELD", "artifact.prompt"),
  );
});

test("metadados de geração são opcionais, coerentes e sanitizados", () => {
  assert.equal(validateArtifactLineage(validArtifact()).generationMetadata, null);
  const generated = validateArtifactLineage(validArtifact({
    generationMetadata: {
      provider: "openai",
      model: "gpt-5-mini",
      taskType: "script_generation",
      promptVersion: "script-prompt/1.0.0",
      configurationHash: "d".repeat(64),
      publicConfiguration: { temperature: 0.2, responseFormat: "json", nested: { seed: 42 } },
    },
  }));
  assert.deepEqual(Object.keys(generated.generationMetadata.publicConfiguration), ["nested", "responseFormat", "temperature"]);

  assert.throws(
    () => validateArtifactLineage(validArtifact({
      generationMetadata: {
        provider: "openai",
        model: "gpt-5-mini",
        taskType: "script_generation",
        promptVersion: "script-prompt/1.0.0",
        configurationHash: "d".repeat(64),
        publicConfiguration: { apiKey: "segredo" },
      },
    })),
    contractError("SENSITIVE_CONFIGURATION_FIELD", "generationMetadata.publicConfiguration.apiKey"),
  );
  assert.throws(
    () => validateArtifactLineage(validArtifact({ generationMetadata: { provider: "openai" } })),
    contractError("REQUIRED_FIELD", "generationMetadata.model"),
  );
});

function validArtifact(overrides = {}) {
  return {
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
    artifactId: "artifact_fnd02_001",
    artifactType: "research_shortlist",
    artifactVersion: 1,
    pipelineRunId: "run_fnd02_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    contentIdentity: "content_001",
    hashAlgorithm: "sha256",
    contentHash: "a".repeat(64),
    inputs: [],
    generationMetadata: null,
    createdAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

function contractError(code, path) {
  return (caught) => caught?.code === code && caught?.path === path;
}
