import { ContractValidationError } from "./contracts.js";

export const PROJECT_CONTRACT_VERSION = "project-contracts/1.0.0";

export const PROJECT_DEFAULTS = deepFreeze({
  version: 1,
  language: "pt-BR",
  subniches: [],
  references: [],
  channel: {
    format: "short_video",
    aspectRatio: "9:16",
    minDurationSeconds: 25,
    maxDurationSeconds: 45,
    editorialStyle: "informative",
    visualStyle: "dynamic",
    voiceStyle: "informative",
    publishing: {
      contentsPerDay: 1,
      timezone: "America/Sao_Paulo",
      times: ["10:00"],
    },
  },
});

const NETWORKS = Object.freeze(["facebook", "instagram", "threads", "tiktok", "youtube"]);
const FORMATS = Object.freeze(["short_video", "long_video"]);
const ASPECT_RATIOS = Object.freeze(["9:16", "4:5", "1:1", "16:9"]);
const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "secrets",
  "token",
  "tokens",
  "webhooksecret",
]);

export const PROJECT_SCHEMAS = deepFreeze({
  Project: schema("Project", ["id", "name", "version", "niche", "subniches", "audience"]),
  ChannelProfile: schema("ChannelProfile", [
    "format",
    "aspectRatio",
    "minDurationSeconds",
    "maxDurationSeconds",
    "editorialStyle",
    "visualStyle",
    "voiceStyle",
    "publishing",
  ]),
  ReferenceProfile: schema("ReferenceProfile", [
    "platform",
    "handle",
    "purpose",
    "usage",
    "grantsUsageRights",
  ]),
  ProjectSnapshot: schema("ProjectSnapshot", ["schemaVersion", "project", "channel", "references"]),
});

export function createProjectSnapshot(value) {
  rejectSensitiveFields(value);
  requireRecord(value, "project");
  requireExactKeys(
    value,
    ["schemaVersion", "id", "name", "version", "niche", "subniches", "audience", "references", "channel"],
    "project",
  );
  if (value.schemaVersion !== undefined && value.schemaVersion !== PROJECT_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }

  const project = validateProject(value);
  const channel = validateChannelProfile(value.channel);
  const references = validateReferences(value.references ?? PROJECT_DEFAULTS.references);

  return deepFreeze({
    schemaVersion: PROJECT_CONTRACT_VERSION,
    project,
    channel,
    references,
  });
}

export function validateProjectSnapshot(value) {
  rejectSensitiveFields(value);
  requireRecord(value, "snapshot");
  requireExactKeys(value, ["schemaVersion", "project", "channel", "references"], "snapshot");
  if (value.schemaVersion !== PROJECT_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }

  requireRecord(value.project, "project");
  requireExactKeys(value.project, ["id", "name", "version", "niche", "subniches", "audience"], "project");
  const project = validateProject(value.project);
  const channel = validateChannelProfile(value.channel);
  if (!Array.isArray(value.references)) fail("INVALID_TYPE", "references", "deve ser uma lista");
  const references = value.references.map((reference, index) => {
    const path = `references[${index}]`;
    requireRecord(reference, path);
    requireExactKeys(reference, ["platform", "handle", "purpose", "usage", "grantsUsageRights"], path);
    if (reference.usage !== "strategic_reference_only" || reference.grantsUsageRights !== false) {
      fail("INVALID_REFERENCE_RIGHTS", path, "referência persistida deve permanecer somente estratégica e sem direito de uso");
    }
    return validateReferenceProfile({
      platform: reference.platform,
      handle: reference.handle,
      purpose: reference.purpose,
    }, path);
  });
  ensureUnique(references.map(({ platform, handle }) => `${platform}:${handle.toLocaleLowerCase("en-US")}`), "references");

  return deepFreeze({ schemaVersion: PROJECT_CONTRACT_VERSION, project, channel, references });
}

export function validateProject(value) {
  rejectSensitiveFields(value);
  requireRecord(value, "project");
  requireExactKeys(
    value,
    ["schemaVersion", "id", "name", "version", "niche", "subniches", "audience", "references", "channel"],
    "project",
  );
  requireIdentifier(value.id, "project.id");
  const name = normalizeRequiredText(value.name, "project.name");
  const niche = normalizeRequiredText(value.niche, "project.niche").toLocaleLowerCase("pt-BR");
  const version = value.version ?? PROJECT_DEFAULTS.version;
  requireInteger(version, "project.version", "INVALID_VERSION", 1, Number.MAX_SAFE_INTEGER);
  const subniches = normalizeUniqueTextArray(value.subniches ?? PROJECT_DEFAULTS.subniches, "project.subniches");

  requireRecord(value.audience, "project.audience");
  requireExactKeys(value.audience, ["profile", "language"], "project.audience");
  const profile = normalizeRequiredText(value.audience.profile, "project.audience.profile");
  const language = normalizeLanguage(value.audience.language ?? PROJECT_DEFAULTS.language, "project.audience.language");

  return {
    id: value.id,
    name,
    version,
    niche,
    subniches,
    audience: { profile, language },
  };
}

export function validateChannelProfile(value = {}) {
  rejectSensitiveFields(value, "channel");
  requireRecord(value, "channel");
  requireExactKeys(value, [
    "format",
    "aspectRatio",
    "minDurationSeconds",
    "maxDurationSeconds",
    "editorialStyle",
    "visualStyle",
    "voiceStyle",
    "publishing",
  ], "channel");

  const format = normalizeEnum(value.format ?? PROJECT_DEFAULTS.channel.format, FORMATS, "channel.format", "INVALID_FORMAT");
  const aspectRatio = value.aspectRatio ?? PROJECT_DEFAULTS.channel.aspectRatio;
  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    fail("INVALID_ASPECT_RATIO", "channel.aspectRatio", "proporção não suportada");
  }
  const minDurationSeconds = value.minDurationSeconds ?? PROJECT_DEFAULTS.channel.minDurationSeconds;
  const maxDurationSeconds = value.maxDurationSeconds ?? PROJECT_DEFAULTS.channel.maxDurationSeconds;
  requireInteger(minDurationSeconds, "channel.minDurationSeconds", "INVALID_DURATION", 1, 3600);
  requireInteger(maxDurationSeconds, "channel.maxDurationSeconds", "INVALID_DURATION", 1, 3600);
  if (minDurationSeconds > maxDurationSeconds) {
    fail("INVALID_DURATION_RANGE", "channel.maxDurationSeconds", "deve ser maior ou igual à duração mínima");
  }

  return {
    format,
    aspectRatio,
    minDurationSeconds,
    maxDurationSeconds,
    editorialStyle: normalizeRequiredText(
      value.editorialStyle ?? PROJECT_DEFAULTS.channel.editorialStyle,
      "channel.editorialStyle",
    ),
    visualStyle: normalizeRequiredText(value.visualStyle ?? PROJECT_DEFAULTS.channel.visualStyle, "channel.visualStyle"),
    voiceStyle: normalizeRequiredText(value.voiceStyle ?? PROJECT_DEFAULTS.channel.voiceStyle, "channel.voiceStyle"),
    publishing: validatePublishing(value.publishing ?? {}),
  };
}

export function validateReferenceProfile(value, path = "reference") {
  rejectSensitiveFields(value, path);
  requireRecord(value, path);
  requireExactKeys(value, ["platform", "handle", "purpose"], path);
  const platform = normalizeEnum(value.platform, NETWORKS, `${path}.platform`, "INVALID_NETWORK");
  const handle = normalizeRequiredText(value.handle, `${path}.handle`);
  const purpose = typeof value.purpose === "string" ? value.purpose.trim().toLocaleLowerCase("en-US") : value.purpose;
  if (purpose !== "strategic_reference") {
    fail("INVALID_REFERENCE_PURPOSE", `${path}.purpose`, "somente referência estratégica é permitida");
  }
  return {
    platform,
    handle,
    purpose,
    usage: "strategic_reference_only",
    grantsUsageRights: false,
  };
}

function validatePublishing(value) {
  requireRecord(value, "channel.publishing");
  requireExactKeys(value, ["contentsPerDay", "networks", "timezone", "times"], "channel.publishing");
  const contentsPerDay = value.contentsPerDay ?? PROJECT_DEFAULTS.channel.publishing.contentsPerDay;
  requireInteger(contentsPerDay, "channel.publishing.contentsPerDay", "INVALID_FREQUENCY", 1, 24);

  if (!Array.isArray(value.networks) || value.networks.length === 0) {
    fail("REQUIRED_FIELD", "channel.publishing.networks", "informe ao menos uma rede");
  }
  const networks = normalizeUniqueEnumArray(value.networks, NETWORKS, "channel.publishing.networks", "INVALID_NETWORK");
  const timezone = normalizeTimezone(
    value.timezone ?? PROJECT_DEFAULTS.channel.publishing.timezone,
    "channel.publishing.timezone",
  );
  const timesInput = value.times ?? PROJECT_DEFAULTS.channel.publishing.times;
  if (!Array.isArray(timesInput) || timesInput.length === 0) {
    fail("REQUIRED_FIELD", "channel.publishing.times", "informe ao menos um horário");
  }
  const times = normalizeTimes(timesInput, "channel.publishing.times");
  if (times.length !== contentsPerDay) {
    fail("SCHEDULE_FREQUENCY_MISMATCH", "channel.publishing.times", "a quantidade deve corresponder à frequência diária");
  }
  return { contentsPerDay, networks, timezone, times };
}

function validateReferences(values) {
  if (!Array.isArray(values)) fail("INVALID_TYPE", "references", "deve ser uma lista");
  const references = values.map((value, index) => validateReferenceProfile(value, `references[${index}]`));
  ensureUnique(references.map(({ platform, handle }) => `${platform}:${handle.toLocaleLowerCase("en-US")}`), "references");
  return references;
}

function normalizeUniqueTextArray(values, path) {
  if (!Array.isArray(values)) fail("INVALID_TYPE", path, "deve ser uma lista");
  const normalized = values.map((value, index) => normalizeRequiredText(value, `${path}[${index}]`).toLocaleLowerCase("pt-BR"));
  ensureUnique(normalized, path);
  return normalized;
}

function normalizeUniqueEnumArray(values, allowed, path, code) {
  const normalized = values.map((value, index) => normalizeEnum(value, allowed, `${path}[${index}]`, code));
  ensureUnique(normalized, path);
  return normalized;
}

function normalizeTimes(values, path) {
  const normalized = values.map((value, index) => {
    if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim())) {
      fail("INVALID_TIME", `${path}[${index}]`, "use HH:MM entre 00:00 e 23:59");
    }
    return value.trim();
  });
  ensureUnique(normalized, path);
  return normalized.sort();
}

function normalizeTimezone(value, path) {
  if (typeof value !== "string" || value.trim() === "") fail("INVALID_TIMEZONE", path, "timezone inválido");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    fail("INVALID_TIMEZONE", path, "use um timezone IANA válido");
  }
}

function normalizeLanguage(value, path) {
  if (typeof value !== "string") fail("INVALID_LANGUAGE", path, "use código BCP 47 como pt-BR");
  const match = /^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2}))?$/.exec(value.trim());
  if (!match) fail("INVALID_LANGUAGE", path, "use código BCP 47 como pt-BR");
  return match[2] ? `${match[1].toLowerCase()}-${match[2].toUpperCase()}` : match[1].toLowerCase();
}

function normalizeEnum(value, allowed, path, code) {
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : value;
  if (!allowed.includes(normalized)) fail(code, path, "valor não suportado");
  return normalized;
}

function normalizeRequiredText(value, path) {
  if (typeof value !== "string" || value.trim() === "") fail("REQUIRED_FIELD", path, "texto obrigatório");
  return value.trim().replace(/\s+/g, " ");
}

function requireIdentifier(value, path) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(value)) {
    fail("INVALID_ID", path, "use de 3 a 80 caracteres minúsculos, números, _ ou -");
  }
}

function requireInteger(value, path, code, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(code, path, `deve ser inteiro entre ${min} e ${max}`);
  }
}

function requireRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser um objeto");
}

function requireExactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("UNKNOWN_FIELD", path === "project" && key === "schemaVersion" ? key : `${path}.${key}`, "campo não permitido");
  }
}

function ensureUnique(values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) fail("DUPLICATE_VALUE", `${path}[${index}]`, "valor duplicado");
    seen.add(value);
  });
}

function rejectSensitiveFields(value, rootPath = "") {
  const seen = new WeakSet();
  function visit(current, path) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      const normalizedKey = key.replace(/[^a-zA-Z]/g, "").toLocaleLowerCase("en-US");
      if (SENSITIVE_KEYS.has(normalizedKey)) {
        fail("SENSITIVE_FIELD_REJECTED", childPath, "credenciais, tokens e segredos não pertencem ao contrato");
      }
      visit(child, childPath);
    }
  }
  visit(value, rootPath);
}

function schema(name, required) {
  return {
    $id: `mktauto/${name}/${PROJECT_CONTRACT_VERSION}`,
    schemaVersion: PROJECT_CONTRACT_VERSION,
    type: "object",
    additionalProperties: false,
    required,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
