import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import type {
  FakeVideoGenerationJob,
  FakeVideoGenerationPort,
  FakeVideoGenerationRequest,
} from '../application/fake-video-generation.port.js';

/** Simulation only. Restarting/replacing this instance discards every job and replay binding. */
export class FakeVideoGenerationProvider implements FakeVideoGenerationPort {
  private readonly jobs = new Map<
    string,
    { hash: string; job: FakeVideoGenerationJob }
  >();
  constructor(
    private readonly outcome: 'COMPLETE' | 'FAIL_ONCE' = 'COMPLETE',
  ) {}
  async submit(
    request: FakeVideoGenerationRequest,
  ): Promise<FakeVideoGenerationJob> {
    const hash = affiliateHash(request);
    const prior = this.jobs.get(request.operationId);
    if (prior) {
      if (prior.hash !== hash) throw new Error('FAKE_GENERATION_CONFLICT');
      return prior.job;
    }
    const job = immutable({
      mode: 'fake' as const,
      fakeJobId: `fake_video:${affiliateHash({ operationId: request.operationId, hash })}`,
      state: 'SUBMITTED' as const,
      attempt: 1,
      request,
      materialization: 'NOT_MATERIALIZED' as const,
      mediaAsset: null,
      motionValidation: 'NOT_VALIDATED' as const,
      rightsValidation: 'NOT_CONFIRMED' as const,
      compositionReady: false as const,
      executionAuthorized: false as const,
      qcRequired: [
        'TEMPORAL_MOTION_EVIDENCE',
        'EXCLUDE_GLOBAL_ZOOM_PAN_OF_STILL',
        'SCENE_CONSISTENCY_EVIDENCE',
        'VERIFY_SUBJECT_AGAINST_SCRIPT_AND_AUTHORIZED_REFERENCE',
        'PHYSICAL_MEDIA_AND_HASH_VERIFICATION',
        'COMMERCIAL_USE_AND_PROCESSING_RIGHTS_EVIDENCE',
      ],
    });
    // No await before claiming identity: equivalent concurrent submissions share one job.
    this.jobs.set(request.operationId, { hash, job });
    return job;
  }
  async status(operationId: string) {
    return this.poll(operationId);
  }
  poll(operationId: string): FakeVideoGenerationJob {
    const entry = this.require(operationId);
    if (entry.job.state === 'SUBMITTED')
      entry.job = immutable({
        ...entry.job,
        state:
          this.outcome === 'FAIL_ONCE' && entry.job.attempt === 1
            ? 'FAILED'
            : 'COMPLETED',
      });
    return entry.job;
  }
  recover(operationId: string): FakeVideoGenerationJob {
    const entry = this.require(operationId);
    if (entry.job.state === 'FAILED')
      entry.job = immutable({
        ...entry.job,
        state: 'SUBMITTED',
        attempt: entry.job.attempt + 1,
      });
    return entry.job;
  }
  private require(operationId: string) {
    const entry = this.jobs.get(operationId);
    if (!entry) throw new Error('FAKE_JOB_NOT_FOUND');
    return entry;
  }
}
