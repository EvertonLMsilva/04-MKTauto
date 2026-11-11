import {
  runCampaignIo,
  type Io,
} from '../infrastructure/sqlite-operations.repository.js';
import type { PipelineRun } from '../domain/operations-contracts.js';
import type { AffiliateBriefing } from '../../affiliate/domain/affiliate-contracts.js';
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
export class ContentOperationsService<A extends boolean = false> {
  constructor(
    private readonly store: OperationsStore<A>,
    private readonly projects: ProjectSnapshotReader,
    private readonly affiliate: Pick<
      AffiliateRunContext<boolean>,
      'resolveRunBriefing'
    >,
  ) {}
  async start(value: unknown): Promise<PipelineRun> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const execution = validateHandoff(value);
        const selected = yield yield this.projects.get(
          execution.projectId,
          execution.projectVersion,
        );
        if (!selected)
          throw new OperationsError(
            'PROJECT_SNAPSHOT_NOT_FOUND',
            'projectVersion',
          );
        const snapshot = validateProjectSnapshot(selected);
        if (snapshot.project.id !== execution.projectId)
          throw new OperationsError('SNAPSHOT_PROJECT_MISMATCH', 'projectId');
        if (snapshot.project.version !== execution.projectVersion)
          throw new OperationsError(
            'SNAPSHOT_VERSION_MISMATCH',
            'projectVersion',
          );
        const session = yield this.store.open();
        try {
          return yield session.startRun({
            execution,
            projectSnapshot: snapshot,
          });
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  get(id: string): Io<A, PipelineRun> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.store.open(true);
        try {
          const run = yield session.getRun(id);
          if (!run)
            throw new OperationsError(
              'PIPELINE_RUN_NOT_FOUND',
              'pipelineRunId',
            );
          return run;
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  list(projectId: string, version: number): Io<A, PipelineRun[]> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.store.open(true);
        try {
          return yield session.listRunsByProjectVersion(projectId, version);
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  transition(
    id: string,
    nextState: string,
    completedAt: string,
    error?: unknown,
  ): Io<A, PipelineRun> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.store.open();
        try {
          return yield session.transitionRun({
            pipelineRunId: id,
            nextState,
            completedAt,
            error,
          });
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  resume(id: string, resumedAt: string): Io<A, PipelineRun> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.store.open();
        try {
          return yield session.resumeRun({ pipelineRunId: id, resumedAt });
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  checkpoints(
    id: string,
  ): Io<A, Awaited<ReturnType<StageRecoveryService['getStatuses']>>> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const session = yield this.store.open(true);
        try {
          if (!(yield session.getRun(id)))
            throw new OperationsError(
              'PIPELINE_RUN_NOT_FOUND',
              'pipelineRunId',
            );
          return yield new StageRecoveryService(session.stages).getStatuses(id);
        } finally {
          yield session.close();
        }
      }.call(this),
    );
  }
  resolveAffiliateBriefing(
    id: string,
    expectedBriefingId?: string,
  ): Io<A, AffiliateBriefing | null> {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.get(id);
        return yield this.affiliate.resolveRunBriefing(id, expectedBriefingId);
      }.call(this),
    );
  }
}
