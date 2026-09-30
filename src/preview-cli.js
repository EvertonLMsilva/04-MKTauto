import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { executePreviewSelection, PreviewExecutionError } from "./preview-execution.js";
import { createPreviewRuntime } from "./preview-runtime.js";

const OPTIONS = new Set(["project-id", "project-version", "selection-id", "database"]);

export async function runPreviewCli(argv, dependencies = {}) {
  let runtime;
  try {
    const invocation = parseInvocation(argv, dependencies.env ?? process.env);
    if (!existsSync(invocation.database)) throw cliFailure("DATABASE_NOT_FOUND", "database", "o catálogo operacional não existe");
    const runtimeFactory = dependencies.runtimeFactory ?? createPreviewRuntime;
    runtime = runtimeFactory({ database: invocation.database, env: dependencies.env ?? process.env });
    const operation = await executePreviewSelection(invocation, {
      runtime, now: dependencies.now, onProgress: dependencies.onProgress,
    });
    const localPath = await runtime.referenceResolver.resolveVideo(operation.videoRender.logicalReference);
    return success({
      status: operation.status,
      executionMode: operation.executionMode,
      pipelineRunId: operation.pipelineRunId,
      videoRenderId: operation.videoRender.id,
      sha256: operation.videoRender.sha256,
      logicalReference: operation.videoRender.logicalReference,
      localPath,
      qualityControl: {
        reportId: operation.qualityControl.qualityControlReportId,
        result: operation.qualityControl.result,
        approvalBlocked: operation.qualityControl.approvalBlocked,
        findings: operation.qualityControl.findings.map(({ code, status }) => ({ code, status })),
      },
    });
  } catch (caught) {
    return failureResult(caught);
  } finally {
    try { runtime?.close(); } catch { /* fechamento não pode expor detalhes internos */ }
  }
}

function parseInvocation(argv, env) {
  if (argv.length % 2 !== 0) throw cliFailure("INVALID_OPTION", "options", "toda opção exige um valor");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (typeof flag !== "string" || !flag.startsWith("--") || flag.length === 2) throw cliFailure("INVALID_OPTION", "options", "use opções no formato --nome valor");
    const name = flag.slice(2);
    if (!OPTIONS.has(name)) throw cliFailure("UNKNOWN_OPTION", name, "opção não permitida");
    if (name in values) throw cliFailure("DUPLICATE_OPTION", name, "informe a opção apenas uma vez");
    values[name] = argv[index + 1];
  }
  return Object.freeze({
    projectId: identifier(values["project-id"], "projectId", 80),
    projectVersion: positiveInteger(values["project-version"], "projectVersion"),
    selectionId: identifier(values["selection-id"], "selectionId", 200),
    database: resolve(values.database ?? env.PREVIEW_DATABASE ?? "data/mktauto.sqlite"),
  });
}

function identifier(value, field, max) {
  if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw cliFailure("REQUIRED_OPTION", field, "informe um identificador válido");
  return value;
}

function positiveInteger(value, field) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw cliFailure("INVALID_VERSION", field, "use um inteiro positivo");
  return Number(value);
}

function success(value) {
  return Object.freeze({ exitCode: 0, stdout: serialize(value), stderr: "" });
}

function failureResult(caught) {
  const error = publicError(caught);
  return Object.freeze({ exitCode: 1, stdout: "", stderr: serialize({ error }) });
}

function publicError(caught) {
  if (caught instanceof PreviewCliError || caught instanceof PreviewExecutionError) return { code: caught.code, field: caught.field, message: caught.publicMessage };
  const code = safeToken(caught?.code, "INTERNAL_ERROR");
  const field = safeField(caught?.field);
  return { code, field, message: code === "INTERNAL_ERROR" ? "a operação local não foi concluída" : "corrija a configuração ou o campo indicado e repita o comando" };
}

function safeToken(value, fallback) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : fallback;
}

function safeField(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,119}$/.test(value) ? value : "preview";
}

function serialize(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

class PreviewCliError extends Error {
  constructor(code, field, publicMessage) { super(code); this.name = "PreviewCliError"; this.code = code; this.field = field; this.publicMessage = publicMessage; }
}

function cliFailure(code, field, message) { return new PreviewCliError(code, field, message); }

async function runMain() {
  const result = await runPreviewCli(process.argv.slice(2), {
    onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runMain();
