import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { ResearchInputService } from "../src/research-input-service.js";
import {
  PipelineRunRepository,
  PipelineRunRepositoryError,
} from "../src/pipeline-run-repository.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";

const STARTED_AT = "2026-09-27T15:00:00.000Z";
const COMPLETED_AT = "2026-09-27T15:05:00.000Z";

test("inicia, recupera e retoma a mesma PipelineRun sem duplicar registros", () => {
  withService(({ service, repository, path }) => {
    const started = service.start(request());
    const resumed = service.resume(request());

    assert.deepEqual(resumed, started);
    assert.deepEqual(service.get("run_fnd01_001"), started);
    assert.equal(started.state, "RUNNING");
    assert.equal(started.projectVersion, 1);
    assert.equal(started.projectSnapshot.project.name, "Curiosidades IA");
    assert.equal(Object.isFrozen(started), true);
    assert.equal(Object.isFrozen(started.projectSnapshot), true);
    assert.deepEqual(counts(path), { runs: 1, transitions: 1 });
    repository.close();
  });
});

test("reutilização incompatível de pipelineRunId falha antes de produzir efeitos", () => {
  withService(({ service, repository, path }) => {
    service.start(request());
    repository.createVersion(project({ version: 2, name: "Nova versão" }), {
      expectedVersion: 1,
      createdAt: "2026-09-27T16:00:00.000Z",
    });

    assert.throws(
      () => service.start(request({ projectVersion: 2 })),
      repositoryError("PIPELINE_RUN_ID_REUSED", "pipelineRunId"),
    );
    assert.deepEqual(counts(path), { runs: 1, transitions: 1 });
  });
});

test("mantém compatibilidade com ResearchInput sem criar efeitos fora do FND01", () => {
  withService(({ service, repository, path }) => {
    const run = service.start(request());
    const researchInput = new ResearchInputService(repository).create({
      handoff: request(),
      window: { logicalDate: "2026-09-27" },
    });

    assert.deepEqual(researchInput.execution, {
      pipelineRunId: run.pipelineRunId,
      projectId: run.projectId,
      projectVersion: run.projectVersion,
      startedAt: run.startedAt,
    });
    assert.deepEqual(researchInput.projectSnapshot, run.projectSnapshot);

    const raw = new DatabaseSync(path);
    try {
      for (const table of [
        "trend_runs",
        "research_daily_runs",
        "research_artifacts",
        "reference_analysis_runs",
        "reference_insights",
        "research_shortlists",
      ]) {
        assert.equal(raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
      }
    } finally {
      raw.close();
    }
  });
});

test("snapshot e versão persistidos não mudam após nova versão e arquivamento", () => {
  withService(({ service, repository }) => {
    const original = service.start(request());
    repository.createVersion(project({ version: 2, name: "Nova versão" }), {
      expectedVersion: 1,
      createdAt: "2026-09-27T16:00:00.000Z",
    });
    repository.archive("project_curiosidades_ia", {
      expectedVersion: 2,
      archivedAt: "2026-09-27T17:00:00.000Z",
    });

    const recovered = service.get("run_fnd01_001");
    assert.deepEqual(recovered, original);
    assert.equal(recovered.projectVersion, 1);
    assert.equal(recovered.projectSnapshot.project.name, "Curiosidades IA");
  });
});

test("persiste somente as transições válidas e torna retry terminal idempotente", () => {
  withService(({ service, path }) => {
    service.start(request());
    const completed = service.succeed("run_fnd01_001", { completedAt: COMPLETED_AT });
    const retry = service.succeed("run_fnd01_001", { completedAt: COMPLETED_AT });

    assert.deepEqual(retry, completed);
    assert.equal(completed.state, "SUCCEEDED");
    assert.equal(completed.completedAt, COMPLETED_AT);
    assert.equal(completed.error, null);
    assert.deepEqual(completed.transitions.map(({ previousState, nextState }) => [previousState, nextState]), [
      [null, "RUNNING"],
      ["RUNNING", "SUCCEEDED"],
    ]);
    assert.deepEqual(counts(path), { runs: 1, transitions: 2 });

    assert.throws(
      () => service.fail("run_fnd01_001", {
        completedAt: "2026-09-27T15:06:00.000Z",
        error: { code: "PROVIDER_FAILED", field: "provider" },
      }),
      repositoryError("INVALID_PIPELINE_RUN_TRANSITION", "state"),
    );
    assert.deepEqual(counts(path), { runs: 1, transitions: 2 });
    assert.deepEqual(service.get("run_fnd01_001"), completed);
  });
});

test("falha registra somente código e campo sanitizados", () => {
  withService(({ service, path }) => {
    service.start(request());
    const privateError = new Error("token=segredo payload privado");
    privateError.code = "PROVIDER_FAILED";
    privateError.field = "provider";
    privateError.payload = { authorization: "Bearer segredo" };

    const failed = service.fail("run_fnd01_001", { completedAt: COMPLETED_AT, error: privateError });
    assert.deepEqual(failed.error, { code: "PROVIDER_FAILED", field: "provider" });
    assert.equal(JSON.stringify(failed).includes("segredo"), false);

    const raw = new DatabaseSync(path);
    const stored = raw.prepare("SELECT error_json FROM pipeline_runs WHERE pipeline_run_id = ?")
      .get("run_fnd01_001").error_json;
    raw.close();
    assert.equal(stored, '{"code":"PROVIDER_FAILED","field":"provider"}');
    assert.equal(stored.includes("segredo"), false);
  });
});

test("erro sem código público vira falha genérica sem refletir detalhes", () => {
  withService(({ service }) => {
    service.start(request());
    const failed = service.fail("run_fnd01_001", {
      completedAt: COMPLETED_AT,
      error: new Error("senha=privada"),
    });
    assert.deepEqual(failed.error, { code: "PIPELINE_RUN_FAILED", field: "pipelineRun" });
  });
});

test("falha ao anexar a transição reverte a mudança de estado integralmente", () => {
  withService(({ service, path }) => {
    service.start(request());
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_pipeline_transition BEFORE INSERT ON pipeline_run_transitions
      WHEN NEW.next_state = 'SUCCEEDED'
      BEGIN SELECT RAISE(ABORT, 'FORCED_TRANSITION_FAILURE'); END;`);
    raw.close();

    assert.throws(
      () => service.succeed("run_fnd01_001", { completedAt: COMPLETED_AT }),
      /FORCED_TRANSITION_FAILURE/,
    );
    assert.equal(service.get("run_fnd01_001").state, "RUNNING");
    assert.deepEqual(counts(path), { runs: 1, transitions: 1 });
  });
});

test("falha no histórico inicial reverte integralmente a criação da run", () => {
  withService(({ service, path }) => {
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_initial_pipeline_transition BEFORE INSERT ON pipeline_run_transitions
      WHEN NEW.previous_state IS NULL
      BEGIN SELECT RAISE(ABORT, 'FORCED_INITIAL_TRANSITION_FAILURE'); END;`);
    raw.close();

    assert.throws(() => service.start(request()), /FORCED_INITIAL_TRANSITION_FAILURE/);
    assert.deepEqual(counts(path), { runs: 0, transitions: 0 });
  });
});

test("triggers impedem alteração da identidade, transições históricas e exclusão", () => {
  withService(({ service, path }) => {
    service.start(request());
    const raw = new DatabaseSync(path);
    try {
      assert.throws(
        () => raw.prepare("UPDATE pipeline_runs SET project_version = 2 WHERE pipeline_run_id = ?")
          .run("run_fnd01_001"),
        /IMMUTABLE_PIPELINE_RUN_IDENTITY/,
      );
      assert.throws(
        () => raw.prepare("DELETE FROM pipeline_run_transitions WHERE pipeline_run_id = ?")
          .run("run_fnd01_001"),
        /IMMUTABLE_PIPELINE_RUN_TRANSITION/,
      );
      assert.throws(
        () => raw.prepare("DELETE FROM pipeline_runs WHERE pipeline_run_id = ?").run("run_fnd01_001"),
        /IMMUTABLE_PIPELINE_RUN/,
      );
    } finally {
      raw.close();
    }
  });
});

test("migrações 008 a 015 são aditivas e preservam dados existentes", () => {
  withDatabase((path) => {
    const repository = new PipelineRunRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    repository.close();

    const before = new DatabaseSync(path);
    before.exec(`
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
      DROP TRIGGER pipeline_runs_no_identity_update;
      DROP TRIGGER pipeline_runs_valid_state_update;
      DROP TRIGGER pipeline_runs_no_delete;
      DROP TRIGGER pipeline_run_transitions_no_update;
      DROP TRIGGER pipeline_run_transitions_no_delete;
      DROP TABLE pipeline_run_transitions;
      DROP TABLE pipeline_runs;
      DELETE FROM schema_migrations WHERE version = 15;
      DELETE FROM schema_migrations WHERE version = 14;
      DELETE FROM schema_migrations WHERE version = 13;
      DELETE FROM schema_migrations WHERE version = 12;
      DELETE FROM schema_migrations WHERE version = 11;
      DELETE FROM schema_migrations WHERE version = 10;
      DELETE FROM schema_migrations WHERE version = 9;
      DELETE FROM schema_migrations WHERE version = 8;
      PRAGMA user_version = 7;
    `);
    before.close();

    const migrated = new PipelineRunRepository(path);
    assert.equal(migrated.get("project_curiosidades_ia", 1).project.name, "Curiosidades IA");
    assert.equal(migrated.getRun("run_inexistente"), null);
    migrated.close();

    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 15);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM project_snapshots").get().total, 1);
    raw.close();
  });
});

function request(overrides = {}) {
  return {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: "run_fnd01_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
    ...overrides,
  };
}

function project(overrides = {}) {
  return {
    id: "project_curiosidades_ia",
    name: "Curiosidades IA",
    version: 1,
    niche: "inteligência artificial",
    subniches: ["ferramentas"],
    audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" },
    references: [],
    channel: {
      publishing: {
        contentsPerDay: 1,
        networks: ["instagram"],
        timezone: "America/Sao_Paulo",
        times: ["10:00"],
      },
    },
    ...overrides,
  };
}

function repositoryError(code, field) {
  return (caught) => caught instanceof PipelineRunRepositoryError
    && caught.code === code
    && caught.field === field;
}

function counts(path) {
  const raw = new DatabaseSync(path);
  try {
    return {
      runs: raw.prepare("SELECT COUNT(*) AS total FROM pipeline_runs").get().total,
      transitions: raw.prepare("SELECT COUNT(*) AS total FROM pipeline_run_transitions").get().total,
    };
  } finally {
    raw.close();
  }
}

function withService(operation) {
  withDatabase((path) => {
    const repository = new PipelineRunRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    const service = new PipelineRunService(repository);
    try {
      operation({ service, repository, path });
    } finally {
      if (repository.db?.isOpen) repository.close();
    }
  });
}

function withDatabase(operation) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-pipeline-run-"));
  try {
    operation(join(root, "catalog.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
