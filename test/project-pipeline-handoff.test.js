import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createProjectSnapshot } from "../src/domain/project-contracts.js";
import {
  PIPELINE_HANDOFF_CONTRACT_VERSION,
  PipelineHandoffError,
  ProjectPipelineHandoffService,
  validatePipelineHandoffRequest,
} from "../src/project-pipeline-handoff.js";
import { ProjectRepository } from "../src/project-repository.js";
import { runProjectCli } from "../src/project-cli.js";

const STARTED_AT = "2026-09-27T15:00:00.000Z";

test("contrato exige seleção explícita, rejeita campos desconhecidos e segredos", () => {
  assert.throws(
    () => validatePipelineHandoffRequest(request({ projectId: undefined })),
    handoffError("REQUIRED_FIELD", "projectId"),
  );
  assert.throws(
    () => validatePipelineHandoffRequest(request({ projectVersion: undefined })),
    handoffError("REQUIRED_FIELD", "projectVersion"),
  );
  assert.throws(
    () => validatePipelineHandoffRequest({ ...request(), latest: true }),
    handoffError("UNKNOWN_FIELD", "request.latest"),
  );
  assert.throws(
    () => validatePipelineHandoffRequest({ ...request(), accessToken: "não-vazar" }),
    handoffError("SENSITIVE_FIELD_REJECTED", "accessToken"),
  );
});

test("handoff revalida e entrega exatamente o snapshot versionado ao consumidor stub", () => {
  const snapshot = createProjectSnapshot(project());
  const reads = [];
  let consumed;
  const repository = {
    get(projectId, projectVersion) {
      reads.push([projectId, projectVersion]);
      return snapshot;
    },
  };
  const consumer = {
    consume(input) {
      consumed = input;
      return {
        schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
        artifactId: `${input.execution.pipelineRunId}_project_snapshot`,
        artifactType: "project_snapshot_handoff",
        pipelineRunId: input.execution.pipelineRunId,
        projectId: input.execution.projectId,
        projectVersion: input.execution.projectVersion,
        createdAt: input.execution.startedAt,
      };
    },
  };

  const result = new ProjectPipelineHandoffService(repository, consumer).start(request());

  assert.deepEqual(reads, [["project_curiosidades_ia", 1]]);
  assert.deepEqual(consumed.projectSnapshot, snapshot);
  assert.notStrictEqual(consumed.projectSnapshot, snapshot);
  assert.equal(Object.isFrozen(consumed.projectSnapshot), true);
  assert.deepEqual(result.execution, {
    pipelineRunId: "run_pc05_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
  });
  assert.equal(result.artifacts[0].projectId, result.execution.projectId);
  assert.equal(result.artifacts[0].projectVersion, result.execution.projectVersion);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.artifacts[0]), true);
});

test("snapshot inexistente falha com código e campo estáveis antes do consumo", () => {
  let consumed = false;
  const service = new ProjectPipelineHandoffService(
    { get: () => null },
    { consume: () => { consumed = true; } },
  );

  assert.throws(() => service.start(request()), handoffError("PROJECT_SNAPSHOT_NOT_FOUND", "projectVersion"));
  assert.equal(consumed, false);
});

test("artefato divergente da referência da execução é rejeitado", () => {
  const snapshot = createProjectSnapshot(project());
  const service = new ProjectPipelineHandoffService(
    { get: () => snapshot },
    { consume: ({ execution }) => ({
      schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
      artifactId: "artifact_divergente",
      artifactType: "project_snapshot_handoff",
      pipelineRunId: execution.pipelineRunId,
      projectId: execution.projectId,
      projectVersion: 2,
      createdAt: execution.startedAt,
    }) },
  );

  assert.throws(
    () => service.start(request()),
    handoffError("ARTIFACT_PROJECT_REFERENCE_MISMATCH", "artifact.projectVersion"),
  );
});

test("nova versão e arquivamento não alteram handoff já criado nem retry determinístico", () => {
  withRepository((repository) => {
    repository.create(project());
    const service = new ProjectPipelineHandoffService(repository);
    const first = service.start(request());

    repository.createVersion(project({ version: 2, name: "Curiosidades IA Diário" }), { expectedVersion: 1 });
    repository.archive("project_curiosidades_ia", { expectedVersion: 2 });
    const retry = service.start(request());

    assert.deepEqual(retry, first);
    assert.equal(retry.execution.projectVersion, 1);
    assert.equal(repository.get("project_curiosidades_ia", 1).project.name, "Curiosidades IA");
  });
});

test("CLI produz saída determinística sem criar runs, comandos ou versões", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-pc05-"));
  const database = join(root, "catalog.sqlite");
  const input = join(root, "handoff.json");
  try {
    const repository = new ProjectRepository(database);
    repository.create(project());
    repository.close();
    writeFileSync(input, JSON.stringify(request()), "utf8");

    const first = runProjectCli(["handoff", "--database", database, "--input", input]);
    const second = runProjectCli(["handoff", "--database", database, "--input", input]);

    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.equal(first.stderr, "");
    const result = JSON.parse(first.stdout);
    assert.equal(result.execution.projectId, "project_curiosidades_ia");
    assert.equal(result.artifacts[0].projectVersion, 1);

    const reopened = new ProjectRepository(database);
    assert.equal(reopened.get("project_curiosidades_ia").project.version, 1);
    reopened.close();
    const raw = new DatabaseSync(database);
    assert.deepEqual({
      projects: raw.prepare("SELECT COUNT(*) AS total FROM projects").get().total,
      snapshots: raw.prepare("SELECT COUNT(*) AS total FROM project_snapshots").get().total,
      commands: raw.prepare("SELECT COUNT(*) AS total FROM project_commands").get().total,
    }, { projects: 1, snapshots: 1, commands: 0 });
    raw.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejeita segredo antes de abrir o banco e não vaza valor privado", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-pc05-invalid-"));
  const database = join(root, "catalog.sqlite");
  const input = join(root, "handoff.json");
  try {
    writeFileSync(input, JSON.stringify({ ...request(), token: "não-vazar" }), "utf8");

    const result = runProjectCli(["handoff", "--database", database, "--input", input]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("não-vazar"), false);
    assert.deepEqual(JSON.parse(result.stderr).error, {
      code: "SENSITIVE_FIELD_REJECTED",
      field: "token",
      message: "corrija o campo indicado e repita o comando",
    });
    assert.equal(existsSync(database), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI não cria catálogo ausente durante handoff válido", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-pc05-absent-"));
  const database = join(root, "catalog.sqlite");
  const input = join(root, "handoff.json");
  try {
    writeFileSync(input, JSON.stringify(request()), "utf8");

    const result = runProjectCli(["handoff", "--database", database, "--input", input]);

    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.stderr).error, {
      code: "DATABASE_NOT_FOUND",
      field: "database",
      message: "o catálogo de projetos ainda não existe",
    });
    assert.equal(existsSync(database), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function request(overrides = {}) {
  const value = {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: "run_pc05_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
    ...overrides,
  };
  for (const [key, item] of Object.entries(value)) if (item === undefined) delete value[key];
  return value;
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
      publishing: { contentsPerDay: 1, networks: ["instagram"], timezone: "America/Sao_Paulo", times: ["10:00"] },
    },
    ...overrides,
  };
}

function handoffError(code, field) {
  return (caught) => caught instanceof PipelineHandoffError && caught.code === code && caught.field === field;
}

function withRepository(operation) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-pc05-repository-"));
  const repository = new ProjectRepository(join(root, "catalog.sqlite"));
  try {
    operation(repository);
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
}
