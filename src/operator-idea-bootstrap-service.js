import { createHash } from "node:crypto";
import { PIPELINE_HANDOFF_CONTRACT_VERSION, validatePipelineHandoffRequest } from "./project-pipeline-handoff.js";
import { STAGE_RECOVERY_CONTRACT_VERSION } from "./domain/stage-recovery-contracts.js";

export class OperatorIdeaBootstrapService {
  constructor({ pipelineRuns, researchInputs, research, shortlist, ideas, generator, store, researchConfig, stages = null, generatorConfigurationHash = null, clock = () => new Date() }) {
    Object.assign(this, { pipelineRuns, researchInputs, research, shortlist, ideas, generator, store, researchConfig, stages, generatorConfigurationHash, clock });
  }

  async start(value) {
    const handoff = validatePipelineHandoffRequest(value);
    const run = this.pipelineRuns.start(handoff);
    try {
      const prior = this.ideas.listByPipelineRun(run.pipelineRunId);
      if (prior.length > 0) return Object.freeze({ run, candidates: prior });
      const logicalDate = new Intl.DateTimeFormat("en-CA", { timeZone: run.projectSnapshot.channel.publishing.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(run.startedAt));
      const researchInput = this.researchInputs.create({ handoff, window: { logicalDate } });
      const daily = await this.#stage(stageRequest(run.pipelineRunId, "RESEARCH", hash(researchInput), [], { research: researchInput.schemaVersion }, null),
        () => this.research({ store: this.store, researchInput, config: this.researchConfig }), (value) => ({ artifactId: value.artifact.artifactId, contentHash: value.artifact.contentHash, value }));
      const researchShortlist = this.shortlist({ store: this.store, researchInput, researchTopicCatalog: daily.artifact, clock: this.clock });
      if (researchShortlist.orderedCandidates.length === 0) throw failure("IDEA_RESEARCH_EMPTY", "researchShortlist", "a pesquisa não produziu evidência elegível");
      const ideaRequestHash = hash({ pipelineRunId: run.pipelineRunId, researchShortlistId: researchShortlist.artifactId, researchShortlistHash: researchShortlist.contentHash, projectVersion: run.projectVersion });
      const generated = await this.#stage(stageRequest(run.pipelineRunId, "IDEA_GENERATION", ideaRequestHash, [{ stage: "RESEARCH", artifactId: daily.artifact.artifactId, contentHash: daily.artifact.contentHash }], { ideaGeneration: "idea-generation/1.0.0" }, this.generatorConfigurationHash),
        () => this.generator.generate({ projectSnapshot: run.projectSnapshot, shortlist: researchShortlist }), (value) => ({ artifactId: `idea-proposals:${ideaRequestHash.slice(0, 24)}`, contentHash: hash(value), value }));
      const ideaBatchId = `idea-batch:${hash({ pipelineRunId: run.pipelineRunId, researchShortlistId: researchShortlist.artifactId }).slice(0, 24)}`;
      const createdAt = new Date(this.clock()).toISOString();
      const proposals = generated.map((proposal, index) => ({
        ideaCandidateId: `idea-candidate:${hash({ ideaBatchId, index, title: proposal.title, editorialAngle: proposal.editorialAngle }).slice(0, 24)}`,
        ...proposal, referenceInsightId: null, referenceEvidenceIds: [],
      }));
      const candidates = this.ideas.registerBatch({ ideaBatchId, pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: run.projectVersion, researchShortlistId: researchShortlist.artifactId, origin: "EXTERNAL_CONSUMER", createdAt, proposals });
      return Object.freeze({ run, candidates });
    } catch (caught) {
      if (run.state === "RUNNING") this.pipelineRuns.fail(run.pipelineRunId, { completedAt: new Date(this.clock()).toISOString(), error: publicError(caught) });
      throw caught;
    }
  }

  async #stage(request, operation, describe) { if (!this.stages) return operation(); const completed = await this.stages.execute(request, async () => describe(await operation())); return completed.value; }
}

function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function failure(code, field, message) { const error = new Error(message); error.code = code; error.field = field; return error; }
function publicError(value) { return { code: safeToken(value?.code), field: safeField(value?.field ?? value?.path) }; }
function safeToken(value) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : "RUN_BOOTSTRAP_FAILED"; }
function safeField(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(value) ? value : "run"; }
function stageRequest(pipelineRunId, stage, requestHash, inputs, policyVersions, providerConfigHash) { return { schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION, pipelineRunId, stage, requestHash, inputs, policyVersions, providerConfigHash }; }
export function operatorRunRequest({ pipelineRunId, projectId, projectVersion, startedAt }) { return { schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION, pipelineRunId, projectId, projectVersion, startedAt }; }
