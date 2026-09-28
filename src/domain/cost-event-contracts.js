import { ContractValidationError } from "./contracts.js";

export const COST_EVENT_CONTRACT_VERSION = "cost-event/1.0.0";
export const COST_LEDGER_CONTRACT_VERSION = "cost-ledger/1.0.0";
export const COST_EVENT_CATEGORIES = Object.freeze([
  "production_cost",
  "ai_cost",
  "media_cost",
  "voice_cost",
  "publishing_cost",
]);

const EVENT_FIELDS = Object.freeze([
  "schemaVersion", "costEventId", "category", "pipelineRunId", "projectId",
  "projectVersion", "contentIdentity", "artifactId", "amount", "currency",
  "occurredAt", "origin", "attributionRuleVersion", "recordedAt",
]);

export function validateCostEvent(value) {
  record(value, "costEvent");
  exact(value, EVENT_FIELDS, "costEvent");
  if (value.schemaVersion !== COST_EVENT_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }
  const category = costCategory(value.category);
  return deepFreeze({
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: identifier(value.costEventId, "costEventId", 200),
    category,
    pipelineRunId: identifier(value.pipelineRunId, "pipelineRunId"),
    projectId: identifier(value.projectId, "projectId"),
    projectVersion: positiveInteger(value.projectVersion, "projectVersion"),
    contentIdentity: nullableIdentifier(value.contentIdentity, "contentIdentity", 200),
    artifactId: nullableIdentifier(value.artifactId, "artifactId", 200),
    amount: normalizePositiveDecimal(value.amount),
    currency: currency(value.currency),
    occurredAt: timestamp(value.occurredAt, "occurredAt"),
    origin: token(value.origin, "origin", "INVALID_COST_ORIGIN"),
    attributionRuleVersion: versionedToken(value.attributionRuleVersion),
    recordedAt: timestamp(value.recordedAt, "recordedAt"),
  });
}

export function createCostLedger({ pipelineRunId, projectId, projectVersion, events }) {
  if (!Array.isArray(events)) fail("INVALID_TYPE", "events", "deve ser uma lista");
  const normalizedPipelineRunId = identifier(pipelineRunId, "pipelineRunId");
  const normalizedProjectId = identifier(projectId, "projectId");
  const normalizedProjectVersion = positiveInteger(projectVersion, "projectVersion");
  const validated = events.map(validateCostEvent);
  for (const [index, event] of validated.entries()) {
    if (event.pipelineRunId !== normalizedPipelineRunId
      || event.projectId !== normalizedProjectId
      || event.projectVersion !== normalizedProjectVersion) {
      fail("COST_LEDGER_SCOPE_MISMATCH", `events.${index}`, "evento pertence a outro escopo");
    }
  }
  const totals = new Map();
  for (const event of validated) {
    totals.set(event.currency, addDecimals(totals.get(event.currency) ?? "0", event.amount));
  }
  return deepFreeze({
    schemaVersion: COST_LEDGER_CONTRACT_VERSION,
    pipelineRunId: normalizedPipelineRunId,
    projectId: normalizedProjectId,
    projectVersion: normalizedProjectVersion,
    events: validated,
    totalsByCurrency: [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ledgerCurrency, amount]) => deepFreeze({ currency: ledgerCurrency, amount })),
  });
}

function normalizePositiveDecimal(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 80) {
    fail("INVALID_COST_AMOUNT", "amount", "use decimal positivo exato em texto");
  }
  const [rawInteger, rawFraction = ""] = value.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  if (integer.length > 40 || fraction.length > 18) {
    fail("INVALID_COST_AMOUNT", "amount", "valor excede a precisão permitida");
  }
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  if (/^0(?:\.0*)?$/.test(normalized)) {
    fail("INVALID_COST_AMOUNT", "amount", "custo deve ser maior que zero");
  }
  return normalized;
}

function addDecimals(left, right) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightScaled = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  const raw = (leftScaled + rightScaled).toString().padStart(scale + 1, "0");
  if (scale === 0) return raw;
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction ? `${raw.slice(0, -scale)}.${fraction}` : raw.slice(0, -scale);
}

function costCategory(value) {
  if (!COST_EVENT_CATEGORIES.includes(value)) {
    fail("INVALID_COST_CATEGORY", "category", "categoria de custo inválida");
  }
  return value;
}

function currency(value) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    fail("INVALID_CURRENCY", "currency", "use código monetário de três letras maiúsculas");
  }
  return value;
}

function versionedToken(value) {
  if (typeof value !== "string"
    || value.length > 120
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*\/\d+\.\d+\.\d+$/.test(value)) {
    fail("INVALID_ATTRIBUTION_RULE_VERSION", "attributionRuleVersion", "regra versionada inválida");
  }
  return value;
}

function token(value, path, code) {
  if (typeof value !== "string" || value.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value)) {
    fail(code, path, "valor explícito inválido");
  }
  return value;
}

function nullableIdentifier(value, path, max) {
  return value === null ? null : identifier(value, path, max);
}

function identifier(value, path, max = 80) {
  if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) {
    fail("INVALID_IDENTIFIER", path, "identificador inválido");
  }
  return value;
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_PROJECT_VERSION", path, "deve ser inteiro positivo");
  return value;
}

function timestamp(value, path) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_TIMESTAMP", path, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser objeto");
}

function exact(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "campo não permitido");
  }
  for (const key of allowed) {
    if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`, "campo obrigatório");
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
