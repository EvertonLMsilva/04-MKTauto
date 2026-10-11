import {
  candidateResponseSchema,
  validateAiTopicProposal,
  validateCandidates,
} from "../domain/contracts.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const CLUSTERING_BATCH_SIZE = 8;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;
const ollamaResponseSchema = structuredClone(candidateResponseSchema);
ollamaResponseSchema.properties.candidates.items.properties.evidenceIds.minItems = 2;
ollamaResponseSchema.properties.candidates.items.properties.evidenceIds.uniqueItems = true;
const topicProposalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["clusters"],
  properties: {
    clusters: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label", "niche", "subtheme", "likelyAudience", "narrativePattern",
          "localization", "candidateRefs", "explanation",
        ],
        properties: {
          label: { type: "string" },
          niche: { type: "string" },
          subtheme: { type: "string" },
          likelyAudience: { type: "string" },
          narrativePattern: { type: "string" },
          localization: { type: "string" },
          candidateRefs: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^C[0-9]{3}$" } },
          explanation: { type: "string" },
        },
      },
    },
  },
};

export async function proposeTopicClusters({
  model,
  evidence,
  language = "pt-BR",
  context,
  validationFeedback,
  baseUrl = DEFAULT_BASE_URL,
  numCtx = 16_384,
  fetchImpl = fetch,
}) {
  if (!model) throw new Error("OLLAMA_MODEL não configurado");
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error("Nenhuma evidência disponível para agrupamento");
  if (!Number.isInteger(numCtx) || numCtx < 8_192) throw new Error("OLLAMA_NUM_CTX deve ser um inteiro de pelo menos 8192");
  const candidateIds = evidence.map(({ candidateId }) => candidateId);
  const candidateIdByRef = new Map(evidence.map(({ candidateId }, index) => [`C${String(index + 1).padStart(3, "0")}`, candidateId]));
  const candidateRefById = new Map([...candidateIdByRef].map(([reference, candidateId]) => [candidateId, reference]));
  const snapshotsByCandidate = new Map(evidence.map(({ candidateId, snapshots }) => [
    candidateId,
    (snapshots ?? []).map(({ id }) => id),
  ]));
  const snapshotIds = [...snapshotsByCandidate.values()].flat();
  const clusteringEvidence = evidence.map(({ candidateId, snapshots: _snapshots, ...item }) => ({
    candidateRef: candidateRefById.get(candidateId),
    ...item,
  }));

  const requestClusters = async ({ items, requiredReferences, feedback }) => {
    const response = await fetchImpl(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        think: false,
        format: topicProposalSchema,
        options: { temperature: 0, num_ctx: numCtx },
        messages: [{
          role: "user",
          content: [
            `Agrupe no idioma BCP 47 ${language} somente as evidências fornecidas por assunto editorial equivalente.`,
            "Rotule nicho, subtema, público provável, padrão narrativo e localização para o contexto editorial informado.",
            `Contexto editorial: ${JSON.stringify(context ?? {})}.`,
            "Use exclusivamente candidateRef existentes na entrada, preservando cada alias exatamente.",
            "Inclua cada candidateRef fornecido exatamente uma vez em um único cluster.",
            `Aliases obrigatórios: ${requiredReferences.join(", ")}.`,
            "Não devolva snapshotIds; o sistema associa as evidências temporais deterministicamente.",
            "Não devolva candidateIds, IDs próprios, URLs, métricas, direitos, estados, scores, posições ou qualquer campo fora do schema.",
            ...(feedback ? [`Correção obrigatória da tentativa anterior: ${sanitizeFeedback(feedback)}`] : []),
            `Schema: ${JSON.stringify(topicProposalSchema)}`,
            `Evidências: ${JSON.stringify(items)}`,
          ].join(" "),
        }],
      }),
    });
    if (!response.ok) throw new Error(`Ollama respondeu ${response.status}`);
    const content = await readChatContent(response);
    if (typeof content !== "string" || content.trim() === "") throw new Error("A resposta do Ollama não contém message.content");
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.clusters)) throw new Error("A resposta do Ollama não contém clusters[]");
    return parsed.clusters;
  };

  const knownReferences = [...candidateIdByRef.keys()];
  const clusters = [];
  for (let offset = 0; offset < clusteringEvidence.length; offset += CLUSTERING_BATCH_SIZE) {
    const items = clusteringEvidence.slice(offset, offset + CLUSTERING_BATCH_SIZE);
    const requiredReferences = items.map(({ candidateRef }) => candidateRef);
    let batchClusters = await requestClusters({ items, requiredReferences, feedback: validationFeedback });
    const initialProblems = candidateRefProblems(batchClusters, requiredReferences);
    if (initialProblems.unknown.length > 0 || initialProblems.duplicated.length > 0) throwCandidateRefProblems(initialProblems);
    if (initialProblems.missing.length > 0) {
      const missing = initialProblems.missing;
      const missingSet = new Set(missing);
      const repair = await requestClusters({
        items: items.filter(({ candidateRef }) => missingSet.has(candidateRef)),
        requiredReferences: missing,
        feedback: `Complete somente os aliases ausentes: ${missing.join(", ")}.`,
      });
      validateCompleteCandidateRefs(repair, missing);
      batchClusters = [...batchClusters, ...repair];
    }
    validateCompleteCandidateRefs(batchClusters, requiredReferences);
    clusters.push(...batchClusters);
  }
  validateCompleteCandidateRefs(clusters, knownReferences);
  return clusters.map((proposal) => {
    if (proposal && (Object.hasOwn(proposal, "evidenceSnapshotIds") || Object.hasOwn(proposal, "candidateIds"))) {
      const error = new Error("AI_EVIDENCE_MUTATION em aiProposal: IDs reais e snapshots são derivados pelo sistema");
      error.code = "AI_EVIDENCE_MUTATION";
      throw error;
    }
    const references = Array.isArray(proposal?.candidateRefs) ? proposal.candidateRefs : [];
    const unknownReference = references.find((reference) => !candidateIdByRef.has(reference));
    if (unknownReference) {
      const error = new Error(`UNKNOWN_EVIDENCE em aiProposal.candidateRefs: alias desconhecido: ${unknownReference}`);
      error.code = "UNKNOWN_EVIDENCE";
      throw error;
    }
    const clusterCandidateIds = references.map((reference) => candidateIdByRef.get(reference));
    const evidenceSnapshotIds = [...new Set(clusterCandidateIds.flatMap((candidateId) => snapshotsByCandidate.get(candidateId) ?? []))];
    const { candidateRefs: _candidateRefs, ...semanticProposal } = proposal ?? {};
    return validateAiTopicProposal({ ...semanticProposal, candidateIds: clusterCandidateIds, evidenceSnapshotIds }, candidateIds, snapshotIds);
  });
}

async function readChatContent(response) {
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
    const body = await response.json();
    return body.message?.content;
  }
  const decoder = new TextDecoder();
  let buffered = ""; let content = ""; let total = 0;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (typeof event.message?.content === "string") content += event.message.content;
  };
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_STREAM_BYTES) throw new Error("A resposta do Ollama excede o limite permitido");
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
    lines.forEach(consume);
  }
  buffered += decoder.decode(); consume(buffered);
  return content;
}

function validateCompleteCandidateRefs(clusters, knownReferences) {
  const problems = candidateRefProblems(clusters, knownReferences);
  if (problems.unknown.length === 0 && problems.duplicated.length === 0 && problems.missing.length === 0) return;
  throwCandidateRefProblems(problems);
}

function candidateRefProblems(clusters, knownReferences) {
  const assigned = clusters.flatMap((proposal) => Array.isArray(proposal?.candidateRefs) ? proposal.candidateRefs : []);
  const known = new Set(knownReferences);
  const unknown = [...new Set(assigned.filter((reference) => !known.has(reference)))];
  const counts = new Map();
  for (const reference of assigned) counts.set(reference, (counts.get(reference) ?? 0) + 1);
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([reference]) => reference);
  const assignedSet = new Set(assigned);
  const missing = knownReferences.filter((reference) => !assignedSet.has(reference));
  return { unknown, duplicated, missing };
}

function throwCandidateRefProblems({ unknown, duplicated, missing }) {
  const parts = [];
  if (unknown.length > 0) parts.push(`Remova aliases desconhecidos: ${unknown.join(", ")}.`);
  if (duplicated.length > 0) parts.push(`Mantenha estes aliases em apenas um cluster: ${duplicated.join(", ")}.`);
  if (missing.length > 0) parts.push(`Inclua os aliases ausentes: ${missing.join(", ")}.`);
  const error = new Error(`INVALID_CLUSTER_MEMBERSHIP: ${parts.join(" ")}`);
  error.code = "INVALID_CLUSTER_MEMBERSHIP";
  error.retryFeedback = parts.join(" ");
  throw error;
}

function sanitizeFeedback(value) {
  return String(value).replace(/[^A-Za-z0-9 .,:-]/g, "").slice(0, 500);
}

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
    throw new Error(`Ollama respondeu ${response.status}`);
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
