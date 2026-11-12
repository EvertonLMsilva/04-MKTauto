import { multiPieceRegistration } from './multi-piece-plan.contract.js';
import { MultiPiecePlanRepository } from './multi-piece-plan.repository.js';

// Explicit composition only: no Nest provider, controller, schema installer or timer.
export class MultiPiecePlanService {
  constructor(private readonly repository: MultiPiecePlanRepository) {}
  async registerPlan(raw: unknown) {
    // Recompute with E-008 before any storage call; supplied IDs/hashes are not proof.
    return this.repository.registerPlan(multiPieceRegistration(raw));
  }
  getPlanByHash(hash: string) {
    return this.repository.getPlanByHash(hash);
  }
  listPlansByProject(projectId: string) {
    return this.repository.listPlansByProject(projectId);
  }
  listPiecesByPlan(hash: string) {
    return this.repository.listPiecesByPlan(hash);
  }
  listOccurrencesByPlan(hash: string) {
    return this.repository.listOccurrencesByPlan(hash);
  }
}
