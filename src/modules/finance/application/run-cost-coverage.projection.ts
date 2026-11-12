import type { PilotCostClosure } from '../domain/pilot-cost-closure.types.js';
import { evaluateRunCostCoverage } from '../domain/run-cost-coverage.evaluator.js';

export function projectRunCostCoverage(
  pipelineRunId: string,
  financial: PilotCostClosure,
  declaration?: unknown,
) {
  return {
    financial,
    coverage: evaluateRunCostCoverage(
      pipelineRunId,
      financial.run,
      declaration,
    ),
  };
}
