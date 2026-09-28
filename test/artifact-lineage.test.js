import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ArtifactLineageRepository, ArtifactLineageRepositoryError } from "../src/artifact-lineage-repository.js";
import { ArtifactLineageService } from "../src/artifact-lineage-service.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";

const STARTED_AT = "2026-09-28T11:00:00.000Z";

test("registra, recupera e lista artefatos da run em ordem determinística", () => {
  withService(({ service, path }) => {
    const later = service.register(artifact({ artifactId: "artifact_b", createdAt: "2026-09-28T12:02:00.000Z" }));
    const earlier = service.register(artifact({
      artifactId: "artifact_a",
      contentIdentity: "content_002",
      contentHash: "b".repeat(64),
      createdAt: "2026-09-28T12:01:00.000Z",
    }));

    assert.deepEqual(service.get("artifact_a"), earlier);
    assert.deepEqual(service.listByPipelineRun("run_fnd02_001"), [earlier, later]);
    assert.equal(Object.isFrozen(earlier), true);
    assert.deepEqual(counts(path), { artifacts: 2, inputs: 0 });
  });
});

test("retry idêntico não duplica e identidade divergente falha sem efeito parcial", () => {
  withService(({ service, path }) => {
    const created = service.register(artifact());
    assert.deepEqual(service.register(artifact()), created);
    assert.throws(
      () => service.register(artifact({ contentHash: "f".repeat(64) })),
      repositoryError("ARTIFACT_ID_REUSED", "artifactId"),
    );
    assert.deepEqual(counts(path), { artifacts: 1, inputs: 0 });
  });
});

test("identidade lógica e versão não podem apontar para artefatos incompatíveis", () => {
  withService(({ service, path }) => {
    service.register(artifact());
    assert.throws(
      () => service.register(artifact({ artifactId: "artifact_other_001", contentHash: "e".repeat(64) })),
      repositoryError("ARTIFACT_CONTENT_IDENTITY_REUSED", "contentIdentity"),
    );
    assert.deepEqual(counts(path), { artifacts: 1, inputs: 0 });
  });
});

test("exige PipelineRun persistida e escopo exato de projeto e versão", () => {
  withService(({ service, repository, path }) => {
    assert.throws(
      () => service.register(artifact({ pipelineRunId: "run_missing_001" })),
      repositoryError("PIPELINE_RUN_NOT_FOUND", "pipelineRunId"),
    );
    repository.createVersion(project({ version: 2, name: "Nova versão" }), {
      expectedVersion: 1,
      createdAt: "2026-09-28T11:30:00.000Z",
    });
    assert.throws(
      () => service.register(artifact({ projectVersion: 2 })),
      repositoryError("ARTIFACT_RUN_SCOPE_MISMATCH", "projectVersion"),
    );
    assert.deepEqual(counts(path), { artifacts: 0, inputs: 0 });
  });
});

test("preserva entradas ordenadas e valida referências internas", () => {
  withService(({ service, repository, path }) => {
    const parent = service.register(artifact());
    const child = service.register(artifact({
      artifactId: "artifact_child_001",
      artifactType: "script",
      contentIdentity: "content_child_001",
      contentHash: "c".repeat(64),
      inputs: [
        { position: 1, kind: "INTERNAL_ARTIFACT", inputId: parent.artifactId, contentHash: parent.contentHash },
        { position: 2, kind: "EXTERNAL_INPUT", inputId: "research_input_001", contentHash: "d".repeat(64) },
      ],
    }));
    assert.deepEqual(service.get(child.artifactId).inputs, child.inputs);
    assert.deepEqual(counts(path), { artifacts: 2, inputs: 2 });

    assert.throws(
      () => service.register(artifact({
        artifactId: "artifact_missing_input",
        contentIdentity: "content_missing_input",
        inputs: [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: "artifact_unknown_001", contentHash: "e".repeat(64) }],
      })),
      repositoryError("ARTIFACT_INPUT_NOT_FOUND", "inputs.0.inputId"),
    );
    assert.deepEqual(counts(path), { artifacts: 2, inputs: 2 });

    repository.startRun({ execution: {
      pipelineRunId: "run_fnd02_002", projectId: "project_curiosidades_ia", projectVersion: 1,
      startedAt: "2026-09-28T13:00:00.000Z",
    }, projectSnapshot: repository.get("project_curiosidades_ia", 1) });
    assert.throws(
      () => service.register(artifact({
        artifactId: "artifact_other_run",
        pipelineRunId: "run_fnd02_002",
        contentIdentity: "content_other_run",
        inputs: [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: parent.artifactId, contentHash: parent.contentHash }],
      })),
      repositoryError("ARTIFACT_INPUT_SCOPE_MISMATCH", "inputs.0.inputId"),
    );
  });
});

test("rejeita hash incompatível da referência interna e reverte toda a criação", () => {
  withService(({ service, path }) => {
    service.register(artifact());
    assert.throws(
      () => service.register(artifact({
        artifactId: "artifact_child_001",
        contentIdentity: "content_child_001",
        inputs: [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: "artifact_fnd02_001", contentHash: "0".repeat(64) }],
      })),
      repositoryError("ARTIFACT_INPUT_HASH_MISMATCH", "inputs.0.contentHash"),
    );
    assert.deepEqual(counts(path), { artifacts: 1, inputs: 0 });
  });
});

test("metadados sanitizados são persistidos sem prompts ou segredos", () => {
  withService(({ service, path }) => {
    const created = service.register(artifact({ generationMetadata: {
      provider: "openai", model: "gpt-5-mini", taskType: "script_generation",
      promptVersion: "script-prompt/1.0.0", configurationHash: "9".repeat(64),
      publicConfiguration: { temperature: 0.2, responseFormat: "json" },
    } }));
    assert.equal(created.generationMetadata.provider, "openai");

    const raw = new DatabaseSync(path);
    const stored = raw.prepare("SELECT generation_metadata_json FROM artifact_lineage WHERE artifact_id = ?")
      .get(created.artifactId).generation_metadata_json;
    raw.close();
    assert.equal(stored.includes("prompt privado"), false);
    assert.equal(stored.includes("segredo"), false);
  });
});

test("falha ao inserir entrada reverte artefato e entradas anteriores", () => {
  withService(({ service, path }) => {
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_second_artifact_input BEFORE INSERT ON artifact_lineage_inputs
      WHEN NEW.position = 2 BEGIN SELECT RAISE(ABORT, 'FORCED_INPUT_FAILURE'); END;`);
    raw.close();

    assert.throws(() => service.register(artifact({ inputs: [
      { position: 1, kind: "EXTERNAL_INPUT", inputId: "input_one_001", contentHash: "1".repeat(64) },
      { position: 2, kind: "EXTERNAL_INPUT", inputId: "input_two_001", contentHash: "2".repeat(64) },
    ] })), repositoryError("ARTIFACT_PERSISTENCE_FAILED", "artifact"));
    assert.deepEqual(counts(path), { artifacts: 0, inputs: 0 });
  });
});

test("banco impede alteração e remoção retroativa de artefatos e linhagem", () => {
  withService(({ service, path }) => {
    service.register(artifact({ inputs: [
      { position: 1, kind: "EXTERNAL_INPUT", inputId: "research_input_001", contentHash: "1".repeat(64) },
    ] }));
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE artifact_lineage SET content_hash = ? WHERE artifact_id = ?")
        .run("2".repeat(64), "artifact_fnd02_001"), /IMMUTABLE_ARTIFACT/);
      assert.throws(() => raw.prepare("DELETE FROM artifact_lineage_inputs WHERE artifact_id = ?")
        .run("artifact_fnd02_001"), /IMMUTABLE_ARTIFACT_INPUT/);
      assert.throws(() => raw.prepare("DELETE FROM artifact_lineage WHERE artifact_id = ?")
        .run("artifact_fnd02_001"), /IMMUTABLE_ARTIFACT/);
    } finally {
      raw.close();
    }
  });
});

test("leitura revalida o contrato e expõe erro público sanitizado", () => {
  withService(({ service, path }) => {
    service.register(artifact());
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER artifact_lineage_no_update");
    raw.prepare("UPDATE artifact_lineage SET generation_metadata_json = ? WHERE artifact_id = ?")
      .run('{"prompt":"segredo privado"}', "artifact_fnd02_001");
    raw.close();

    assert.throws(
      () => service.get("artifact_fnd02_001"),
      repositoryError("INVALID_PERSISTED_ARTIFACT", "artifactId"),
    );
  });
});

test("migrações 009 a 019 são aditivas e não criam efeitos nos artefatos atuais de Research", () => {
  withDatabase((path) => {
    const repository = new ArtifactLineageRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    new PipelineRunService(repository).start(request());
    repository.close();

    const before = new DatabaseSync(path);
    before.exec(`
      DROP TABLE media_acquisition_requests;
      DROP TABLE media_assets;
      DROP TABLE voice_generation_requests;
      DROP TABLE voice_tracks;
      DROP TABLE ai_call_telemetry;
      DROP TABLE script_generation_requests;
      DROP TABLE scripts;
      DROP TABLE idea_selections;
      DROP TABLE idea_candidate_evidence;
      DROP TABLE idea_scores;
      DROP TABLE idea_candidates;
      DROP TABLE idea_batches;
      DROP TRIGGER cost_events_no_update;
      DROP TRIGGER cost_events_no_delete;
      DROP TABLE cost_events;
      DROP TRIGGER artifact_lineage_no_update;
      DROP TRIGGER artifact_lineage_no_delete;
      DROP TRIGGER artifact_lineage_inputs_no_update;
      DROP TRIGGER artifact_lineage_inputs_no_delete;
      DROP TABLE artifact_lineage_inputs;
      DROP TABLE artifact_lineage;
      DELETE FROM schema_migrations WHERE version = 19;
      DELETE FROM schema_migrations WHERE version = 18;
      DELETE FROM schema_migrations WHERE version = 17;
      DELETE FROM schema_migrations WHERE version = 16;
      DELETE FROM schema_migrations WHERE version = 15;
      DELETE FROM schema_migrations WHERE version = 14;
      DELETE FROM schema_migrations WHERE version = 13;
      DELETE FROM schema_migrations WHERE version = 12;
      DELETE FROM schema_migrations WHERE version = 11;
      DELETE FROM schema_migrations WHERE version = 10;
      DELETE FROM schema_migrations WHERE version = 9;
      PRAGMA user_version = 8;
    `);
    before.close();

    const migrated = new ArtifactLineageRepository(path);
    assert.equal(migrated.getRun("run_fnd02_001").projectId, "project_curiosidades_ia");
    assert.deepEqual(migrated.listByPipelineRun("run_fnd02_001"), []);
    migrated.close();

    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 19);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 19);
    for (const table of ["research_artifacts", "reference_insights", "research_shortlists"]) {
      assert.equal(raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
    }
    raw.close();
  });
});

function artifact(overrides = {}) {
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

function request() {
  return {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: "run_fnd02_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
  };
}

function project(overrides = {}) {
  return {
    id: "project_curiosidades_ia", name: "Curiosidades IA", version: 1,
    niche: "inteligência artificial", subniches: ["ferramentas"],
    audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" },
    references: [],
    channel: { publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] } },
    ...overrides,
  };
}

function repositoryError(code, field) {
  return (caught) => caught instanceof ArtifactLineageRepositoryError
    && caught.code === code && caught.field === field;
}

function counts(path) {
  const raw = new DatabaseSync(path);
  try {
    return {
      artifacts: raw.prepare("SELECT COUNT(*) AS total FROM artifact_lineage").get().total,
      inputs: raw.prepare("SELECT COUNT(*) AS total FROM artifact_lineage_inputs").get().total,
    };
  } finally { raw.close(); }
}

function withService(operation) {
  withDatabase((path) => {
    const repository = new ArtifactLineageRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    new PipelineRunService(repository).start(request());
    const service = new ArtifactLineageService(repository);
    try { operation({ service, repository, path }); }
    finally { if (repository.db?.isOpen) repository.close(); }
  });
}

function withDatabase(operation) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-artifact-lineage-"));
  try { operation(join(root, "catalog.sqlite")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
