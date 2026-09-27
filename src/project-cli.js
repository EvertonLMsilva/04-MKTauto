import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContractValidationError } from "./domain/contracts.js";
import { ProjectApplicationError, ProjectApplicationService } from "./project-application-service.js";
import {
  PipelineHandoffError,
  ProjectPipelineHandoffService,
  validatePipelineHandoffRequest,
} from "./project-pipeline-handoff.js";
import { ProjectRepository, ProjectRepositoryError } from "./project-repository.js";

const MUTATIONS = new Set(["create", "version", "archive"]);
const INPUT_COMMANDS = new Set([...MUTATIONS, "handoff"]);
const VERSIONED_READS = new Set(["get", "review", "select", "export"]);
const COMMANDS = new Set([...MUTATIONS, "latest", ...VERSIONED_READS, "handoff"]);
const COMMON_OPTIONS = new Set(["database"]);
const COMMAND_OPTIONS = Object.freeze({
  create: new Set(["input"]),
  version: new Set(["input"]),
  archive: new Set(["input"]),
  latest: new Set(["project-id"]),
  get: new Set(["project-id", "version"]),
  review: new Set(["project-id", "version"]),
  select: new Set(["project-id", "version"]),
  export: new Set(["project-id", "version", "output"]),
  handoff: new Set(["input"]),
});

export function runProjectCli(argv, dependencies = {}) {
  let repository;
  try {
    const invocation = parseInvocation(argv);
    const readText = dependencies.readText ?? ((path) => readFileSync(path, "utf8"));
    const writeText = dependencies.writeText ?? ((path, content) => writeFileSync(path, content, "utf8"));
    const commandPayload = INPUT_COMMANDS.has(invocation.command)
      ? readCommandInput(invocation.options.input, readText)
      : undefined;
    if (commandPayload) preflightInput(invocation.command, commandPayload);
    if (!MUTATIONS.has(invocation.command) && !existsSync(invocation.options.database)) {
      throw cliFailure("DATABASE_NOT_FOUND", "database", "o catálogo de projetos ainda não existe");
    }
    const repositoryFactory = dependencies.repositoryFactory ?? ((path) => new ProjectRepository(path));
    repository = repositoryFactory(invocation.options.database);

    const result = execute(invocation, commandPayload, repository);
    if (invocation.command === "export") {
      const content = serialize(result);
      try {
        writeText(invocation.options.output, content);
      } catch {
        throw cliFailure("EXPORT_FAILED", "output", "não foi possível gravar a exportação");
      }
      return success({ exported: true, projectId: result.project.id, version: result.project.version });
    }
    return success(result);
  } catch (caught) {
    return failureResult(caught);
  } finally {
    repository?.close();
  }
}

function preflightInput(command, payload) {
  if (command === "handoff") {
    validatePipelineHandoffRequest(payload);
    return;
  }
  const validated = Symbol("validated");
  const service = new ProjectApplicationService({ executeCommand: () => validated });
  const result = command === "create"
    ? service.createProject(payload)
    : command === "version"
      ? service.createProjectVersion(payload)
      : service.archiveProject(payload);
  if (result !== validated) throw cliFailure("INTERNAL_ERROR", "command", "não foi possível validar o comando");
}

function execute({ command, options }, commandPayload, repository) {
  if (command === "handoff") {
    return new ProjectPipelineHandoffService(repository).start(commandPayload);
  }
  if (MUTATIONS.has(command)) {
    const service = new ProjectApplicationService(repository);
    if (command === "create") return service.createProject(commandPayload);
    if (command === "version") return service.createProjectVersion(commandPayload);
    return service.archiveProject(commandPayload);
  }

  const projectId = requiredText(options["project-id"], "projectId");
  if (command === "latest") {
    const snapshot = repository.get(projectId);
    if (!snapshot) throw cliFailure("PROJECT_NOT_FOUND", "projectId", "projeto não encontrado");
    return snapshot;
  }

  const version = positiveInteger(options.version, "version");
  const snapshot = repository.get(projectId, version);
  if (!snapshot) throw cliFailure("PROJECT_SNAPSHOT_NOT_FOUND", "version", "snapshot não encontrado para o projeto e versão");
  return snapshot;
}

function parseInvocation(argv) {
  const [command, ...values] = argv;
  if (!COMMANDS.has(command)) {
    throw cliFailure("INVALID_COMMAND", "command", "use create, version, archive, latest, get, review, select, export ou handoff");
  }
  if (values.length % 2 !== 0) throw cliFailure("INVALID_OPTION", "options", "toda opção exige um valor");

  const options = {};
  const allowed = new Set([...COMMON_OPTIONS, ...COMMAND_OPTIONS[command]]);
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    if (typeof flag !== "string" || !flag.startsWith("--") || flag.length === 2) {
      throw cliFailure("INVALID_OPTION", "options", "use opções no formato --nome valor");
    }
    const name = flag.slice(2);
    if (!allowed.has(name)) throw cliFailure("UNKNOWN_OPTION", name, "opção não permitida para este comando");
    if (name in options) throw cliFailure("DUPLICATE_OPTION", name, "informe a opção apenas uma vez");
    options[name] = values[index + 1];
  }

  options.database = resolve(options.database ?? "data/mktauto.sqlite");
  if (INPUT_COMMANDS.has(command)) options.input = resolve(requiredText(options.input, "input"));
  if (command === "export") {
    options.output = resolve(requiredText(options.output, "output"));
    if (options.output === options.database) {
      throw cliFailure("OUTPUT_CONFLICT", "output", "a exportação não pode sobrescrever o banco de dados");
    }
  }
  return { command, options };
}

function readCommandInput(path, readText) {
  let content;
  try {
    content = readText(path);
  } catch {
    throw cliFailure("INPUT_NOT_FOUND", "input", "não foi possível ler o arquivo de comando");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw cliFailure("INVALID_JSON", "input", "o arquivo de comando deve conter JSON válido");
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw cliFailure("REQUIRED_OPTION", field, "opção obrigatória");
  }
  return value.trim();
}

function positiveInteger(value, field) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw cliFailure("INVALID_VERSION", field, "use um inteiro positivo");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw cliFailure("INVALID_VERSION", field, "use um inteiro positivo seguro");
  return parsed;
}

function success(value) {
  return Object.freeze({ exitCode: 0, stdout: serialize(value), stderr: "" });
}

function failureResult(caught) {
  const error = publicError(caught);
  return Object.freeze({ exitCode: 1, stdout: "", stderr: serialize({ error }) });
}

function publicError(caught) {
  if (caught instanceof ProjectApplicationError || caught instanceof ProjectRepositoryError || caught instanceof PipelineHandoffError) {
    return { code: caught.code, field: caught.field, message: actionableMessage(caught.code) };
  }
  if (caught instanceof ContractValidationError) {
    return { code: caught.code, field: caught.path, message: "corrija o campo indicado" };
  }
  if (caught instanceof ProjectCliError) {
    return { code: caught.code, field: caught.field, message: caught.publicMessage };
  }
  return { code: "INTERNAL_ERROR", field: "command", message: "a operação local falhou sem alterar o resultado solicitado" };
}

function actionableMessage(code) {
  if (code === "IDEMPOTENCY_KEY_REUSED") return "use uma chave nova ou repita exatamente o comando original";
  if (code === "EXPECTED_VERSION_MISMATCH") return "consulte a versão atual e repita com expectedVersion correspondente";
  if (code === "PROJECT_ARCHIVED") return "o projeto está arquivado e não aceita esta alteração";
  if (code === "PROJECT_ID_CONFLICT") return "escolha outro identificador de projeto";
  return "corrija o campo indicado e repita o comando";
}

function serialize(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

class ProjectCliError extends Error {
  constructor(code, field, publicMessage) {
    super(code);
    this.name = "ProjectCliError";
    this.code = code;
    this.field = field;
    this.publicMessage = publicMessage;
  }
}

function cliFailure(code, field, message) {
  return new ProjectCliError(code, field, message);
}

function runMain() {
  const result = runProjectCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) runMain();
