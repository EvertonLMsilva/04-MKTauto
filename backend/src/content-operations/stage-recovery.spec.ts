import { historicalResidualPersistence } from '../../test/support/historical-residual-persistence.js';
import { historicalResidualContracts } from '../../test/support/historical-residual-contracts.js';
import {
  affiliateRunFixture,
  outcome,
} from '../../test/support/affiliate-run-fixture.js';
import { SqliteOperationsRepository } from './infrastructure/sqlite-operations.repository.js';
import { StageRecoveryRepository } from './infrastructure/stage-recovery.repository.js';
import { StageRecoveryService } from './application/stage-recovery.service.js';
import {
  stageExecutionIdentityHash,
  validateStageExecutionRequest,
} from './domain/stage-contracts.js';
const legacyContracts = historicalResidualContracts('stage-recovery-contracts');
const legacy = historicalResidualPersistence('stage-recovery-repository');
const legacyService = historicalResidualPersistence('stage-recovery-service');
const req = (id = 'run_001') => ({
  schemaVersion: 'stage-recovery/1.0.0',
  pipelineRunId: id,
  stage: 'RESEARCH',
  requestHash: 'a'.repeat(64),
  inputs: [],
  policyVersions: { research: 'policy/1' },
  providerConfigHash: null,
});
describe('Stage checkpoints and recovery parity', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  let session: SqliteOperationsRepository;
  let repository: StageRecoveryRepository;
  let oracle: InstanceType<typeof legacy.StageRecoveryRepository>;
  const now = () => '2026-10-14T12:01:00.000Z';
  beforeEach(() => {
    fixture = affiliateRunFixture();
    session = new SqliteOperationsRepository(fixture.database);
    repository = new StageRecoveryRepository(session);
    oracle = new legacy.StageRecoveryRepository(fixture.database);
  });
  afterEach(() => {
    oracle?.close();
    session?.close();
    fixture?.cleanup();
  });
  it('keeps normalized identities, dependency validation and public failures', () => {
    for (const input of [
      req(),
      { ...req(), stage: 'UNKNOWN' },
      {
        ...req(),
        inputs: [
          {
            stage: 'SCRIPT',
            artifactId: 'script:one',
            contentHash: 'b'.repeat(64),
          },
        ],
      },
      { ...req(), extra: true },
    ]) {
      expect(outcome(() => validateStageExecutionRequest(input))).toEqual(
        outcome(() => legacyContracts.validateStageExecutionRequest(input)),
      );
    }
    expect(stageExecutionIdentityHash(req())).toBe(
      legacyContracts.stageExecutionIdentityHash(req()),
    );
  });
  it('reserves exclusively, persists receipts, replays without invoking callbacks', async () => {
    const service = new StageRecoveryService(repository, { now });
    const operation = vi.fn(async () => ({
      artifactId: 'research:one',
      contentHash: 'b'.repeat(64),
      value: { evidence: true },
    }));
    const result = await service.execute(req(), operation);
    const cached = await service.execute(req(), operation);
    expect(cached).toEqual({ ...result, reused: true });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(repository.findSucceeded(req())).toEqual(
      oracle.findSucceeded(req()),
    );
    expect(service.getStatuses('run_001')).toEqual(
      new legacyService.StageRecoveryService(oracle).getStatuses('run_001'),
    );
    repository.startAttempt(
      { ...req(), requestHash: 'c'.repeat(64) },
      { trigger: 'INITIAL', startedAt: now() },
    );
    expect(
      outcome(() =>
        repository.startAttempt(req(), {
          trigger: 'INITIAL',
          startedAt: now(),
        }),
      ),
    ).toEqual(
      outcome(() =>
        oracle.startAttempt(req(), { trigger: 'INITIAL', startedAt: now() }),
      ),
    );
  });
  it('recovers only the interrupted identity and preserves failure history', async () => {
    repository.startAttempt(req(), { trigger: 'INITIAL', startedAt: now() });
    const service = new StageRecoveryService(repository, { now });
    const operation = vi.fn(async () => ({
      artifactId: 'research:two',
      contentHash: 'b'.repeat(64),
      value: null,
    }));
    await expect(
      service.recoverInterrupted(
        { ...req(), requestHash: 'c'.repeat(64) },
        operation,
      ),
    ).rejects.toMatchObject({ code: 'STAGE_RECOVERY_NOT_ALLOWED' });
    expect(operation).not.toHaveBeenCalled();
    const result = await service.recoverInterrupted(req(), operation);
    expect(result.attempt).toBe(2);
    expect(repository.listAttempts('run_001')).toEqual(
      oracle.listAttempts('run_001'),
    );
    expect(repository.listAttempts('run_001')[0].failure).toEqual({
      code: 'STAGE_INTERRUPTED',
      field: 'stage',
      retryAllowed: true,
    });
  });
  it('limits automatic transient retries and permits exact manual retry', async () => {
    const sleep = vi.fn(async () => {});
    const service = new StageRecoveryService(repository, { now, sleep });
    const error = Object.assign(new Error('private'), {
      code: 'NETWORK_TIMEOUT',
      field: 'stage',
    });
    const operation = vi.fn(async () => {
      throw error;
    });
    await expect(service.execute(req(), operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
    await expect(
      service.retry({ ...req(), requestHash: 'c'.repeat(64) }, operation),
    ).rejects.toMatchObject({ code: 'STAGE_RETRY_NOT_ALLOWED' });
    expect(
      (
        await service.retry(req(), async () => ({
          artifactId: 'research:ok',
          contentHash: 'd'.repeat(64),
        }))
      ).attempt,
    ).toBe(4);
  });
  it('rolls back failed checkpoint completion', () => {
    const attempt = repository.startAttempt(req(), {
      trigger: 'INITIAL',
      startedAt: now(),
    });
    fixture.base.db.exec(
      "CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON pipeline_stage_attempts BEGIN SELECT RAISE(ABORT,'forced checkpoint'); END",
    );
    expect(() =>
      repository.succeed(attempt.id, {
        completedAt: now(),
        artifactId: 'research:one',
        artifactContentHash: 'b'.repeat(64),
        result: {},
      }),
    ).toThrow('forced checkpoint');
    expect(repository.getLatestAttempt('run_001', 'RESEARCH')?.state).toBe(
      'RUNNING',
    );
    expect(session.db.isTransaction).toBe(false);
  });
  it('invalidates downstream checkpoints when upstream hashes change', async () => {
    const service = new StageRecoveryService(repository, { now });
    await service.execute(req(), async () => ({
      artifactId: 'research:one',
      contentHash: 'b'.repeat(64),
    }));
    await service.execute(
      {
        ...req(),
        stage: 'TREND_FORMAT_ANALYSIS',
        inputs: [
          {
            stage: 'RESEARCH',
            artifactId: 'research:one',
            contentHash: 'b'.repeat(64),
          },
        ],
      },
      async () => ({ artifactId: 'trend:one', contentHash: 'c'.repeat(64) }),
    );
    expect(service.getStatuses('run_001')[1].state).toBe('SUCCEEDED');
    await service.execute(
      { ...req(), requestHash: 'd'.repeat(64) },
      async () => ({ artifactId: 'research:two', contentHash: 'e'.repeat(64) }),
    );
    expect(service.getStatuses('run_001')[1]).toMatchObject({
      state: 'PENDING',
      artifactId: null,
      artifactContentHash: null,
    });
    expect(service.getStatuses('run_001')).toEqual(
      new legacyService.StageRecoveryService(oracle).getStatuses('run_001'),
    );
  });
  it('matches independent JS execution, bounded retry and receipt histories', async () => {
    const other = affiliateRunFixture();
    const otherRepository = new legacy.StageRecoveryRepository(other.database);
    try {
      const ts = new StageRecoveryService(repository, {
        now,
        sleep: async () => {},
      });
      const js = new legacyService.StageRecoveryService(otherRepository, {
        now,
        sleep: async () => {},
      });
      const operation = () => {
        let calls = 0;
        return async () => {
          if (++calls === 1)
            throw Object.assign(new Error('private'), {
              status: 503,
              code: 'PROVIDER_503',
              field: 'stage',
            });
          return {
            artifactId: 'research:ok',
            contentHash: 'b'.repeat(64),
            value: { checked: true },
          };
        };
      };
      expect(await ts.execute(req(), operation())).toEqual(
        await js.execute(req(), operation()),
      );
      expect(repository.listAttempts('run_001')).toEqual(
        otherRepository.listAttempts('run_001'),
      );
      expect(
        await ts.execute(req(), async () => {
          throw new Error('must reuse');
        }),
      ).toEqual(
        await js.execute(req(), async () => {
          throw new Error('must reuse');
        }),
      );
    } finally {
      otherRepository.close();
      other.cleanup();
    }
  });
});
