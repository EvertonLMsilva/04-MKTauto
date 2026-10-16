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
export interface OperationsRepository {
  close(): void;
  startRun(value: {
    execution: Execution;
    projectSnapshot: ProjectSnapshot;
  }): PipelineRun;
  getRun(id: string): PipelineRun | null;
  listRunsByProjectVersion(id: string, version: number): PipelineRun[];
  transitionRun(value: {
    pipelineRunId: string;
    nextState: string;
    completedAt?: string;
    error?: unknown;
  }): PipelineRun;
  resumeRun(value: { pipelineRunId: string; resumedAt: string }): PipelineRun;
}
export interface StageRepository {
  findSucceeded(value: unknown): StageAttempt | null;
  getLatestAttempt(id: string, stage: string): StageAttempt | null;
  listAttempts(id: string): StageAttempt[];
  startAttempt(
    value: unknown,
    options: { trigger: string; startedAt: string },
  ): StageAttempt;
  succeed(
    id: number,
    value: {
      completedAt: string;
      artifactId: string;
      artifactContentHash: string;
      result: unknown;
    },
  ): StageAttempt;
  fail(
    id: number,
    value: { completedAt: string; error: unknown },
  ): StageAttempt;
}
export interface OperationsSession extends OperationsRepository {
  readonly stages: StageRepository;
}
export interface OperationsStore {
  open(readOnly?: boolean): OperationsSession;
}
