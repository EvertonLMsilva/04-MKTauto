export const SCRIPT_PROMPT_POLICY_VERSION = "script-generation-prompt/1.2.0";

export const SCRIPT_GENERATION_POLICY = deepFreeze({
  version: SCRIPT_PROMPT_POLICY_VERSION,
  taskType: "script_generation",
  instructions: [
    "Produza conteúdo original sem copiar ou parafrasear de perto referências.",
    "Respeite idioma, formato e público informados; trate minDurationSeconds e maxDurationSeconds como a faixa alvo desejada para a duração estimada do roteiro.",
    "Liste toda afirmação sensível e exija verificação de fonte ou revisão humana.",
    "Não represente aprovação editorial nem autorização para publicação.",
  ],
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["hook", "narrativeBlocks", "visualDirections", "cta", "estimatedDurationSeconds", "sensitiveClaims", "reviewFlags"],
    properties: {
      hook: { type: "string" },
      narrativeBlocks: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["position", "purpose", "narration"],
          properties: {
            position: { type: "integer" },
            purpose: { type: "string", enum: ["INTRODUCTION", "EXPLANATION", "EXAMPLE", "CONCLUSION"] },
            narration: { type: "string" },
          },
        },
      },
      visualDirections: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["position", "blockPosition", "description"],
          properties: { position: { type: "integer" }, blockPosition: { type: "integer" }, description: { type: "string" } },
        },
      },
      cta: { anyOf: [{ type: "string" }, { type: "null" }] },
      estimatedDurationSeconds: { type: "integer" },
      sensitiveClaims: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["position", "blockPosition", "summary", "sourceRequired", "humanReviewRequired"],
          properties: {
            position: { type: "integer" }, blockPosition: { type: "integer" }, summary: { type: "string" },
            sourceRequired: { type: "boolean" }, humanReviewRequired: { type: "boolean" },
          },
        },
      },
      reviewFlags: { type: "array", items: { type: "string", enum: ["SOURCE_VERIFICATION_REQUIRED", "HUMAN_REVIEW_REQUIRED", "ORIGINALITY_REVIEW_REQUIRED"] } },
    },
  },
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
