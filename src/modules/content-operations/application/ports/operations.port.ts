import type { Io } from '../../infrastructure/sqlite-operations.repository.js';
import type {
  Execution,
  PipelineRun,
} from '../../domain/operations-contracts.js';
import type { ProjectSnapshot } from '../../../project/application/ports/project-snapshot-reader.port.js';
import type { StageAttempt } from '../../domain/stage-contracts.js';
export const CONTENT_OPERATIONS_DATABASE = Symbol(
  'CONTENT_OPERATIONS_DATABASE',
);
export const CONTENT_OPERATIONS_STORE = Symbol('CONTENT_OPERATIONS_STORE');
export const CONTENT_OPERATIONS = Symbol('CONTENT_OPERATIONS');
export interface OperationsRepository<A extends boolean = false> {
  close(): Io<A, void>;
  startRun(value: {
    execution: Execution;
    projectSnapshot: ProjectSnapshot;
  }): Io<A, PipelineRun>;
  getRun(id: string): Io<A, PipelineRun | null>;
  listRunsByProjectVersion(id: string, version: number): Io<A, PipelineRun[]>;
  transitionRun(value: {
    pipelineRunId: string;
    nextState: string;
    completedAt?: string;
    error?: unknown;
  }): Io<A, PipelineRun>;
  resumeRun(value: {
    pipelineRunId: string;
    resumedAt: string;
  }): Io<A, PipelineRun>;
}
export interface StageRepository<A extends boolean = false> {
  findSucceeded(value: unknown): Io<A, StageAttempt | null>;
  getLatestAttempt(id: string, stage: string): Io<A, StageAttempt | null>;
  listAttempts(id: string): Io<A, StageAttempt[]>;
  startAttempt(
    value: unknown,
    options: {
      trigger: string;
      startedAt: string;
    },
  ): Io<A, StageAttempt>;
  succeed(
    id: number,
    value: {
      completedAt: string;
      artifactId: string;
      artifactContentHash: string;
      result: unknown;
    },
  ): Io<A, StageAttempt>;
  fail(
    id: number,
    value: {
      completedAt: string;
      error: unknown;
    },
  ): Io<A, StageAttempt>;
}
export interface OperationsSession<
  A extends boolean = false,
> extends OperationsRepository<A> {
  readonly stages: StageRepository<A>;
}
export interface OperationsStore<A extends boolean = false> {
  open(readOnly?: boolean): Io<A, OperationsSession<A>>;
}
