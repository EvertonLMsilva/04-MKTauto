import { candidateResponseSchema, validateCandidates } from "../domain/contracts.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export async function identifyCandidates({ apiKey, model, signals, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");
  if (!signals.length) throw new Error("Nenhum sinal disponível para análise");

  const response = await fetchImpl(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Você identifica micronichos editoriais em pt-BR somente a partir das evidências fornecidas.",
        "Agrupe assuntos equivalentes, cite IDs existentes e nunca invente métricas ou direitos.",
        "YouTube em alta confirma interesse em vídeo, mas não concede direito de adaptação:",
        "marque greenSource=false até revisão humana com licença ou autorização independente.",
        "Use notas entre 0 e 100 para os componentes; não calcule a nota final.",
      ].join(" "),
      input: JSON.stringify({ region: "BR", language: "pt-BR", signals }),
      text: {
        format: {
          type: "json_schema",
          name: "niche_candidates",
          strict: true,
          schema: candidateResponseSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI Responses API respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = await response.json();
  const text = extractOutputText(body);
  const parsed = JSON.parse(text);
  const candidates = validateCandidates(parsed, signals.map((signal) => signal.id));

  return candidates.map((candidate) => ({
    ...candidate,
    gates: { ...candidate.gates, greenSource: false },
  }));
}

export function extractOutputText(response) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("A resposta da OpenAI não contém output_text");
}

