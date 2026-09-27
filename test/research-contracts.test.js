import assert from "node:assert/strict";
import test from "node:test";
import { createProjectSnapshot } from "../src/domain/project-contracts.js";
import {
  RESEARCH_INPUT_CONTRACT_VERSION,
  createResearchInput,
} from "../src/domain/research-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "../src/project-pipeline-handoff.js";
import { ResearchInputService } from "../src/research-input-service.js";

const STARTED_AT = "2026-09-27T15:00:00.000Z";

test("produz entrada de Research versionada, rastreável e profundamente imutável", () => {
  const snapshot = projectSnapshot();
  const input = createResearchInput(researchInput({ projectSnapshot: snapshot }));

  assert.deepEqual(input.execution, {
    pipelineRunId: "run_e02_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
  });
  assert.deepEqual(input.window, { logicalDate: "2026-09-27" });
  assert.deepEqual(input.projectSnapshot, snapshot);
  assert.notStrictEqual(input.projectSnapshot, snapshot);
  assert.equal(input.projectSnapshot.channel.publishing.timezone, "America/Sao_Paulo");
  assert.equal(input.projectSnapshot.references[0].usage, "strategic_reference_only");
  assert.equal(input.projectSnapshot.references[0].grantsUsageRights, false);
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.execution), true);
  assert.equal(Object.isFrozen(input.window), true);
  assert.equal(Object.isFrozen(input.projectSnapshot.references), true);
  assert.throws(() => input.projectSnapshot.project.name = "alterado", TypeError);
});

test("rejeita divergência entre execução e snapshot com código e campo estáveis", () => {
  assert.throws(
    () => createResearchInput(researchInput({
      execution: execution({ projectId: "project_divergente" }),
    })),
    contractError("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.id"),
  );
  assert.throws(
    () => createResearchInput(researchInput({
      execution: execution({ projectVersion: 2 }),
    })),
    contractError("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.version"),
  );
});

test("contrato rejeita versão, janela, campos desconhecidos e segredos", () => {
  assert.throws(
    () => createResearchInput(researchInput({ schemaVersion: "research-input/9.0.0" })),
    contractError("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion"),
  );
  assert.throws(
    () => createResearchInput(researchInput({ window: { logicalDate: "2026-02-30" } })),
    contractError("INVALID_LOGICAL_DATE", "window.logicalDate"),
  );
  assert.throws(
    () => createResearchInput({ ...researchInput(), latest: true }),
    contractError("UNKNOWN_FIELD", "researchInput.latest"),
  );
  assert.throws(
    () => createResearchInput({ ...researchInput(), accessToken: "não-vazar" }),
    contractError("SENSITIVE_FIELD_REJECTED", "accessToken"),
  );
});

test("serviço consulta uma vez somente a versão explícita e não expõe latest", () => {
  const reads = [];
  const repository = {
    get(projectId, projectVersion) {
      reads.push([projectId, projectVersion]);
      return projectSnapshot();
    },
    getProject() {
      assert.fail("não deve consultar projeto ou latest");
    },
  };
  const service = new ResearchInputService(repository);

  const result = service.create({
    handoff: handoffRequest(),
    window: { logicalDate: "2026-09-27" },
  });

  assert.deepEqual(reads, [["project_curiosidades_ia", 1]]);
  assert.equal(result.schemaVersion, RESEARCH_INPUT_CONTRACT_VERSION);
  assert.equal(result.execution.pipelineRunId, "run_e02_001");
  assert.equal(result.projectSnapshot.project.version, 1);
});

test("entrada inválida falha antes de consultar o repositório", () => {
  let reads = 0;
  const service = new ResearchInputService({
    get() {
      reads += 1;
      return projectSnapshot();
    },
  });

  assert.throws(
    () => service.create({
      handoff: { ...handoffRequest(), latest: true },
      window: { logicalDate: "2026-09-27" },
    }),
    (error) => error.code === "UNKNOWN_FIELD" && error.field === "request.latest",
  );
  assert.throws(
    () => service.create({
      handoff: handoffRequest(),
      window: { logicalDate: "2026-02-30" },
    }),
    contractError("INVALID_LOGICAL_DATE", "window.logicalDate"),
  );
  assert.equal(reads, 0);
});

test("retry idêntico é determinístico e nova versão não altera a entrada criada", () => {
  let selected = projectSnapshot();
  const service = new ResearchInputService({ get: () => selected });
  const request = {
    handoff: handoffRequest(),
    window: { logicalDate: "2026-09-27" },
  };

  const first = service.create(request);
  const retry = service.create(request);
  selected = projectSnapshot({ version: 2, name: "Curiosidades IA Diário" });

  assert.deepEqual(retry, first);
  assert.equal(JSON.stringify(retry), JSON.stringify(first));
  assert.equal(first.projectSnapshot.project.name, "Curiosidades IA");
  assert.throws(
    () => service.create(request),
    (error) => error.code === "SNAPSHOT_VERSION_MISMATCH" && error.field === "projectVersion",
  );
});

function researchInput(overrides = {}) {
  return {
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution: execution(),
    window: { logicalDate: "2026-09-27" },
    projectSnapshot: projectSnapshot(),
    ...overrides,
  };
}

function execution(overrides = {}) {
  return {
    pipelineRunId: "run_e02_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    startedAt: STARTED_AT,
    ...overrides,
  };
}

function handoffRequest(overrides = {}) {
  return {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    ...execution(),
    ...overrides,
  };
}

function projectSnapshot(overrides = {}) {
  return createProjectSnapshot({
    id: "project_curiosidades_ia",
    name: "Curiosidades IA",
    version: 1,
    niche: "inteligência artificial",
    subniches: ["ferramentas", "produtividade"],
    audience: {
      profile: "Pessoas interessadas em tecnologia",
      language: "pt-BR",
    },
    references: [{
      platform: "instagram",
      handle: "@perfilA",
      purpose: "strategic_reference",
    }],
    channel: {
      publishing: {
        contentsPerDay: 1,
        networks: ["instagram", "threads"],
        timezone: "America/Sao_Paulo",
        times: ["10:00"],
      },
    },
    ...overrides,
  });
}

function contractError(code, path) {
  return (error) => error.code === code && error.path === path;
}
