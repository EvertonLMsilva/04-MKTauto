import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CostLedgerRepository, CostLedgerRepositoryError } from "../src/cost-ledger-repository.js";
import { CostLedgerService } from "../src/cost-ledger-service.js";
import { COST_EVENT_CONTRACT_VERSION, COST_LEDGER_CONTRACT_VERSION } from "../src/domain/cost-event-contracts.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION } from "../src/domain/artifact-lineage-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { PipelineRunService } from "../src/pipeline-run-service.js";

const STARTED_AT = "2026-09-28T11:00:00.000Z";

test("registra, recupera e lista eventos em ordem determinística", () => {
  withService(({ service, path }) => {
    const later = service.register(costEvent({ costEventId: "cost_b", occurredAt: "2026-09-28T12:02:00.000Z" }));
    const earlier = service.register(costEvent({ costEventId: "cost_a", occurredAt: "2026-09-28T12:01:00.000Z" }));

    assert.deepEqual(service.get("cost_a"), earlier);
    assert.deepEqual(service.listByPipelineRun("run_fnd03_001"), [earlier, later]);
    assert.equal(Object.isFrozen(earlier), true);
    assert.equal(count(path), 2);
  });
});

test("retry idêntico não duplica e conflitos falham sem efeito parcial", () => {
  withService(({ service, path }) => {
    const created = service.register(costEvent());
    assert.deepEqual(service.register(costEvent()), created);
    for (const [change, field] of [
      [{ amount: "0.126" }, "costEventId"],
      [{ currency: "BRL" }, "costEventId"],
      [{ pipelineRunId: "run_other_001" }, "costEventId"],
      [{ origin: "manual_invoice" }, "costEventId"],
      [{ attributionRuleVersion: "direct-run/2.0.0" }, "costEventId"],
    ]) {
      assert.throws(() => service.register(costEvent(change)), repositoryError("COST_EVENT_ID_REUSED", field));
    }
    assert.equal(count(path), 1);
  });
});

test("exige run persistida e projeto e versão coerentes", () => {
  withService(({ service, repository, path }) => {
    assert.throws(
      () => service.register(costEvent({ pipelineRunId: "run_missing_001" })),
      repositoryError("PIPELINE_RUN_NOT_FOUND", "pipelineRunId"),
    );
    repository.createVersion(project({ version: 2, name: "Nova versão" }), {
      expectedVersion: 1, createdAt: "2026-09-28T11:30:00.000Z",
    });
    assert.throws(
      () => service.register(costEvent({ projectVersion: 2 })),
      repositoryError("COST_EVENT_RUN_SCOPE_MISMATCH", "projectVersion"),
    );
    assert.equal(count(path), 0);
  });
});

test("valida artefato opcional e identidade de conteúdo contra a linhagem", () => {
  withService(({ service, repository, path }) => {
    repository.registerArtifact(artifact());
    const linked = service.register(costEvent({ artifactId: "artifact_fnd03_001" }));
    assert.equal(linked.artifactId, "artifact_fnd03_001");

    assert.throws(
      () => service.register(costEvent({ costEventId: "cost_missing", artifactId: "artifact_missing" })),
      repositoryError("COST_EVENT_ARTIFACT_NOT_FOUND", "artifactId"),
    );
    assert.throws(
      () => service.register(costEvent({
        costEventId: "cost_content_mismatch", artifactId: "artifact_fnd03_001", contentIdentity: "content_other",
      })),
      repositoryError("COST_EVENT_CONTENT_MISMATCH", "contentIdentity"),
    );
    repository.startRun({ execution: {
      pipelineRunId: "run_fnd03_002", projectId: "project_curiosidades_ia", projectVersion: 1,
      startedAt: "2026-09-28T13:00:00.000Z",
    }, projectSnapshot: repository.get("project_curiosidades_ia", 1) });
    repository.registerArtifact({
      ...artifact(), artifactId: "artifact_other_run", pipelineRunId: "run_fnd03_002",
      contentIdentity: "content_other_run", contentHash: "b".repeat(64),
    });
    assert.throws(
      () => service.register(costEvent({
        costEventId: "cost_other_run", artifactId: "artifact_other_run", contentIdentity: null,
      })),
      repositoryError("COST_EVENT_ARTIFACT_SCOPE_MISMATCH", "artifactId"),
    );
    assert.equal(count(path), 1);
  });
});

test("ledger soma decimais exatamente, separa moedas e não inventa zero", () => {
  withService(({ service }) => {
    assert.deepEqual(service.getLedgerByPipelineRun("run_fnd03_001"), {
      schemaVersion: COST_LEDGER_CONTRACT_VERSION,
      pipelineRunId: "run_fnd03_001",
      projectId: "project_curiosidades_ia",
      projectVersion: 1,
      events: [],
      totalsByCurrency: [],
    });
    service.register(costEvent({ costEventId: "cost_usd_a", amount: "0.1" }));
    service.register(costEvent({ costEventId: "cost_usd_b", amount: "0.2" }));
    service.register(costEvent({ costEventId: "cost_brl", amount: "2.50", currency: "BRL" }));
    const ledger = service.getLedgerByPipelineRun("run_fnd03_001");
    assert.deepEqual(ledger.totalsByCurrency, [
      { currency: "BRL", amount: "2.5" },
      { currency: "USD", amount: "0.3" },
    ]);
    assert.equal(Object.isFrozen(ledger), true);
  });
});

test("banco impede update e delete retroativos", () => {
  withService(({ service, path }) => {
    service.register(costEvent());
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.prepare("UPDATE cost_events SET amount = '9' WHERE cost_event_id = 'cost_fnd03_001'").run(), /IMMUTABLE_COST_EVENT/);
      assert.throws(() => raw.prepare("DELETE FROM cost_events WHERE cost_event_id = 'cost_fnd03_001'").run(), /IMMUTABLE_COST_EVENT/);
    } finally { raw.close(); }
  });
});

test("falha transacional não deixa estado parcial e expõe erro sanitizado", () => {
  withService(({ service, path }) => {
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TRIGGER reject_cost BEFORE INSERT ON cost_events BEGIN SELECT RAISE(ABORT, 'PRIVATE provider payload'); END;");
    raw.close();
    assert.throws(
      () => service.register(costEvent()),
      repositoryError("COST_EVENT_PERSISTENCE_FAILED", "costEvent"),
    );
    assert.equal(count(path), 0);
  });
});

test("leitura revalida contrato e hash persistidos", () => {
  withService(({ service, path }) => {
    service.register(costEvent());
    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER cost_events_no_update");
    raw.prepare("UPDATE cost_events SET amount = 'invalid' WHERE cost_event_id = ?").run("cost_fnd03_001");
    raw.close();
    assert.throws(
      () => service.get("cost_fnd03_001"),
      repositoryError("INVALID_PERSISTED_COST_EVENT", "costEventId"),
    );
  });
});

test("migração 010 é aditiva e preserva registros existentes", () => {
  withDatabase((path) => {
    const repository = new CostLedgerRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    new PipelineRunService(repository).start(request());
    repository.close();

    const before = new DatabaseSync(path);
    before.exec(`DROP TABLE composition_plan_segments; DROP TABLE composition_plans; DROP TABLE media_acquisition_requests; DROP TABLE media_assets; DROP TABLE voice_generation_requests; DROP TABLE voice_tracks; DROP TABLE ai_call_telemetry; DROP TABLE script_generation_requests; DROP TABLE scripts; DROP TABLE idea_selections; DROP TABLE idea_candidate_evidence; DROP TABLE idea_scores;
      DROP TABLE idea_candidates; DROP TABLE idea_batches;
      DROP TRIGGER cost_events_no_update; DROP TRIGGER cost_events_no_delete;
      DROP TABLE cost_events; DELETE FROM schema_migrations WHERE version = 20; DELETE FROM schema_migrations WHERE version = 19; DELETE FROM schema_migrations WHERE version = 18; DELETE FROM schema_migrations WHERE version = 17; DELETE FROM schema_migrations WHERE version = 16; DELETE FROM schema_migrations WHERE version = 15; DELETE FROM schema_migrations WHERE version = 14; DELETE FROM schema_migrations WHERE version = 13; DELETE FROM schema_migrations WHERE version = 12;
      DELETE FROM schema_migrations WHERE version = 11;
      DELETE FROM schema_migrations WHERE version = 10; PRAGMA user_version = 9;`);
    before.close();

    const migrated = new CostLedgerRepository(path);
    assert.equal(migrated.getRun("run_fnd03_001").projectId, "project_curiosidades_ia");
    assert.deepEqual(migrated.listByPipelineRun("run_fnd03_001"), []);
    migrated.close();

    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 20);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 20);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM pipeline_runs").get().total, 1);
    raw.close();
  });
});

function costEvent(overrides = {}) {
  return {
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: "cost_fnd03_001",
    category: "ai_cost",
    pipelineRunId: "run_fnd03_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    contentIdentity: "content_001",
    artifactId: null,
    amount: "0.125",
    currency: "USD",
    occurredAt: "2026-09-28T12:00:00.000Z",
    origin: "openai_invoice",
    attributionRuleVersion: "direct-run/1.0.0",
    recordedAt: "2026-09-28T12:01:00.000Z",
    ...overrides,
  };
}

function artifact() {
  return {
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
    artifactId: "artifact_fnd03_001", artifactType: "script", artifactVersion: 1,
    pipelineRunId: "run_fnd03_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    contentIdentity: "content_001", hashAlgorithm: "sha256", contentHash: "a".repeat(64),
    inputs: [], generationMetadata: null, createdAt: "2026-09-28T11:30:00.000Z",
  };
}

function request() {
  return {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: "run_fnd03_001", projectId: "project_curiosidades_ia",
    projectVersion: 1, startedAt: STARTED_AT,
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
  return (caught) => caught instanceof CostLedgerRepositoryError
    && caught.code === code && caught.field === field;
}

function count(path) {
  const raw = new DatabaseSync(path);
  try { return raw.prepare("SELECT COUNT(*) AS total FROM cost_events").get().total; }
  finally { raw.close(); }
}

function withService(operation) {
  withDatabase((path) => {
    const repository = new CostLedgerRepository(path);
    repository.create(project(), { createdAt: STARTED_AT });
    new PipelineRunService(repository).start(request());
    const service = new CostLedgerService(repository);
    try { operation({ service, repository, path }); }
    finally { if (repository.db?.isOpen) repository.close(); }
  });
}

function withDatabase(operation) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-cost-ledger-"));
  try { operation(join(root, "catalog.sqlite")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
