import { candidateResponseSchema, validateCandidates } from "../domain/contracts.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const ollamaResponseSchema = structuredClone(candidateResponseSchema);
ollamaResponseSchema.properties.candidates.items.properties.evidenceIds.minItems = 2;
ollamaResponseSchema.properties.candidates.items.properties.evidenceIds.uniqueItems = true;

export async function identifyCandidates({
  model,
  signals,
  baseUrl = DEFAULT_BASE_URL,
  numCtx = 16_384,
  fetchImpl = fetch,
}) {
  if (!model) throw new Error("OLLAMA_MODEL não configurado");
  if (!signals.length) throw new Error("Nenhum sinal disponível para análise");
  if (!Number.isInteger(numCtx) || numCtx < 8_192) {
    throw new Error("OLLAMA_NUM_CTX deve ser um inteiro de pelo menos 8192");
  }

  const response = await fetchImpl(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: ollamaResponseSchema,
      options: { temperature: 0, num_ctx: numCtx },
      messages: [{
        role: "user",
        content: [
          "Identifique exatamente 20 micronichos editoriais em pt-BR somente a partir das evidências fornecidas.",
          "Agrupe assuntos equivalentes, cite somente IDs existentes e nunca invente métricas ou direitos.",
          "Cada candidato deve citar ao menos duas evidências distintas que sustentem o agrupamento.",
          "Os 20 nomes devem ser únicos; não repita nem duplique candidatos.",
          "O campo name deve ser um tema editorial reutilizável de 3 a 8 palavras, nunca o título de um vídeo, chamada sensacionalista ou nome de uma obra específica.",
          "Exemplos de forma: lançamentos de motos utilitárias; jogos independentes brasileiros; alertas climáticos explicados.",
          "Use a taxonomia ampla de macroNiche fornecida no schema; assuntos relacionados devem compartilhar o mesmo macroNiche.",
          "O conjunto final deve conter ao menos cinco macroNiche distintos e no máximo quatro candidatos por macroNiche.",
          "Use sourceCategory para preservar diversidade, mas confirme cada agrupamento pelos títulos e métricas das evidências.",
          "YouTube em alta confirma interesse em vídeo, mas não concede direito de adaptação:",
          "marque greenSource=false até revisão humana com licença ou autorização independente.",
          "Use notas entre 0 e 100 para os componentes; não calcule a nota final.",
          `Responda conforme este JSON Schema: ${JSON.stringify(ollamaResponseSchema)}`,
          `Entrada: ${JSON.stringify({ region: "BR", language: "pt-BR", signals })}`,
        ].join(" "),
      }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("A resposta do Ollama não contém message.content");
  }
  const candidates = validateCandidates(
    JSON.parse(content),
    signals.map((signal) => signal.id),
  );

  return candidates.map((candidate) => ({
    ...candidate,
    gates: {
      ...candidate.gates,
      multipleSignals: candidate.evidenceIds.length >= 2,
      greenSource: false,
      knownOrigin: true,
    },
  }));
}
