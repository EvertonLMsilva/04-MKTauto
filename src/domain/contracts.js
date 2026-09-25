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
