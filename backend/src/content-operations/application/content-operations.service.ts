import type { OperationsStore } from './ports/operations.port.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import { validateProjectSnapshot } from '../../project/domain/project-contracts.js';
import {
  OperationsError,
  validateHandoff,
} from '../domain/operations-contracts.js';
import { StageRecoveryService } from './stage-recovery.service.js';

// Lifecycle only. No producers, scheduler or external adapters are injected.
export class ContentOperationsService {
  constructor(
    private readonly store: OperationsStore,
    private readonly projects: ProjectSnapshotReader,
    private readonly affiliate: AffiliateRunContext,
  ) {}
  async start(value: unknown) {
    const execution = validateHandoff(value);
    const selected = await this.projects.get(
      execution.projectId,
      execution.projectVersion,
    );
    if (!selected)
      throw new OperationsError('PROJECT_SNAPSHOT_NOT_FOUND', 'projectVersion');
    const snapshot = validateProjectSnapshot(selected);
    if (snapshot.project.id !== execution.projectId)
      throw new OperationsError('SNAPSHOT_PROJECT_MISMATCH', 'projectId');
    if (snapshot.project.version !== execution.projectVersion)
      throw new OperationsError('SNAPSHOT_VERSION_MISMATCH', 'projectVersion');
    const session = this.store.open();
    try {
      return session.startRun({ execution, projectSnapshot: snapshot });
    } finally {
      session.close();
    }
  }
  get(id: string) {
    const session = this.store.open(true);
    try {
      const run = session.getRun(id);
      if (!run)
        throw new OperationsError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      return run;
    } finally {
      session.close();
    }
  }
  list(projectId: string, version: number) {
    const session = this.store.open(true);
    try {
      return session.listRunsByProjectVersion(projectId, version);
    } finally {
      session.close();
    }
  }
  transition(
    id: string,
    nextState: string,
    completedAt: string,
    error?: unknown,
  ) {
    const session = this.store.open();
    try {
      return session.transitionRun({
        pipelineRunId: id,
        nextState,
        completedAt,
        error,
      });
    } finally {
      session.close();
    }
  }
  resume(id: string, resumedAt: string) {
    const session = this.store.open();
    try {
      return session.resumeRun({ pipelineRunId: id, resumedAt });
    } finally {
      session.close();
    }
  }
  checkpoints(id: string) {
    const session = this.store.open(true);
    try {
      if (!session.getRun(id))
        throw new OperationsError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      return new StageRecoveryService(session.stages).getStatuses(id);
    } finally {
      session.close();
    }
  }
  resolveAffiliateBriefing(id: string, expectedBriefingId?: string) {
    this.get(id);
    return this.affiliate.resolveRunBriefing(id, expectedBriefingId);
  }
}
