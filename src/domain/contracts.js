const TREND_KEYS = [
  "searchMomentum",
  "videoVelocity",
  "crossConfirmation",
  "persistence",
  "recency",
];
const VIABILITY_KEYS = [
  "usableSource",
  "transformability",
  "repeatability",
  "inverseSaturation",
  "operationalFit",
];
const GATE_KEYS = [
  "multipleSignals",
  "fourWeekSupply",
  "greenSource",
  "knownOrigin",
  "verifiable",
  "safe",
];
export const MACRO_NICHES = [
  "animação",
  "animais",
  "automóveis",
  "ciência e tecnologia",
  "clima",
  "direito",
  "educação",
  "entretenimento",
  "esportes",
  "finanças",
  "imóveis",
  "jogos",
  "música",
  "política",
];

export function validateCandidates(value, knownEvidenceIds = []) {
  if (!value || !Array.isArray(value.candidates)) {
    throw new Error("Resposta da IA não contém candidates[]");
  }
  const known = new Set(knownEvidenceIds);
  const names = new Set();
  return value.candidates.map((candidate, index) => {
    requireText(candidate.name, `candidates[${index}].name`);
    const normalizedName = candidate.name.trim().toLocaleLowerCase("pt-BR");
    if (names.has(normalizedName)) {
      throw new Error(`Nome de candidato duplicado: ${candidate.name}`);
    }
    names.add(normalizedName);
    requireText(candidate.macroNiche, `candidates[${index}].macroNiche`);
    if (!MACRO_NICHES.includes(candidate.macroNiche)) {
      throw new Error(`candidates[${index}].macroNiche não pertence à taxonomia permitida`);
    }
    requireText(candidate.summary, `candidates[${index}].summary`);
    requireText(candidate.explanation, `candidates[${index}].explanation`);
    if (!Array.isArray(candidate.evidenceIds) || candidate.evidenceIds.length === 0) {
      throw new Error(`candidates[${index}] precisa de evidência`);
    }
    for (const evidenceId of candidate.evidenceIds) {
      if (!known.has(evidenceId)) {
        throw new Error(`Evidência desconhecida: ${evidenceId}`);
      }
    }
    validateScores(candidate.trend, TREND_KEYS, `candidates[${index}].trend`);
    validateScores(candidate.viability, VIABILITY_KEYS, `candidates[${index}].viability`);
    validateGates(candidate.gates, GATE_KEYS, `candidates[${index}].gates`);
    return candidate;
  });
}

function validateScores(value, keys, path) {
  if (!value || typeof value !== "object") throw new Error(`${path} inválido`);
  for (const key of keys) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100) {
      throw new Error(`${path}.${key} deve estar entre 0 e 100`);
    }
  }
}

function validateGates(value, keys, path) {
  if (!value || typeof value !== "object") throw new Error(`${path} inválido`);
  for (const key of keys) {
    if (typeof value[key] !== "boolean") throw new Error(`${path}.${key} deve ser booleano`);
  }
}

function requireText(value, path) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} é obrigatório`);
}

export const candidateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 20,
      maxItems: 20,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "macroNiche",
          "summary",
          "evidenceIds",
          "trend",
          "viability",
          "gates",
          "explanation",
        ],
        properties: {
          name: { type: "string" },
          macroNiche: { type: "string", enum: MACRO_NICHES },
          summary: { type: "string" },
          evidenceIds: { type: "array", minItems: 1, items: { type: "string" } },
          trend: scoreObject(TREND_KEYS),
          viability: scoreObject(VIABILITY_KEYS),
          gates: booleanObject(GATE_KEYS),
          explanation: { type: "string" },
        },
      },
    },
  },
};

function scoreObject(keys) {
  return {
    type: "object",
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((key) => [key, { type: "number" }])),
  };
}

function booleanObject(keys) {
  return {
    type: "object",
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((key) => [key, { type: "boolean" }])),
  };
}

// Radar M1 contracts are additive: the discovery contract above remains the
// boundary for R01A while these versioned contracts define R02A.
export const RADAR_CONTRACT_VERSION = "trend-contracts/1.0.0";
export const TREND_SCORE_VERSION = "trend-score/1.0.0";
export const TREND_SCORE_DEFINITION = Object.freeze({
  version: TREND_SCORE_VERSION,
  deterministic: true,
  components: Object.freeze({
    velocity: "crescimento entre snapshots e visualizações por tempo",
    engagement: "taxas das interações realmente disponíveis",
    recency: "tempo desde a publicação",
    recurrence: "reaparição do assunto em vídeos, regiões e plataformas",
  }),
  missingMetricPolicy: "UNAVAILABLE_REDUCES_CONFIDENCE",
  aiMayChangeEvidenceOrScore: false,
});
export const TREND_PLATFORMS = Object.freeze(["YOUTUBE", "INSTAGRAM", "TIKTOK"]);
export const SOURCE_RUN_STATES = Object.freeze([
  "SUCCESS",
  "PARTIAL",
  "BLOCKED_BY_PROVIDER",
  "FAILED",
]);
export const TREND_RUN_STATES = Object.freeze([
  "CREATED",
  "COLLECTING",
  "NORMALIZING",
  "CLUSTERING",
  "RANKING",
  "COMPLETED",
  "COMPLETED_WITH_GAPS",
  "FAILED",
]);
export const TREND_CANDIDATE_STATES = Object.freeze([
  "DISCOVERED",
  "ACTIVE",
  "SHORTLISTED",
  "SELECTED",
  "STALE",
]);

export const TREND_SCHEMAS = Object.freeze(Object.fromEntries([
  ["TrendRun", ["id", "state", "createdAt", "updatedAt", "sourceRunIds", "candidateIds", "rankingConfigVersion"]],
  ["SourceRun", ["id", "trendRunId", "platform", "status", "startedAt", "completedAt", "capabilities", "coverage", "gaps"]],
  ["TrendCandidate", ["id", "identityKey", "platform", "canonicalUrl", "state", "firstSeenAt", "lastSeenAt", "reappearanceCount", "durationSeconds", "publishedAt", "usageCondition", "snapshotIds", "topicClusterIds"]],
  ["TrendSnapshot", ["id", "candidateId", "capturedAt", "metrics"]],
  ["TopicCluster", ["id", "label", "niche", "subtheme", "likelyAudience", "narrativePattern", "ptBrLocalization", "candidateIds", "evidenceSnapshotIds", "createdBy", "explanation"]],
  ["TrendScore", ["id", "candidateId", "formulaVersion", "calculatedAt", "value", "confidence", "components", "explanation"]],
].map(([name, required]) => [name, Object.freeze({
  $id: `mktauto/${name}/${RADAR_CONTRACT_VERSION}`,
  schemaVersion: RADAR_CONTRACT_VERSION,
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["schemaVersion", ...required]),
})])));

export const TREND_CATALOG_LAYOUT = Object.freeze({
  root: "data/trends/<YYYY-MM-DD>",
  files: Object.freeze(["catalog.json", "ranking.csv", "report.html"]),
  candidateDirectory: "candidates/<candidate-id>",
  candidateFiles: Object.freeze(["candidate.json", "thumbnail.<ext> (somente quando permitido)"]),
  mediaFilesAllowed: false,
});

export class ContractValidationError extends Error {
  constructor(code, path, message) {
    super(`${code} em ${path}: ${message}`);
    this.name = "ContractValidationError";
    this.code = code;
    this.path = path;
  }
}

export function canonicalTrendIdentity({ platform, platformVideoId, canonicalUrl }) {
  requireEnum(platform, TREND_PLATFORMS, "platform");
  if (platformVideoId !== undefined && platformVideoId !== null) {
    requirePlatformVideoId(platformVideoId, "platformVideoId");
    return `${platform}:${platformVideoId}`;
  }
  return `${platform}:url:${normalizeCanonicalUrl(canonicalUrl, platform)}`;
}

export function validateTrendCandidate(value) {
  requireRecord(value, "candidate");
  requireExactKeys(value, [
    "schemaVersion", "id", "identityKey", "platform", "platformVideoId",
    "canonicalUrl", "state", "firstSeenAt", "lastSeenAt", "reappearanceCount",
    "durationSeconds", "publishedAt", "region", "language", "usageCondition",
    "snapshotIds", "topicClusterIds", "author", "title", "category",
  ], "candidate");
  requireSchemaVersion(value.schemaVersion, "candidate.schemaVersion");
  requireIdentifier(value.id, "candidate.id");
  requireEnum(value.platform, TREND_PLATFORMS, "candidate.platform");
  if (value.platformVideoId !== undefined) requirePlatformVideoId(value.platformVideoId, "candidate.platformVideoId");
  normalizeCanonicalUrl(value.canonicalUrl, value.platform);
  requireTextContract(value.identityKey, "candidate.identityKey");
  const expectedIdentity = canonicalTrendIdentity(value);
  if (value.identityKey !== expectedIdentity) fail("INVALID_IDENTITY", "candidate.identityKey", `esperado ${expectedIdentity}`);
  requireEnum(value.state, TREND_CANDIDATE_STATES, "candidate.state");
  requireDateTime(value.firstSeenAt, "candidate.firstSeenAt");
  requireDateTime(value.lastSeenAt, "candidate.lastSeenAt");
  requireDateTime(value.publishedAt, "candidate.publishedAt");
  if (Date.parse(value.lastSeenAt) < Date.parse(value.firstSeenAt)) fail("INVALID_DATETIME", "candidate.lastSeenAt", "anterior a firstSeenAt");
  if (!Number.isInteger(value.reappearanceCount) || value.reappearanceCount < 1) fail("INVALID_RANGE", "candidate.reappearanceCount", "deve ser inteiro positivo");
  if (!Number.isFinite(value.durationSeconds) || value.durationSeconds < 15 || value.durationSeconds > 180) {
    fail("INVALID_DURATION", "candidate.durationSeconds", "deve estar entre 15 e 180 segundos");
  }
  optionalText(value.region, "candidate.region");
  optionalText(value.language, "candidate.language");
  optionalText(value.author, "candidate.author");
  optionalText(value.title, "candidate.title");
  optionalText(value.category, "candidate.category");
  requireEnum(value.usageCondition, ["REFERENCE_ONLY", "USAGE_UNKNOWN", "USAGE_CONFIRMED"], "candidate.usageCondition");
  requireIdentifierArray(value.snapshotIds, "candidate.snapshotIds");
  requireIdentifierArray(value.topicClusterIds, "candidate.topicClusterIds");
  return value;
}

export function validateTrendSnapshot(value) {
  requireRecord(value, "snapshot");
  requireExactKeys(value, ["schemaVersion", "id", "candidateId", "capturedAt", "metrics"], "snapshot");
  requireSchemaVersion(value.schemaVersion, "snapshot.schemaVersion");
  requireIdentifier(value.id, "snapshot.id");
  requireIdentifier(value.candidateId, "snapshot.candidateId");
  requireDateTime(value.capturedAt, "snapshot.capturedAt");
  requireRecord(value.metrics, "snapshot.metrics");
  requireExactKeys(value.metrics, ["views", "likes", "comments", "shares"], "snapshot.metrics", true);
  for (const metric of ["views", "likes", "comments", "shares"]) {
    validateAvailability(value.metrics[metric], `snapshot.metrics.${metric}`, { max: Number.MAX_SAFE_INTEGER, code: "INVALID_METRIC" });
  }
  return value;
}

export function validateSourceRun(value) {
  requireRecord(value, "sourceRun");
  requireExactKeys(value, [
    "schemaVersion", "id", "trendRunId", "platform", "status", "startedAt",
    "completedAt", "capabilities", "coverage", "gaps", "errorCode",
  ], "sourceRun");
  requireSchemaVersion(value.schemaVersion, "sourceRun.schemaVersion");
  requireIdentifier(value.id, "sourceRun.id");
  requireIdentifier(value.trendRunId, "sourceRun.trendRunId");
  requireEnum(value.platform, TREND_PLATFORMS, "sourceRun.platform");
  requireEnum(value.status, SOURCE_RUN_STATES, "sourceRun.status");
  requireDateTime(value.startedAt, "sourceRun.startedAt");
  requireDateTime(value.completedAt, "sourceRun.completedAt");
  requireRecord(value.capabilities, "sourceRun.capabilities");
  requireExactKeys(value.capabilities, ["discovery", "metrics", "supportsRegions", "limitations"], "sourceRun.capabilities", true);
  requireEnum(value.capabilities.discovery, ["GLOBAL_TRENDS", "PUBLIC_QUERY", "HASHTAG_SEARCH", "AUTHORIZED_ONLY", "UNAVAILABLE"], "sourceRun.capabilities.discovery");
  requireEnumArray(value.capabilities.metrics, ["VIEWS", "LIKES", "COMMENTS", "SHARES"], "sourceRun.capabilities.metrics");
  if (typeof value.capabilities.supportsRegions !== "boolean") fail("INVALID_TYPE", "sourceRun.capabilities.supportsRegions", "deve ser booleano");
  requireTextArray(value.capabilities.limitations, "sourceRun.capabilities.limitations");
  requireRecord(value.coverage, "sourceRun.coverage");
  requireExactKeys(value.coverage, ["requestedRegions", "coveredRegions", "complete"], "sourceRun.coverage", true);
  requireTextArray(value.coverage.requestedRegions, "sourceRun.coverage.requestedRegions");
  requireTextArray(value.coverage.coveredRegions, "sourceRun.coverage.coveredRegions");
  if (typeof value.coverage.complete !== "boolean") fail("INVALID_TYPE", "sourceRun.coverage.complete", "deve ser booleano");
  requireTextArray(value.gaps, "sourceRun.gaps");
  optionalText(value.errorCode, "sourceRun.errorCode");
  if (value.status === "SUCCESS" && (!value.coverage.complete || value.gaps.length > 0)) fail("INVALID_COVERAGE", "sourceRun", "SUCCESS exige cobertura completa e nenhuma lacuna");
  if (value.status === "PARTIAL" && (value.coverage.complete || value.gaps.length === 0)) fail("INVALID_COVERAGE", "sourceRun", "PARTIAL exige cobertura incompleta e lacunas explícitas");
  if (["BLOCKED_BY_PROVIDER", "FAILED"].includes(value.status) && !value.errorCode) fail("REQUIRED", "sourceRun.errorCode", "obrigatório para fonte bloqueada ou falha");
  if (["BLOCKED_BY_PROVIDER", "FAILED"].includes(value.status) && (value.coverage.complete || value.gaps.length === 0)) {
    fail("INVALID_COVERAGE", "sourceRun", "bloqueio ou falha exige cobertura incompleta e lacuna explícita");
  }
  return value;
}

export function validateTrendRun(value, sourceRuns = []) {
  requireRecord(value, "run");
  requireExactKeys(value, [
    "schemaVersion", "id", "state", "createdAt", "updatedAt", "sourceRunIds",
    "candidateIds", "rankingConfigVersion",
  ], "run");
  requireSchemaVersion(value.schemaVersion, "run.schemaVersion");
  requireIdentifier(value.id, "run.id");
  requireEnum(value.state, TREND_RUN_STATES, "run.state");
  requireDateTime(value.createdAt, "run.createdAt");
  requireDateTime(value.updatedAt, "run.updatedAt");
  requireIdentifierArray(value.sourceRunIds, "run.sourceRunIds");
  requireIdentifierArray(value.candidateIds, "run.candidateIds");
  requireTextContract(value.rankingConfigVersion, "run.rankingConfigVersion");
  const validatedSources = sourceRuns.map(validateSourceRun);
  const knownIds = new Set(validatedSources.map((item) => item.id));
  for (const id of value.sourceRunIds) if (validatedSources.length > 0 && !knownIds.has(id)) fail("UNKNOWN_EVIDENCE", "run.sourceRunIds", `fonte desconhecida: ${id}`);
  const hasGap = validatedSources.some((item) => item.status !== "SUCCESS");
  if (value.state === "COMPLETED" && hasGap) fail("INVALID_RUN_COVERAGE", "run.state", "fontes incompletas exigem COMPLETED_WITH_GAPS");
  if (value.state === "COMPLETED_WITH_GAPS" && validatedSources.length > 0 && !hasGap) fail("INVALID_RUN_COVERAGE", "run.state", "nenhuma lacuna declarada");
  return value;
}

export function validateTopicCluster(value, knownCandidateIds = [], knownSnapshotIds = []) {
  requireRecord(value, "topicCluster");
  requireExactKeys(value, [
    "schemaVersion", "id", "label", "niche", "subtheme", "likelyAudience",
    "narrativePattern", "ptBrLocalization", "candidateIds", "evidenceSnapshotIds",
    "createdBy", "explanation",
  ], "topicCluster", true);
  requireSchemaVersion(value.schemaVersion, "topicCluster.schemaVersion");
  requireIdentifier(value.id, "topicCluster.id");
  requireTextContract(value.label, "topicCluster.label");
  requireTextContract(value.niche, "topicCluster.niche");
  requireTextContract(value.subtheme, "topicCluster.subtheme");
  requireTextContract(value.likelyAudience, "topicCluster.likelyAudience");
  requireTextContract(value.narrativePattern, "topicCluster.narrativePattern");
  requireTextContract(value.ptBrLocalization, "topicCluster.ptBrLocalization");
  requireIdentifierArray(value.candidateIds, "topicCluster.candidateIds", true);
  requireIdentifierArray(value.evidenceSnapshotIds, "topicCluster.evidenceSnapshotIds", true);
  requireKnownIds(value.candidateIds, knownCandidateIds, "topicCluster.candidateIds");
  requireKnownIds(value.evidenceSnapshotIds, knownSnapshotIds, "topicCluster.evidenceSnapshotIds");
  requireEnum(value.createdBy, ["HUMAN", "OLLAMA"], "topicCluster.createdBy");
  requireTextContract(value.explanation, "topicCluster.explanation");
  return value;
}

export function validateTrendScore(value) {
  requireRecord(value, "score");
  requireExactKeys(value, ["schemaVersion", "id", "candidateId", "formulaVersion", "calculatedAt", "value", "confidence", "components", "explanation"], "score", true);
  requireSchemaVersion(value.schemaVersion, "score.schemaVersion");
  requireIdentifier(value.id, "score.id");
  requireIdentifier(value.candidateId, "score.candidateId");
  if (value.formulaVersion !== TREND_SCORE_VERSION) fail("UNSUPPORTED_VERSION", "score.formulaVersion", `esperado ${TREND_SCORE_VERSION}`);
  requireDateTime(value.calculatedAt, "score.calculatedAt");
  requireRange(value.value, 0, 100, "score.value");
  requireRange(value.confidence, 0, 1, "score.confidence");
  requireRecord(value.components, "score.components");
  requireExactKeys(value.components, ["velocity", "engagement", "recency", "recurrence"], "score.components", true);
  for (const component of ["velocity", "engagement", "recency", "recurrence"]) {
    validateScoreComponent(value.components[component], `score.components.${component}`);
  }
  requireTextContract(value.explanation, "score.explanation");
  const available = Object.values(value.components).filter((component) => component.availability === "AVAILABLE").length;
  if (available < 4 && value.confidence >= 1) fail("INVALID_CONFIDENCE", "score.confidence", "componente indisponível deve reduzir confiança");
  return value;
}

export function validateAiTopicProposal(value, knownCandidateIds, knownSnapshotIds) {
  requireRecord(value, "aiProposal");
  const allowed = [
    "label", "niche", "subtheme", "likelyAudience", "narrativePattern",
    "ptBrLocalization", "candidateIds", "evidenceSnapshotIds", "explanation",
  ];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail("AI_EVIDENCE_MUTATION", "aiProposal", `campos não permitidos: ${unknown.join(", ")}`);
  requireExactKeys(value, allowed, "aiProposal", true);
  requireTextContract(value.label, "aiProposal.label");
  requireTextContract(value.niche, "aiProposal.niche");
  requireTextContract(value.subtheme, "aiProposal.subtheme");
  requireTextContract(value.likelyAudience, "aiProposal.likelyAudience");
  requireTextContract(value.narrativePattern, "aiProposal.narrativePattern");
  requireTextContract(value.ptBrLocalization, "aiProposal.ptBrLocalization");
  requireIdentifierArray(value.candidateIds, "aiProposal.candidateIds", true);
  requireIdentifierArray(value.evidenceSnapshotIds, "aiProposal.evidenceSnapshotIds", true);
  requireKnownIds(value.candidateIds, knownCandidateIds, "aiProposal.candidateIds");
  requireKnownIds(value.evidenceSnapshotIds, knownSnapshotIds, "aiProposal.evidenceSnapshotIds");
  requireTextContract(value.explanation, "aiProposal.explanation");
  return value;
}

export function serializePublicTrendCatalog(value) {
  requireRecord(value, "catalog");
  const sourceRuns = (value.sourceRuns ?? []).map((item) => validateSourceRun(pick(item, [
    "schemaVersion", "id", "trendRunId", "platform", "status", "startedAt",
    "completedAt", "capabilities", "coverage", "gaps", "errorCode",
  ])));
  const run = validateTrendRun(pick(value.run, [
    "schemaVersion", "id", "state", "createdAt", "updatedAt", "sourceRunIds",
    "candidateIds", "rankingConfigVersion",
  ]), sourceRuns);
  const candidates = (value.candidates ?? []).map((item) => validateTrendCandidate(pick(item, [
    "schemaVersion", "id", "identityKey", "platform", "platformVideoId", "canonicalUrl",
    "state", "firstSeenAt", "lastSeenAt", "reappearanceCount", "durationSeconds",
    "publishedAt", "region", "language", "usageCondition", "snapshotIds", "topicClusterIds", "author", "title", "category",
  ])));
  const snapshots = (value.snapshots ?? []).map((item) => validateTrendSnapshot(pick(item, ["schemaVersion", "id", "candidateId", "capturedAt", "metrics"])));
  const candidateIds = candidates.map((item) => item.id);
  const snapshotIds = snapshots.map((item) => item.id);
  const topicClusters = (value.topicClusters ?? []).map((item) => validateTopicCluster(pick(item, [
    "schemaVersion", "id", "label", "niche", "subtheme", "likelyAudience", "narrativePattern",
    "ptBrLocalization", "candidateIds", "evidenceSnapshotIds", "createdBy", "explanation",
  ]), candidateIds, snapshotIds));
  const scores = (value.scores ?? []).map((item) => validateTrendScore(pick(item, [
    "schemaVersion", "id", "candidateId", "formulaVersion", "calculatedAt", "value",
    "confidence", "components", "explanation",
  ])));
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    layout: TREND_CATALOG_LAYOUT,
    run,
    sourceRuns,
    candidates,
    snapshots,
    topicClusters,
    scores,
  };
}

function validateScoreComponent(value, path) {
  validateAvailability(value, path, { max: 100, code: "INVALID_SCORE_COMPONENT", extraKeys: ["evidenceSnapshotIds"] });
  requireIdentifierArray(value.evidenceSnapshotIds, `${path}.evidenceSnapshotIds`, true);
}

function validateAvailability(value, path, { max, code, extraKeys = [] }) {
  requireRecord(value, path);
  requireExactKeys(value, ["availability", "value", "reason", ...extraKeys], path);
  requireEnum(value.availability, ["AVAILABLE", "UNAVAILABLE"], `${path}.availability`);
  if (value.availability === "AVAILABLE") {
    if (value.reason !== undefined) fail(code, path, "valor disponível não aceita reason");
    if (!Number.isFinite(value.value) || value.value < 0 || value.value > max) fail(code, `${path}.value`, `deve estar entre 0 e ${max}`);
  } else {
    if (Object.hasOwn(value, "value")) fail(code, `${path}.value`, "métrica indisponível não pode conter valor estimado");
    requireTextContract(value.reason, `${path}.reason`);
  }
}

function requireSchemaVersion(value, path) {
  if (value !== RADAR_CONTRACT_VERSION) fail("UNSUPPORTED_VERSION", path, `esperado ${RADAR_CONTRACT_VERSION}`);
}

function requireRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser objeto");
}

function requireExactKeys(value, allowed, path, requireAll = false) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail("UNKNOWN_FIELD", path, `campos desconhecidos: ${unknown.join(", ")}`);
  if (requireAll) for (const key of allowed) if (!Object.hasOwn(value, key)) fail("REQUIRED", `${path}.${key}`, "campo obrigatório");
}

function requireIdentifier(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) fail("INVALID_ID", path, "formato inválido");
}

function requirePlatformVideoId(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) fail("INVALID_ID", path, "formato inválido");
}

function requireIdentifierArray(value, path, nonEmpty = false) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) fail("INVALID_TYPE", path, nonEmpty ? "deve ser array não vazio" : "deve ser array");
  for (const item of value) requireIdentifier(item, path);
  if (new Set(value).size !== value.length) fail("DUPLICATE_ID", path, "não aceita IDs duplicados");
}

function requireTextArray(value, path) {
  if (!Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser array");
  for (const item of value) requireTextContract(item, path);
  if (new Set(value).size !== value.length) fail("DUPLICATE_VALUE", path, "não aceita valores duplicados");
}

function requireEnumArray(value, allowed, path) {
  if (!Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser array");
  for (const item of value) requireEnum(item, allowed, path);
  if (new Set(value).size !== value.length) fail("DUPLICATE_VALUE", path, "não aceita valores duplicados");
}

function requireKnownIds(values, knownValues, path) {
  const known = new Set(knownValues);
  for (const value of values) if (!known.has(value)) fail("UNKNOWN_EVIDENCE", path, `evidência desconhecida: ${value}`);
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(value)) fail("INVALID_ENUM", path, `valores aceitos: ${allowed.join(", ")}`);
}

function requireTextContract(value, path) {
  if (typeof value !== "string" || value.trim() === "") fail("REQUIRED", path, "texto obrigatório");
}

function optionalText(value, path) {
  if (value !== undefined) requireTextContract(value, path);
}

function requireDateTime(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_DATETIME", path, "deve ser data ISO 8601");
  }
}

function requireRange(value, min, max, path) {
  if (!Number.isFinite(value) || value < min || value > max) fail("INVALID_RANGE", path, `deve estar entre ${min} e ${max}`);
}

function normalizeCanonicalUrl(value, platform) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("INVALID_URL", "canonicalUrl", "URL inválida");
  }
  if (url.protocol !== "https:") fail("INVALID_URL", "canonicalUrl", "deve usar HTTPS");
  if (url.username || url.password || url.port) fail("INVALID_URL", "canonicalUrl", "credenciais e portas não são permitidas");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const hosts = {
    YOUTUBE: ["youtube.com", "youtu.be"],
    INSTAGRAM: ["instagram.com"],
    TIKTOK: ["tiktok.com"],
  };
  if (!hosts[platform]?.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    fail("INVALID_URL", "canonicalUrl", `host não pertence a ${platform}`);
  }
  url.hash = "";
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (platform === "YOUTUBE" && host === "youtube.com" && url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    if (!videoId) fail("INVALID_URL", "canonicalUrl", "URL watch do YouTube exige parâmetro v");
    requirePlatformVideoId(videoId, "canonicalUrl.v");
    url.search = `?v=${encodeURIComponent(videoId)}`;
  } else {
    url.search = "";
  }
  return url.toString().replace(/\/$/, "");
}

function pick(value, keys) {
  requireRecord(value, "value");
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
