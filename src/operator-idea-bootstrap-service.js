import { createHash } from "node:crypto";
import { PIPELINE_HANDOFF_CONTRACT_VERSION, validatePipelineHandoffRequest } from "./project-pipeline-handoff.js";

export class OperatorIdeaBootstrapService {
  constructor({ pipelineRuns, researchInputs, research, shortlist, ideas, generator, store, researchConfig, clock = () => new Date() }) {
    Object.assign(this, { pipelineRuns, researchInputs, research, shortlist, ideas, generator, store, researchConfig, clock });
  }

  async start(value) {
    const handoff = validatePipelineHandoffRequest(value);
    const run = this.pipelineRuns.start(handoff);
    const prior = this.ideas.listByPipelineRun(run.pipelineRunId);
    if (prior.length > 0) return Object.freeze({ run, candidates: prior });
    const logicalDate = new Intl.DateTimeFormat("en-CA", { timeZone: run.projectSnapshot.channel.publishing.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(run.startedAt));
    const researchInput = this.researchInputs.create({ handoff, window: { logicalDate } });
    const daily = await this.research({ store: this.store, researchInput, config: this.researchConfig });
    const researchShortlist = this.shortlist({ store: this.store, researchInput, researchTopicCatalog: daily.artifact, clock: this.clock });
    if (researchShortlist.orderedCandidates.length === 0) throw failure("IDEA_RESEARCH_EMPTY", "researchShortlist", "a pesquisa não produziu evidência elegível");
    const generated = await this.generator.generate({ projectSnapshot: run.projectSnapshot, shortlist: researchShortlist });
    const ideaBatchId = `idea-batch:${hash({ pipelineRunId: run.pipelineRunId, researchShortlistId: researchShortlist.artifactId }).slice(0, 24)}`;
    const createdAt = new Date(this.clock()).toISOString();
    const proposals = generated.map((proposal, index) => ({
      ideaCandidateId: `idea-candidate:${hash({ ideaBatchId, index, title: proposal.title, editorialAngle: proposal.editorialAngle }).slice(0, 24)}`,
      ...proposal, referenceInsightId: null, referenceEvidenceIds: [],
    }));
    const candidates = this.ideas.registerBatch({ ideaBatchId, pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: run.projectVersion, researchShortlistId: researchShortlist.artifactId, origin: "EXTERNAL_CONSUMER", createdAt, proposals });
    return Object.freeze({ run, candidates });
  }
}

function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function failure(code, field, message) { const error = new Error(message); error.code = code; error.field = field; return error; }
export function operatorRunRequest({ pipelineRunId, projectId, projectVersion, startedAt }) { return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId, projectId, projectVersion, startedAt }; }
