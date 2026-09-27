import { ContractValidationError } from "./domain/contracts.js";
import {
  RESEARCH_INPUT_CONTRACT_VERSION,
  createResearchInput,
  validateResearchWindow,
} from "./domain/research-contracts.js";
import {
  resolvePipelineHandoff,
  validatePipelineHandoffRequest,
} from "./project-pipeline-handoff.js";

export class ResearchInputService {
  constructor(repository) {
    if (!repository || typeof repository.get !== "function") {
      throw new ContractValidationError("INVALID_REPOSITORY", "repository", "repositório de projetos obrigatório");
    }
    this.repository = repository;
  }

  create(value) {
    validateRequest(value);
    const handoff = validatePipelineHandoffRequest(value.handoff);
    const window = validateResearchWindow(value.window);
    const resolved = resolvePipelineHandoff(this.repository, handoff);
    return createResearchInput({
      schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
      execution: resolved.execution,
      window,
      projectSnapshot: resolved.projectSnapshot,
    });
  }
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError("INVALID_TYPE", "request", "deve ser um objeto");
  }
  for (const key of Object.keys(value)) {
    if (!["handoff", "window"].includes(key)) {
      throw new ContractValidationError("UNKNOWN_FIELD", `request.${key}`, "campo não permitido");
    }
  }
  for (const key of ["handoff", "window"]) {
    if (!(key in value)) throw new ContractValidationError("REQUIRED_FIELD", key, "campo obrigatório");
  }
}
