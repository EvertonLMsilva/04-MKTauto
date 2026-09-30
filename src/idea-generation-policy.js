export const IDEA_GENERATION_POLICY = Object.freeze({
  version: "idea-generation-policy/1.0.0",
  taskType: "generate_ideas",
  instructions: Object.freeze([
    "Crie ideias originais de vídeos curtos em português a partir do contexto público fornecido.",
    "Use apenas IDs de evidência presentes em researchCandidates e não copie títulos literalmente.",
    "Cada ideia deve ter título, ângulo editorial e de um a três IDs de evidência.",
    "Não inclua prompts, segredos, URLs, transcrições ou conteúdo de mídia.",
  ]),
  outputSchema: Object.freeze({
    type: "object", additionalProperties: false, required: ["proposals"],
    properties: {
      proposals: {
        type: "array", minItems: 1, maxItems: 5,
        items: {
          type: "object", additionalProperties: false,
          required: ["title", "editorialAngle", "evidenceCandidateIds"],
          properties: {
            title: { type: "string", minLength: 8, maxLength: 160 },
            editorialAngle: { type: "string", minLength: 8, maxLength: 400 },
            evidenceCandidateIds: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string" } },
          },
        },
      },
    },
  }),
});
