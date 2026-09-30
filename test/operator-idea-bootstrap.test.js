import test from "node:test";
import assert from "node:assert/strict";
import { OperatorIdeaBootstrapService, operatorRunRequest } from "../src/operator-idea-bootstrap-service.js";

const request = operatorRunRequest({ pipelineRunId: "run_operator_001", projectId: "project_operator", projectVersion: 1, startedAt: "2026-09-30T12:00:00.000Z" });

test("bootstrap cria a run, encadeia Research/shortlist e persiste candidatos pela IdeaService", async () => {
  const calls = []; const fixture = dependencies(calls);
  const result = await new OperatorIdeaBootstrapService(fixture).start(request);
  assert.equal(result.run.pipelineRunId, request.pipelineRunId);
  assert.equal(result.candidates[0].idea.pipelineRunId, request.pipelineRunId);
  assert.deepEqual(calls, ["start", "list", "input", "research", "shortlist", "generate", "register"]);
  const submission = fixture.seen.submission;
  assert.equal(submission.origin, "EXTERNAL_CONSUMER");
  assert.equal(submission.researchShortlistId, "research-shortlist:operator");
  assert.deepEqual(submission.proposals[0].evidenceCandidateIds, ["trend_candidate_1"]);
});

test("retry com candidatos persistidos não repete Research nem provider", async () => {
  const calls = []; const fixture = dependencies(calls, [{ idea: { pipelineRunId: request.pipelineRunId }, score: {} }]);
  const result = await new OperatorIdeaBootstrapService(fixture).start(request);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(calls, ["start", "list"]);
});

test("Research sem evidência não cria candidatos nem seleção automática", async () => {
  const calls = []; const fixture = dependencies(calls); fixture.shortlist = () => ({ artifactId: "research-shortlist:empty", orderedCandidates: [] });
  await assert.rejects(() => new OperatorIdeaBootstrapService(fixture).start(request), (error) => error.code === "IDEA_RESEARCH_EMPTY");
  assert.equal(fixture.seen.submission, undefined);
  assert.equal("selections" in fixture, false);
});

function dependencies(calls, prior = []) {
  const seen = {};
  const run = { pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: 1, startedAt: request.startedAt, projectSnapshot: { project: {}, channel: { publishing: { timezone: "America/Sao_Paulo" } } } };
  const shortlist = { artifactId: "research-shortlist:operator", orderedCandidates: [{ candidate: { id: "trend_candidate_1" } }] };
  return { seen,
    pipelineRuns: { start: () => { calls.push("start"); return run; } },
    researchInputs: { create: () => { calls.push("input"); return { execution: request }; } },
    research: async () => { calls.push("research"); return { artifact: { artifactId: "research-artifact:operator" } }; },
    shortlist: () => { calls.push("shortlist"); return shortlist; }, store: {}, researchConfig: {}, clock: () => new Date("2026-09-30T12:01:00.000Z"),
    generator: { generate: async () => { calls.push("generate"); return [{ title: "Uma ideia original útil", editorialAngle: "Explicar o tema com aplicação prática", evidenceCandidateIds: ["trend_candidate_1"] }]; } },
    ideas: { listByPipelineRun: () => { calls.push("list"); return prior; }, registerBatch: (value) => { calls.push("register"); seen.submission = value; return value.proposals.map((idea) => ({ idea: { ...idea, pipelineRunId: value.pipelineRunId }, score: { rank: 1 } })); } },
  };
}
