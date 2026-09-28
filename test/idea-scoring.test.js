import test from "node:test";
import assert from "node:assert/strict";
import { createIdeaCandidates, scoreIdeaCandidates } from "../src/idea-scoring.js";

test("normaliza conteúdo, deriva intenção do snapshot e produz score reproduzível", () => {
  const first = build();
  const second = build();
  assert.deepEqual(first, second);
  assert.equal(first.ideas[0].title, "IA para organizar a rotina");
  assert.deepEqual(first.ideas[0].editorialIntent, {
    audienceProfile: "Pessoas interessadas em tecnologia", language: "pt-BR",
  });
  assert.equal(first.scores[0].components.evidenceStrength.evidenceIds[0], "candidate-1");
  assert.ok(first.scores.every(({ total }) => total >= 0 && total <= 1));
});

test("ideia única mantém novidade e diversidade indisponíveis", () => {
  const context = fixture();
  const ideas = createIdeaCandidates({ ...context, proposals: context.proposals.slice(0, 1) });
  const [score] = scoreIdeaCandidates({ ideas, projectSnapshot: context.projectSnapshot, shortlist: context.shortlist });
  for (const name of ["novelty", "diversity"]) {
    assert.deepEqual(score.components[name], {
      availability: "UNAVAILABLE", value: null,
      weight: name === "novelty" ? 0.15 : 0.1,
      reason: "SINGLE_IDEA_BATCH", evidenceIds: [], contribution: null,
    });
  }
});

test("empates usam identidade e ID estáveis", () => {
  const context = fixture();
  context.proposals = [
    { ...context.proposals[0], title: "IA ferramentas para trabalho", ideaCandidateId: "idea_candidate_b" },
    { ...context.proposals[0], title: "Trabalho para ferramentas IA", ideaCandidateId: "idea_candidate_a" },
  ];
  const ideas = createIdeaCandidates(context);
  const scores = scoreIdeaCandidates({ ideas, projectSnapshot: context.projectSnapshot, shortlist: context.shortlist });
  assert.deepEqual(scores.map(({ ideaCandidateId, rank }) => [ideaCandidateId, rank]), [
    ["idea_candidate_a", 1], ["idea_candidate_b", 2],
  ]);
});

function build() {
  const context = fixture();
  const ideas = createIdeaCandidates(context);
  return { ideas, scores: scoreIdeaCandidates({ ideas, projectSnapshot: context.projectSnapshot, shortlist: context.shortlist }) };
}

function fixture() {
  return {
    ideaBatchId: "idea_batch_1", pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    researchShortlistId: "research-shortlist:001", origin: "OPERATOR",
    createdAt: "2026-09-28T12:00:00.000Z",
    projectSnapshot: {
      project: { niche: "inteligência artificial", subniches: ["ferramentas", "produtividade"], audience: { profile: "Pessoas interessadas em tecnologia", language: "pt-BR" } },
      channel: { format: "short_video", minDurationSeconds: 25, maxDurationSeconds: 45, editorialStyle: "informative" },
    },
    shortlist: {
      artifactId: "research-shortlist:001", contentHash: "d".repeat(64),
      rights: { usageCondition: "REFERENCE_ONLY", mediaDownloaded: false, republicationAllowed: false },
      orderedCandidates: [
        { candidate: { id: "candidate-1" }, score: { value: 80, confidence: 1 }, cluster: { id: "cluster-a" } },
        { candidate: { id: "candidate-2" }, score: { value: 60, confidence: 0.5 }, cluster: { id: "cluster-b" } },
      ],
    },
    proposals: [
      { ideaCandidateId: "idea_candidate_b", title: "  IA   para organizar a rotina ", editorialAngle: "Ferramentas práticas para produtividade", evidenceCandidateIds: ["candidate-1"], referenceInsightId: null, referenceEvidenceIds: [] },
      { ideaCandidateId: "idea_candidate_a", title: "Ferramentas de IA no trabalho", editorialAngle: "Exemplos seguros para profissionais de tecnologia", evidenceCandidateIds: ["candidate-2"], referenceInsightId: null, referenceEvidenceIds: [] },
    ],
  };
}
