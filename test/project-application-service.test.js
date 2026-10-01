import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ProjectApplicationError,
  ProjectApplicationService,
} from "../src/project-application-service.js";
import { ProjectRepository } from "../src/project-repository.js";

const CREATED_AT = "2026-09-27T12:00:00.000Z";
const UPDATED_AT = "2026-09-27T13:00:00.000Z";
const ARCHIVED_AT = "2026-09-27T14:00:00.000Z";

test("criação registra comando e produz ProjectSnapshot versão 1", () => {
  withApplication(({ service, repository, path }) => {
    const command = createCommand();
    const created = service.createProject(command);

    assert.equal(created.project.version, 1);
    assert.deepEqual(created, repository.get("project_curiosidades_ia", 1));
    assert.equal(Object.isFrozen(created), true);

    const row = commandRow(path, command.idempotencyKey);
    assert.equal(row.command_type, "CREATE_PROJECT");
    assert.equal(row.actor, "operator:everton");
    assert.equal(row.occurred_at, CREATED_AT);
    assert.match(row.payload_hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(row.result_json), created);
  });
});

test("retry idêntico retorna exatamente o resultado persistido sem repetir efeitos", () => {
  withApplication(({ service, path }) => {
    const command = createCommand();
    const first = service.createProject(command);
    const retry = service.createProject(command);

    assert.deepEqual(retry, first);
    assert.equal(Object.isFrozen(retry), true);
    assert.deepEqual(counts(path), { projects: 1, snapshots: 1, commands: 1 });
  });
});

test("reutilização da chave com conteúdo ou tipo divergente falha de forma estável", () => {
  withApplication(({ service }) => {
    service.createProject(createCommand());

    assert.throws(
      () => service.createProject(createCommand({ project: project({ name: "Outro nome" }) })),
      applicationError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey"),
    );
    assert.throws(
      () => service.archiveProject({
        idempotencyKey: "project:create:1",
        actor: "operator:everton",
        occurredAt: CREATED_AT,
        projectId: "project_curiosidades_ia",
        expectedVersion: 1,
      }),
      applicationError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey"),
    );
    assert.throws(
      () => service.createProject(createCommand({ actor: "operator:outro" })),
      applicationError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey"),
    );
    assert.throws(
      () => service.createProject(createCommand({ occurredAt: UPDATED_AT })),
      applicationError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey"),
    );
  });
});

test("nova versão exige versão esperada e mantém snapshots históricos estáveis", () => {
  withApplication(({ service, repository, path }) => {
    service.createProject(createCommand());
    const selected = repository.get("project_curiosidades_ia", 1);
    const versioned = service.createProjectVersion({
      idempotencyKey: "project:version:2",
      actor: "operator:everton",
      occurredAt: UPDATED_AT,
      expectedVersion: 1,
      project: project({ version: 2, name: "Curiosidades IA Diário" }),
    });

    assert.equal(versioned.project.version, 2);
    assert.equal(repository.get("project_curiosidades_ia").project.version, 2);
    assert.deepEqual(repository.get("project_curiosidades_ia", 1), selected);
    assert.equal(repository.get("project_curiosidades_ia", 1).project.name, "Curiosidades IA");
    assert.deepEqual(counts(path), { projects: 1, snapshots: 2, commands: 2 });

    assert.throws(
      () => service.createProjectVersion({
        idempotencyKey: "project:version:stale",
        actor: "operator:everton",
        occurredAt: ARCHIVED_AT,
        expectedVersion: 1,
        project: project({ version: 2, name: "Edição concorrente" }),
      }),
      applicationError("EXPECTED_VERSION_MISMATCH", "expectedVersion"),
    );
    assert.equal(commandRow(path, "project:version:stale"), undefined);
  });
});

test("arquivamento é lógico, idempotente e preserva todo o histórico", () => {
  withApplication(({ service, repository, path }) => {
    service.createProject(createCommand());
    const command = {
      idempotencyKey: "project:archive:1",
      actor: "operator:everton",
      occurredAt: ARCHIVED_AT,
      projectId: "project_curiosidades_ia",
      expectedVersion: 1,
    };
    const archived = service.archiveProject(command);
    const retry = service.archiveProject(command);

    assert.deepEqual(retry, archived);
    assert.equal(archived.archivedAt, ARCHIVED_AT);
    assert.equal(archived.snapshot.project.version, 1);
    assert.deepEqual(repository.get("project_curiosidades_ia", 1), archived.snapshot);
    assert.deepEqual(counts(path), { projects: 1, snapshots: 1, commands: 2 });
  });
});

test("valida chave, ator, instante e payload antes de persistir", () => {
  withApplication(({ service, path }) => {
    const cases = [
      [createCommand({ idempotencyKey: "" }), "INVALID_IDEMPOTENCY_KEY", "idempotencyKey"],
      [createCommand({ actor: "" }), "INVALID_ACTOR", "actor"],
      [createCommand({ occurredAt: "ontem" }), "INVALID_TIMESTAMP", "occurredAt"],
      [createCommand({ occurredAt: "1" }), "INVALID_TIMESTAMP", "occurredAt"],
      [createCommand({ project: project({ accessToken: "não persistir" }) }), "SENSITIVE_FIELD_REJECTED", "project.accessToken"],
    ];
    for (const [command, code, field] of cases) {
      assert.throws(() => service.createProject(command), applicationError(code, field));
    }
    assert.deepEqual(counts(path), { projects: 0, snapshots: 0, commands: 0 });
  });
});

test("falha ao registrar comando reverte projeto e snapshot e permite retry limpo", () => {
  withApplication(({ service, path }) => {
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_project_command BEFORE INSERT ON project_commands
      BEGIN SELECT RAISE(ABORT, 'FORCED_COMMAND_FAILURE'); END;`);
    raw.close();

    const command = createCommand();
    assert.throws(() => service.createProject(command), /FORCED_COMMAND_FAILURE/);
    assert.deepEqual(counts(path), { projects: 0, snapshots: 0, commands: 0 });

    const repair = new DatabaseSync(path);
    repair.exec("DROP TRIGGER reject_project_command");
    repair.close();
    assert.equal(service.createProject(command).project.version, 1);
    assert.deepEqual(counts(path), { projects: 1, snapshots: 1, commands: 1 });
  });
});

test("falha no registro não deixa versão ou arquivamento parcial", () => {
  withApplication(({ service, repository, path }) => {
    service.createProject(createCommand());
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TRIGGER reject_project_mutation_command BEFORE INSERT ON project_commands
      WHEN NEW.command_type IN ('CREATE_PROJECT_VERSION', 'ARCHIVE_PROJECT')
      BEGIN SELECT RAISE(ABORT, 'FORCED_MUTATION_COMMAND_FAILURE'); END;`);
    raw.close();

    const versionCommand = {
      idempotencyKey: "project:version:2",
      actor: "operator:everton",
      occurredAt: UPDATED_AT,
      expectedVersion: 1,
      project: project({ version: 2 }),
    };
    assert.throws(() => service.createProjectVersion(versionCommand), /FORCED_MUTATION_COMMAND_FAILURE/);
    assert.equal(repository.getProject("project_curiosidades_ia").latestVersion, 1);
    assert.equal(repository.get("project_curiosidades_ia", 2), null);

    const repairVersion = new DatabaseSync(path);
    repairVersion.exec("DROP TRIGGER reject_project_mutation_command");
    repairVersion.close();
    service.createProjectVersion(versionCommand);

    const blockArchive = new DatabaseSync(path);
    blockArchive.exec(`CREATE TRIGGER reject_project_archive_command BEFORE INSERT ON project_commands
      WHEN NEW.command_type = 'ARCHIVE_PROJECT'
      BEGIN SELECT RAISE(ABORT, 'FORCED_ARCHIVE_COMMAND_FAILURE'); END;`);
    blockArchive.close();
    const archiveCommand = {
      idempotencyKey: "project:archive:2",
      actor: "operator:everton",
      occurredAt: ARCHIVED_AT,
      projectId: "project_curiosidades_ia",
      expectedVersion: 2,
    };
    assert.throws(() => service.archiveProject(archiveCommand), /FORCED_ARCHIVE_COMMAND_FAILURE/);
    assert.equal(repository.getProject("project_curiosidades_ia").archivedAt, null);
    assert.equal(commandRow(path, archiveCommand.idempotencyKey), undefined);

    const repairArchive = new DatabaseSync(path);
    repairArchive.exec("DROP TRIGGER reject_project_archive_command");
    repairArchive.close();
    assert.equal(service.archiveProject(archiveCommand).archivedAt, ARCHIVED_AT);
    assert.deepEqual(counts(path), { projects: 1, snapshots: 2, commands: 3 });
  });
});

test("migração de comandos é aditiva, reproduzível e registros são imutáveis", () => {
  withDatabase((path) => {
    const repository = new ProjectRepository(path);
    const service = new ProjectApplicationService(repository);
    service.createProject(createCommand());
    repository.close();

    const reopened = new ProjectRepository(path);
    const retry = new ProjectApplicationService(reopened).createProject(createCommand());
    assert.equal(retry.project.version, 1);
    assert.equal(Object.isFrozen(retry), true);
    reopened.close();
    const raw = new DatabaseSync(path);
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 28);
    assert.equal(raw.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total, 28);
    assert.throws(
      () => raw.prepare("UPDATE project_commands SET actor = 'outro' WHERE idempotency_key = ?")
        .run("project:create:1"),
      /IMMUTABLE_PROJECT_COMMAND/,
    );
    assert.throws(
      () => raw.prepare("DELETE FROM project_commands WHERE idempotency_key = ?").run("project:create:1"),
      /IMMUTABLE_PROJECT_COMMAND/,
    );
    raw.close();
  });
});

function createCommand(overrides = {}) {
  return {
    idempotencyKey: "project:create:1",
    actor: "operator:everton",
    occurredAt: CREATED_AT,
    project: project(),
    ...overrides,
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

function commandRow(path, key) {
  const raw = new DatabaseSync(path);
  try {
    return raw.prepare("SELECT * FROM project_commands WHERE idempotency_key = ?").get(key);
  } finally {
    raw.close();
  }
}

function counts(path) {
  const raw = new DatabaseSync(path);
  try {
    return {
      projects: raw.prepare("SELECT COUNT(*) AS total FROM projects").get().total,
      snapshots: raw.prepare("SELECT COUNT(*) AS total FROM project_snapshots").get().total,
      commands: raw.prepare("SELECT COUNT(*) AS total FROM project_commands").get().total,
    };
  } finally {
    raw.close();
  }
}

function applicationError(code, field) {
  return (caught) => caught instanceof ProjectApplicationError
    && caught.code === code
    && caught.field === field;
}

function withApplication(callback) {
  withDatabase((path) => {
    const repository = new ProjectRepository(path);
    try {
      callback({ service: new ProjectApplicationService(repository), repository, path });
    } finally {
      repository.close();
    }
  });
}

function withDatabase(callback) {
  const directory = mkdtempSync(join(tmpdir(), "mktauto-project-application-"));
  try {
    callback(join(directory, "catalog.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
