import { createHash } from 'node:crypto';
import type { StageRepository } from './ports/operations.port.js';
import { immutable, OperationsError } from '../domain/operations-contracts.js';
import {
  PIPELINE_STAGES,
  STAGE_ATTEMPT_TRIGGERS,
  isTransientStageFailure,
  stageExecutionIdentityHash,
  validateStageExecutionRequest,
} from '../domain/stage-contracts.js';
import type {
  StageRequest,
  StageAttempt,
  Produced,
} from '../domain/stage-contracts.js';
export type StageOperation = (
  context: Readonly<{ attempt: number; trigger: string }>,
) => unknown;
export interface RecoveryOptions {
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  maxAutomaticAttempts?: number;
  backoffMilliseconds?: number;
}
export class StageRecoveryService {
  readonly now: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly maxAutomaticAttempts: number;
  readonly backoffMilliseconds: number;
  constructor(
    private readonly repository: StageRepository,
    {
      now = () => new Date().toISOString(),
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      maxAutomaticAttempts = 3,
      backoffMilliseconds = 100,
    }: RecoveryOptions = {},
  ) {
    if (
      !repository ||
      [
        'findSucceeded',
        'getLatestAttempt',
        'listAttempts',
        'startAttempt',
        'succeed',
        'fail',
      ].some(
        (m) =>
          typeof (repository as unknown as Record<string, unknown>)[m] !==
          'function',
      )
    )
      throw new TypeError('repositório de recuperação obrigatório');
    if (
      !Number.isSafeInteger(maxAutomaticAttempts) ||
      maxAutomaticAttempts < 1 ||
      maxAutomaticAttempts > 3
    )
      throw new TypeError('limite automático deve estar entre 1 e 3');
    this.now = now;
    this.sleep = sleep;
    this.maxAutomaticAttempts = maxAutomaticAttempts;
    this.backoffMilliseconds = backoffMilliseconds;
  }
  async execute(
    value: unknown,
    operation: StageOperation,
    { trigger = 'INITIAL' } = {},
  ) {
    const request = validateStageExecutionRequest(value);
    requireTrigger(trigger);
    requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached)
      return immutable({
        ...cached.result,
        reused: true,
        attempt: cached.attempt,
      });
    return this.attempt(request, operation, trigger);
  }
  async retry(value: unknown, operation: StageOperation) {
    const request = validateStageExecutionRequest(value);
    requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached)
      return immutable({
        ...cached.result,
        reused: true,
        attempt: cached.attempt,
      });
    const latest = this.repository.getLatestAttempt(
      request.pipelineRunId,
      request.stage,
    );
    if (
      !latest ||
      latest.state !== 'FAILED' ||
      latest.identityHash !== stageExecutionIdentityHash(request)
    )
      throw new OperationsError('STAGE_RETRY_NOT_ALLOWED', 'stage');
    return this.attempt(request, operation, 'MANUAL');
  }
  async recoverInterrupted(value: unknown, operation: StageOperation) {
    const request = validateStageExecutionRequest(value);
    requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached)
      return immutable({
        ...cached.result,
        reused: true,
        attempt: cached.attempt,
      });
    const latest = this.repository.getLatestAttempt(
      request.pipelineRunId,
      request.stage,
    );
    if (
      !latest ||
      latest.state !== 'RUNNING' ||
      latest.identityHash !== stageExecutionIdentityHash(request)
    )
      throw new OperationsError('STAGE_RECOVERY_NOT_ALLOWED', 'stage');
    this.repository.fail(latest.id, {
      completedAt: this.now(),
      error: { code: 'STAGE_INTERRUPTED', field: 'stage', transient: true },
    });
    return this.attempt(request, operation, 'MANUAL');
  }
  getStatuses(id: string) {
    const latest = new Map<string, StageAttempt>();
    for (const a of this.repository.listAttempts(id)) latest.set(a.stage, a);
    const statuses = new Map<string, ReturnType<typeof status>>();
    for (const stage of PIPELINE_STAGES) {
      const a = latest.get(stage);
      if (!a) {
        statuses.set(stage, status(stage, 'PENDING', null));
        continue;
      }
      let state: string = a.state;
      if (state === 'SUCCEEDED')
        for (const input of a.inputs) {
          const dep = latest.get(input.stage);
          if (
            !dep ||
            statuses.get(input.stage)?.state !== 'SUCCEEDED' ||
            dep.artifactId !== input.artifactId ||
            dep.artifactContentHash !== input.contentHash
          ) {
            state = 'PENDING';
            break;
          }
        }
      statuses.set(stage, status(stage, state, a));
    }
    return Object.freeze(PIPELINE_STAGES.map((s) => statuses.get(s)!));
  }
  private async attempt(
    request: StageRequest,
    operation: StageOperation,
    trigger: string,
  ) {
    let kind = trigger;
    for (let i = 0; i < this.maxAutomaticAttempts; i++) {
      const started = this.repository.startAttempt(request, {
        trigger: kind,
        startedAt: this.now(),
      });
      try {
        const produced = normalizeProduced(
          await operation(
            Object.freeze({ attempt: started.attempt, trigger: kind }),
          ),
        );
        const completed = this.repository.succeed(started.id, {
          completedAt: this.now(),
          artifactId: produced.artifactId,
          artifactContentHash: produced.contentHash,
          result: produced,
        });
        return immutable({
          ...completed.result,
          reused: false,
          attempt: completed.attempt,
        });
      } catch (caught) {
        this.repository.fail(started.id, {
          completedAt: this.now(),
          error: caught,
        });
        if (
          !isTransientStageFailure(caught) ||
          i + 1 >= this.maxAutomaticAttempts
        )
          throw caught;
        await this.sleep(this.backoffMilliseconds * 2 ** i);
        kind = 'AUTOMATIC';
      }
    }
    throw new OperationsError('STAGE_RETRY_EXHAUSTED', 'stage');
  }
}
export function aggregateStageResult(
  stage: string,
  values: { artifactId: string; contentHash: string }[],
) {
  if (!Array.isArray(values) || !values.length)
    throw new OperationsError('STAGE_RESULT_REQUIRED', 'result');
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify(
        values.map(({ artifactId, contentHash }) => ({
          artifactId,
          contentHash,
        })),
      ),
    )
    .digest('hex');
  return immutable({
    artifactId: `${stage.toLowerCase()}:set:${contentHash.slice(0, 24)}`,
    contentHash,
    value: values,
  });
}
function normalizeProduced(v: unknown): Produced {
  if (!v || typeof v !== 'object')
    throw new OperationsError('INVALID_STAGE_RESULT', 'result');
  const r = v as Record<string, unknown>;
  if (
    typeof r.artifactId !== 'string' ||
    r.artifactId.length > 200 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:./-]{1,}$/.test(r.artifactId)
  )
    throw new OperationsError('INVALID_STAGE_RESULT', 'artifactId');
  if (
    typeof r.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.contentHash)
  )
    throw new OperationsError('INVALID_STAGE_RESULT', 'contentHash');
  return immutable({
    artifactId: r.artifactId,
    contentHash: r.contentHash,
    value: r.value ?? null,
  });
}
function status(stage: string, state: string, a: StageAttempt | null) {
  return immutable({
    stage,
    state,
    attempt: a?.attempt ?? 0,
    failure: a?.failure ?? null,
    artifactId: state === 'SUCCEEDED' ? a!.artifactId : null,
    artifactContentHash: state === 'SUCCEEDED' ? a!.artifactContentHash : null,
  });
}
function requireTrigger(v: string) {
  if (!STAGE_ATTEMPT_TRIGGERS.includes(v))
    throw new OperationsError('INVALID_STAGE_TRIGGER', 'trigger');
}
function requireOperation(v: unknown) {
  if (typeof v !== 'function') throw new TypeError('operação obrigatória');
}
