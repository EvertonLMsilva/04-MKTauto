import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runProjectCli } from "../src/project-cli.js";

const CREATED_AT = "2026-09-27T12:00:00.000Z";
const UPDATED_AT = "2026-09-27T13:00:00.000Z";
const ARCHIVED_AT = "2026-09-27T14:00:00.000Z";

test("CLI cria projeto normalizado e retry idêntico não repete efeitos", () => {
  withWorkspace(({ database, input }) => {
    writeJson(input, createCommand());

    const first = runProjectCli(["create", "--database", database, "--input", input]);
    const retry = runProjectCli(["create", "--database", database, "--input", input]);

    assert.equal(first.exitCode, 0);
    assert.equal(first.stderr, "");
    assert.equal(retry.stdout, first.stdout);
    assert.equal(JSON.parse(first.stdout).project.name, "Curiosidades IA");
    assert.equal(JSON.parse(first.stdout).project.version, 1);
    assert.deepEqual(counts(database), { projects: 1, snapshots: 1, commands: 1 });
  });
});

test("CLI versiona e arquiva com versão esperada sem remover histórico", () => {
  withWorkspace(({ database, input }) => {
    writeJson(input, createCommand());
    assert.equal(runProjectCli(["create", "--database", database, "--input", input]).exitCode, 0);

    writeJson(input, versionCommand());
    const versioned = runProjectCli(["version", "--database", database, "--input", input]);
    assert.equal(JSON.parse(versioned.stdout).project.version, 2);

    const latest = success(["latest", "--database", database, "--project-id", "project_curiosidades_ia"]);
    const historical = success(["get", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1"]);
    assert.equal(latest.project.name, "Curiosidades IA Diário");
    assert.equal(historical.project.name, "Curiosidades IA");

    writeJson(input, archiveCommand());
    const archived = success(["archive", "--database", database, "--input", input]);
    assert.equal(archived.archivedAt, ARCHIVED_AT);
    assert.equal(success(["get", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1"]).project.version, 1);
    assert.equal(success(["get", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "2"]).project.version, 2);
    assert.deepEqual(counts(database), { projects: 1, snapshots: 2, commands: 3 });
  });
});

test("revisão e seleção explícita não persistem efeitos nem mudam após edição", () => {
  withWorkspace(({ database, input }) => {
    writeJson(input, createCommand());
    runProjectCli(["create", "--database", database, "--input", input]);

    const review = runProjectCli(["review", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1"]);
    const selected = runProjectCli(["select", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1"]);
    assert.equal(review.stdout, selected.stdout);
    assert.deepEqual(counts(database), { projects: 1, snapshots: 1, commands: 1 });

    writeJson(input, versionCommand());
    runProjectCli(["version", "--database", database, "--input", input]);
    assert.equal(
      runProjectCli(["select", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1"]).stdout,
      selected.stdout,
    );
    assert.deepEqual(counts(database), { projects: 1, snapshots: 2, commands: 2 });
  });
});

test("exportação é determinística e contém somente ProjectSnapshot sanitizado", () => {
  withWorkspace(({ root, database, input }) => {
    const output = join(root, "project.json");
    writeJson(input, createCommand());
    runProjectCli(["create", "--database", database, "--input", input]);

    const first = runProjectCli([
      "export", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1", "--output", output,
    ]);
    const exported = readFileSync(output, "utf8");
    const second = runProjectCli([
      "export", "--database", database, "--project-id", "project_curiosidades_ia", "--version", "1", "--output", output,
    ]);

    assert.equal(first.exitCode, 0);
    assert.equal(second.stdout, first.stdout);
    assert.equal(readFileSync(output, "utf8"), exported);
    assert.deepEqual(Object.keys(JSON.parse(exported)).sort(), ["channel", "project", "references", "schemaVersion"]);
    for (const forbidden of ["idempotencyKey", "payload_hash", "accessToken", database, "stack"]) {
      assert.equal(exported.includes(forbidden), false);
    }
  });
});

test("erros de serviço preservam código e campo sem detalhes internos", () => {
  withWorkspace(({ database, input }) => {
    writeJson(input, createCommand());
    runProjectCli(["create", "--database", database, "--input", input]);

    writeJson(input, versionCommand({ expectedVersion: 9 }));
    const conflict = runProjectCli(["version", "--database", database, "--input", input]);
    assertError(conflict, "EXPECTED_VERSION_MISMATCH", "expectedVersion");

    writeJson(input, createCommand({ project: project({ name: "Divergente" }) }));
    const divergent = runProjectCli(["create", "--database", database, "--input", input]);
    assertError(divergent, "IDEMPOTENCY_KEY_REUSED", "idempotencyKey");
    assert.deepEqual(counts(database), { projects: 1, snapshots: 1, commands: 1 });
  });
});

test("entrada inválida, campos desconhecidos e segredos falham antes do comando", () => {
  withWorkspace(({ database, input }) => {
    writeFileSync(input, "{", "utf8");
    assertError(runProjectCli(["create", "--database", database, "--input", input]), "INVALID_JSON", "input");

    writeJson(input, createCommand({ project: project({ accessToken: "não-vazar" }) }));
    const sensitive = runProjectCli(["create", "--database", database, "--input", input]);
    assertError(sensitive, "SENSITIVE_FIELD_REJECTED", "project.accessToken");
    assert.equal(sensitive.stderr.includes("não-vazar"), false);

    const option = runProjectCli(["latest", "--database", database, "--project-id", "abc", "--token", "não-vazar"]);
    assertError(option, "UNKNOWN_OPTION", "token");
    assert.equal(option.stderr.includes("não-vazar"), false);
    const outputConflict = runProjectCli([
      "export", "--database", database, "--project-id", "abc", "--version", "1", "--output", database,
    ]);
    assertError(outputConflict, "OUTPUT_CONFLICT", "output");
    assert.equal(existsSync(database), false);
  });
});

test("consultas ausentes retornam erro estável e não criam efeitos", () => {
  withWorkspace(({ database, input }) => {
    const absentDatabase = runProjectCli(["latest", "--database", database, "--project-id", "project_ausente"]);
    assertError(absentDatabase, "DATABASE_NOT_FOUND", "database");
    assert.equal(existsSync(database), false);

    writeJson(input, createCommand());
    runProjectCli(["create", "--database", database, "--input", input]);
    const missing = runProjectCli(["select", "--database", database, "--project-id", "project_ausente", "--version", "1"]);
    assertError(missing, "PROJECT_SNAPSHOT_NOT_FOUND", "version");
    assert.deepEqual(counts(database), { projects: 1, snapshots: 1, commands: 1 });
  });
});

test("processo CLI usa stdout, stderr e códigos de saída adequados para automação", () => {
  withWorkspace(({ database, input }) => {
    writeJson(input, createCommand());
    const created = spawnSync(process.execPath, [
      resolve("src/project-cli.js"), "create", "--database", database, "--input", input,
    ], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stderr, "");
    assert.equal(JSON.parse(created.stdout).project.version, 1);

    const invalid = spawnSync(process.execPath, [resolve("src/project-cli.js"), "unknown"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(JSON.parse(invalid.stderr).error.code, "INVALID_COMMAND");
  });
});

function success(args) {
  const result = runProjectCli(args);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertError(result, code, field) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr).error;
  assert.deepEqual({ code: error.code, field: error.field }, { code, field });
  assert.equal(typeof error.message, "string");
  assert.equal("stack" in error, false);
  assert.equal(result.stderr.includes("SQLITE"), false);
  assert.equal(result.stderr.includes(" at "), false);
}

function createCommand(overrides = {}) {
  return {
    idempotencyKey: "project:create:1",
    actor: "operator:everton",
    occurredAt: CREATED_AT,
    project: project(),
    ...overrides,
  };
}

function versionCommand(overrides = {}) {
  return {
    idempotencyKey: "project:version:2",
    actor: "operator:everton",
    occurredAt: UPDATED_AT,
    expectedVersion: 1,
    project: project({ version: 2, name: "Curiosidades IA Diário" }),
    ...overrides,
  };
}

function archiveCommand() {
  return {
    idempotencyKey: "project:archive:2",
    actor: "operator:everton",
    occurredAt: ARCHIVED_AT,
    projectId: "project_curiosidades_ia",
    expectedVersion: 2,
  };
}

function project(overrides = {}) {
  return {
    id: "project_curiosidades_ia",
    name: " Curiosidades  IA ",
    version: 1,
    niche: "Inteligência Artificial",
    subniches: ["Ferramentas"],
    audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-br" },
    references: [{ platform: "instagram", handle: "@perfil", purpose: "strategic_reference" }],
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

function counts(path) {
  const database = new DatabaseSync(path);
  try {
    return {
      projects: database.prepare("SELECT COUNT(*) AS total FROM projects").get().total,
      snapshots: database.prepare("SELECT COUNT(*) AS total FROM project_snapshots").get().total,
      commands: database.prepare("SELECT COUNT(*) AS total FROM project_commands").get().total,
    };
  } finally {
    database.close();
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function withWorkspace(callback) {
  const root = mkdtempSync(join(tmpdir(), "mktauto-project-cli-"));
  try {
    callback({ root, database: join(root, "projects.sqlite"), input: join(root, "input.json") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
