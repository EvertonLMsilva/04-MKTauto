import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProjectSnapshot } from "../src/domain/project-contracts.js";
import { ProjectRepository, ProjectRepositoryError } from "../src/project-repository.js";

const CREATED_AT = "2026-09-27T12:00:00.000Z";
const UPDATED_AT = "2026-09-27T13:00:00.000Z";

test("migra banco vazio e reabre sem alterar projetos persistidos", () => {
  withDatabase((path) => {
    const first = new ProjectRepository(path);
    first.create(project(), { createdAt: CREATED_AT });
    first.close();

    const second = new ProjectRepository(path);
    assert.deepEqual(second.get("project_curiosidades_ia"), createProjectSnapshot(project()));
    second.close();

    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 26);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 26);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM project_snapshots").get().total, 1);
    raw.close();
  });
});

test("falha de migração reverte schema e versão integralmente", () => {
  withDatabase((path) => {
    const setup = new DatabaseSync(path);
    setup.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '001_trend_catalog', '${CREATED_AT}');
      INSERT INTO schema_migrations VALUES (2, '002_daily_catalog', '${CREATED_AT}');
      CREATE TABLE project_snapshots (blocker TEXT);
      PRAGMA user_version = 2;
    `);
    setup.close();

    assert.throws(
      () => new ProjectRepository(path),
      error("PROJECT_MIGRATION_FAILED", "schemaVersion"),
    );

    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get().total, 0);
    raw.close();
  });
});

test("cria e recupera snapshot normalizado, versionado e profundamente imutável", () => {
  withRepository((repository) => {
    const created = repository.create(project(), { createdAt: CREATED_AT });
    const recovered = repository.get("project_curiosidades_ia", 1);

    assert.deepEqual(recovered, created);
    assert.equal(recovered.project.name, "Curiosidades IA");
    assert.equal(Object.isFrozen(recovered), true);
    assert.equal(Object.isFrozen(recovered.channel.publishing), true);
    assert.throws(() => recovered.project.name = "alterado", TypeError);
  });
});

test("nova versão exige versão esperada e preserva integralmente o histórico", () => {
  withRepository((repository) => {
    repository.create(project(), { createdAt: CREATED_AT });
    const versionTwo = repository.createVersion(project({ version: 2, name: "Curiosidades IA Diário" }), {
      expectedVersion: 1,
      createdAt: UPDATED_AT,
    });

    assert.equal(versionTwo.project.version, 2);
    assert.equal(repository.get("project_curiosidades_ia").project.version, 2);
    assert.equal(repository.get("project_curiosidades_ia", 1).project.name, "Curiosidades IA");
    assert.equal(repository.getProject("project_curiosidades_ia").latestVersion, 2);
  });
});

test("lista projetos e versões persistidas para seleção explícita do operador", () => {
  withRepository((repository) => {
    repository.create(project(), { createdAt: CREATED_AT });
    repository.createVersion(project({ version: 2, name: "Curiosidades IA Diário" }), { expectedVersion: 1, createdAt: UPDATED_AT });
    assert.deepEqual(repository.listProjects().map(({ id, latestVersion }) => [id, latestVersion]), [["project_curiosidades_ia", 2]]);
    assert.deepEqual(repository.listProjectVersions("project_curiosidades_ia").map(({ project }) => [project.version, project.name]), [[1, "Curiosidades IA"], [2, "Curiosidades IA Diário"]]);
  });
});

test("impede colisões de identificação e versão com códigos e campos estáveis", () => {
  withRepository((repository) => {
    assert.throws(
      () => repository.create(project({ version: 2 }), { createdAt: CREATED_AT }),
      error("PROJECT_VERSION_CONFLICT", "project.version"),
    );
    repository.create(project(), { createdAt: CREATED_AT });

    assert.throws(
      () => repository.create(project(), { createdAt: CREATED_AT }),
      error("PROJECT_ID_CONFLICT", "project.id"),
    );
    assert.throws(
      () => repository.createVersion(project({ version: 1 }), { expectedVersion: 1, createdAt: UPDATED_AT }),
      error("PROJECT_VERSION_CONFLICT", "project.version"),
    );
  });
});

test("impede update perdido quando a versão esperada diverge", () => {
  withDatabase((path) => {
    const first = new ProjectRepository(path);
    const second = new ProjectRepository(path);
    try {
      first.create(project(), { createdAt: CREATED_AT });
      first.createVersion(project({ version: 2 }), { expectedVersion: 1, createdAt: UPDATED_AT });
      assert.throws(
        () => second.createVersion(project({ version: 2, name: "Edição concorrente" }), {
          expectedVersion: 1,
          createdAt: UPDATED_AT,
        }),
        error("EXPECTED_VERSION_MISMATCH", "expectedVersion"),
      );
      assert.equal(second.get("project_curiosidades_ia").project.name, "Curiosidades IA");
    } finally {
      first.close();
      second.close();
    }
  });
});

test("arquiva logicamente sem remover o histórico e bloqueia novas versões", () => {
  withRepository((repository) => {
    repository.create(project(), { createdAt: CREATED_AT });
    repository.createVersion(project({ version: 2 }), { expectedVersion: 1, createdAt: UPDATED_AT });

    const archived = repository.archive("project_curiosidades_ia", {
      expectedVersion: 2,
      archivedAt: "2026-09-27T14:00:00.000Z",
    });

    assert.equal(archived.archivedAt, "2026-09-27T14:00:00.000Z");
    assert.equal(repository.get("project_curiosidades_ia", 1).project.version, 1);
    assert.equal(repository.get("project_curiosidades_ia", 2).project.version, 2);
    assert.throws(
      () => repository.createVersion(project({ version: 3 }), { expectedVersion: 2 }),
      error("PROJECT_ARCHIVED", "project.id"),
    );
  });
});

test("triggers do banco impedem alteração ou remoção retroativa de snapshots", () => {
  withDatabase((path) => {
    const repository = new ProjectRepository(path);
    repository.create(project(), { createdAt: CREATED_AT });
    repository.close();

    const raw = new DatabaseSync(path);
    assert.throws(
      () => raw.prepare("UPDATE project_snapshots SET snapshot_json = '{}' WHERE project_id = ? AND version = 1")
        .run("project_curiosidades_ia"),
      /IMMUTABLE_PROJECT_SNAPSHOT/,
    );
    assert.throws(
      () => raw.prepare("DELETE FROM project_snapshots WHERE project_id = ? AND version = 1")
        .run("project_curiosidades_ia"),
      /IMMUTABLE_PROJECT_SNAPSHOT/,
    );
    raw.close();
  });
});

test("falha intermediária reverte integralmente a criação", () => {
  withDatabase((path) => {
    const migrated = new ProjectRepository(path);
    migrated.close();
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_project_snapshot BEFORE INSERT ON project_snapshots
      BEGIN SELECT RAISE(ABORT, 'FORCED_SNAPSHOT_FAILURE'); END;`);
    raw.close();

    const repository = new ProjectRepository(path);
    assert.throws(() => repository.create(project(), { createdAt: CREATED_AT }), /FORCED_SNAPSHOT_FAILURE/);
    assert.equal(repository.getProject("project_curiosidades_ia"), null);
    repository.close();
  });
});

test("valida pelo contrato antes de persistir e rejeita segredos", () => {
  withRepository((repository) => {
    assert.throws(
      () => repository.create(project({ accessToken: "não persistir" }), { createdAt: CREATED_AT }),
      (caught) => caught.code === "SENSITIVE_FIELD_REJECTED" && caught.path === "accessToken",
    );
    assert.equal(repository.getProject("project_curiosidades_ia"), null);
  });
});

test("valida novamente após recuperar e não devolve payload adulterado", () => {
  withDatabase((path) => {
    const repository = new ProjectRepository(path);
    repository.create(project(), { createdAt: CREATED_AT });
    repository.close();

    const raw = new DatabaseSync(path);
    raw.exec("DROP TRIGGER project_snapshots_no_update");
    const snapshot = JSON.parse(raw.prepare(
      "SELECT snapshot_json FROM project_snapshots WHERE project_id = ? AND version = 1",
    ).get("project_curiosidades_ia").snapshot_json);
    snapshot.channel.accessToken = "adulterado";
    raw.prepare("UPDATE project_snapshots SET snapshot_json = ? WHERE project_id = ? AND version = 1")
      .run(JSON.stringify(snapshot), "project_curiosidades_ia");
    raw.close();

    const reopened = new ProjectRepository(path);
    assert.throws(
      () => reopened.get("project_curiosidades_ia", 1),
      (caught) => caught.code === "SENSITIVE_FIELD_REJECTED" && caught.path === "channel.accessToken",
    );
    reopened.close();
  });
});

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

function error(code, field) {
  return (caught) => caught instanceof ProjectRepositoryError && caught.code === code && caught.field === field;
}

function withRepository(callback) {
  withDatabase((path) => {
    const repository = new ProjectRepository(path);
    try {
      callback(repository);
    } finally {
      repository.close();
    }
  });
}

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-projects-"));
  try {
    callback(join(directory, "catalog.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
