import { fixture } from '../../test/support/temporal-qc-fixture.js';
import { QualityControlRepository } from './infrastructure/quality-control.repository.js';
import { CompositionPlanRepository } from './infrastructure/composition-plan.reader.js';
import { validateVideoOrigin } from './domain/p4-qc-contracts.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { adaptationHash } from './domain/media-hash.js';
import {
  mediaIdentityHash,
  validateTemporalEvidence,
} from './domain/p4-qc-contracts.js';

const hash = 'e'.repeat(64);
const identity = { contentHash: hash, mediaReference: `media:sha256_${hash}` };
function evidence(changes: Record<string, unknown> = {}) {
  return {
    ...identity,
    motion: 'PASS',
    continuity: 'PASS',
    fidelity: 'PASS',
    motionBasis: 'SUBJECT_MOTION',
    provenance: {
      reference: 'evidence:review_001',
      contentHash: 'a'.repeat(64),
      validator: 'independent-review',
      version: '1.0.0',
      parameters: {
        method: 'manual-frame-review',
        productReference: 'product:001',
      },
    },
    ...changes,
  };
}
function quality(f: ReturnType<typeof fixture>, evaluate?: () => unknown) {
  return new QualityControlRepository(
    f.path,
    { get: (id) => f.repository.getRun(id)! },
    { getScript: () => f.script as any },
    {
      temporalValidator: evaluate && {
        id: 'independent-review',
        version: '1.0.0',
        evaluate,
      },
    },
  );
}
describe('temporal QC identity and independent evidence', () => {
  it.each([`media:sha256_${hash}`, `object:ltx-video/sha256/${hash}`])(
    'validates exact identity %s',
    (ref) => {
      expect(mediaIdentityHash(ref, hash)).toBe(hash);
      const origin = {
        schemaVersion: 'video-origin/1.0.0',
        kind: 'AI_GENERATED',
        generationRequestId: 'generation_001',
        providerRequestId: 'provider_001',
        requestHash: 'a'.repeat(64),
        sourceReference: ref,
        sourceContentHash: hash,
        rights: {
          evidenceReference: 'evidence:001',
          evidenceContentHash: 'a'.repeat(64),
          processingAuthorized: true,
          commercialUseAuthorized: true,
          audioAuthorized: true,
        },
      };
      expect(validateVideoOrigin(origin)).toEqual(origin);
    },
  );
  it.each([
    `media:sha256_${'f'.repeat(64)}`,
    `media:sha256_${hash}?x=1`,
    'media:job_001',
    `media:sha256_${hash.toUpperCase()}`,
  ])('rejects invalid or divergent identity %s', (ref) => {
    expect(() => mediaIdentityHash(ref, hash)).toThrow();
  });
  it.each(['STILL', 'GLOBAL_ZOOM_PAN'])(
    'does not approve %s as motion',
    (motionBasis) => {
      expect(() =>
        validateTemporalEvidence(evidence({ motionBasis }), identity),
      ).toThrow();
    },
  );
  it('rejects evidence for another physical video', () => {
    expect(() =>
      validateTemporalEvidence(
        evidence({ contentHash: 'f'.repeat(64) }),
        identity,
      ),
    ).toThrow();
  });
  it('rejects provider PASS without provenance', () => {
    expect(() =>
      validateTemporalEvidence(evidence({ provenance: null }), identity),
    ).toThrow();
  });
  it('does not infer temporal or semantic success when no analyzer exists', async () => {
    const f = fixture();
    try {
      const report: any = await f.media.evaluateTemporalMedia(
        f.assets[1].mediaAssetId,
      );
      expect(report.result).toBe('NOT_VALIDATED');
      expect(report.evidence).toMatchObject({
        motion: 'NOT_VALIDATED',
        continuity: 'NOT_VALIDATED',
        fidelity: 'NOT_VALIDATED',
        provenance: null,
      });
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
    } finally {
      f.close();
    }
  });
  it.each(['STILL', 'GLOBAL_ZOOM_PAN'])(
    'persists %s as FAIL, never a motion approval',
    async (motionBasis) => {
      const f = fixture();
      const q = quality(f, () => evidence({ motion: 'FAIL', motionBasis }));
      try {
        expect(
          (await q.evaluateTemporalMedia(f.assets[1].mediaAssetId)).result,
        ).toBe('FAIL');
        f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
        f.value.contentHash = compositionPlanContentHash(f.value);
        expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
          'TEMPORAL_QC_REQUIRED',
        );
      } finally {
        q.close();
        f.close();
      }
    },
  );
  it('rejects a generation provider used as the QC validator', async () => {
    const f = fixture();
    const evaluate = vi.fn(() => evidence());
    const q = new QualityControlRepository(
      f.path,
      { get: (id) => f.repository.getRun(id)! },
      { getScript: () => f.script as any },
      { temporalValidator: { id: 'fal_ai', version: '1', evaluate } },
    );
    try {
      await expect(
        q.evaluateTemporalMedia(f.assets[1].mediaAssetId),
      ).rejects.toThrow('TEMPORAL_INDEPENDENT_VALIDATOR_REQUIRED');
      expect(evaluate).not.toHaveBeenCalled();
    } finally {
      q.close();
      f.close();
    }
  });
  it('rejects mismatched validator provenance and another media hash before persistence', async () => {
    const f = fixture();
    const q = quality(f, () =>
      evidence({
        provenance: { ...evidence().provenance, validator: 'fal_ai' },
      }),
    );
    const other = quality(f, () =>
      evidence({
        contentHash: 'f'.repeat(64),
        mediaReference: `media:sha256_${'f'.repeat(64)}`,
      }),
    );
    try {
      await expect(
        q.evaluateTemporalMedia(f.assets[1].mediaAssetId),
      ).rejects.toThrow('TEMPORAL_VALIDATOR_MISMATCH');
      await expect(
        other.evaluateTemporalMedia(f.assets[1].mediaAssetId),
      ).rejects.toThrow('TEMPORAL_EVIDENCE_MEDIA_MISMATCH');
      expect(
        q.db
          .prepare(
            "SELECT COUNT(*) AS n FROM p4_artifacts WHERE kind='qc_report'",
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      q.close();
      other.close();
      f.close();
    }
  });
  it('preserves legacy unmarked video plans', () => {
    const f = fixture();
    try {
      expect(f.media.registerCompositionPlan(f.value)).toEqual(f.value);
    } finally {
      f.close();
    }
  });
  it('requires independent QC for generated video even if a plan omits or relaxes intent', () => {
    const f = fixture();
    try {
      const generated = {
        ...f.assets[1],
        mediaAssetId: 'generated_video_001',
        revision: 2,
        supersedesMediaAssetId: f.assets[1].mediaAssetId,
        origin: 'PROVIDER_GENERATED',
        provider: 'fal_ai',
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
      };
      f.media.register(generated);
      f.value.segments[1].mediaAssetId = generated.mediaAssetId;
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
      f.value.segments[1].movementRequirement = 'STATIC_ALLOWED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
    } finally {
      f.close();
    }
  });
  it.each(['continuity', 'fidelity'])(
    'blocks inconclusive %s even with motion PASS',
    async (field) => {
      const f = fixture();
      const q = quality(f, () => evidence({ [field]: 'NOT_VALIDATED' }));
      try {
        expect(
          (await q.evaluateTemporalMedia(f.assets[1].mediaAssetId)).result,
        ).toBe('NOT_VALIDATED');
        f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
        f.value.contentHash = compositionPlanContentHash(f.value);
        expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
          'TEMPORAL_QC_REQUIRED',
        );
      } finally {
        q.close();
        f.close();
      }
    },
  );
  it('re-evaluates unvalidated media and blocks stale PASS after a later failure', async () => {
    const f = fixture();
    let assessment = evidence();
    const q = quality(f, () => assessment);
    try {
      expect(
        ((await f.media.evaluateTemporalMedia(f.assets[1].mediaAssetId)) as any)
          .result,
      ).toBe('NOT_VALIDATED');
      const pass = await q.evaluateTemporalMedia(f.assets[1].mediaAssetId);
      expect(await q.evaluateTemporalMedia(f.assets[1].mediaAssetId)).toEqual(
        pass,
      );
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'AUTHENTICATED_HUMAN_REVIEW_REQUIRED',
      );
      assessment = evidence({ continuity: 'FAIL' });
      await q.evaluateTemporalMedia(f.assets[1].mediaAssetId);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
      expect(() =>
        q.db.exec(
          "UPDATE p4_artifacts SET identity_hash='bad' WHERE kind='qc_report'",
        ),
      ).toThrow('IMMUTABLE_P4_ARTIFACT');
    } finally {
      q.close();
      f.close();
    }
  });
  it.each(['FAIL', 'NOT_VALIDATED'])(
    'blocks incomplete QC %s through existing composition gate',
    async (status) => {
      const f = fixture(true);
      const q = quality(f, () =>
        evidence({
          continuity: status,
          mediaReference: f.assets[1].mediaReference,
        }),
      );
      try {
        const report = await q.evaluateTemporalMedia(f.assets[1].mediaAssetId);
        expect(report.result).toBe(status);
        f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
        f.value.contentHash = compositionPlanContentHash(f.value);
        expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
          'TEMPORAL_QC_REQUIRED',
        );
      } finally {
        q.close();
        f.close();
      }
    },
  );
  it('blocks real-motion scenes without QC, preserving unmarked legacy video', () => {
    const f = fixture(true);
    try {
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
    } finally {
      f.close();
    }
  });
  it('rejects an unsigned legacy test PASS through the composition gate', async () => {
    const f = fixture(true);
    const asset = f.assets[1];
    const q = quality(f, () => evidence());
    try {
      const report = await q.evaluateTemporalMedia(asset.mediaAssetId);
      expect(report.result).toBe('PASS');
      const { contentHash, ...body } = report;
      expect(contentHash).toBe(adaptationHash(body));
      f.value.segments[1].mediaAssetId = asset.mediaAssetId;
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => f.media.registerCompositionPlan(f.value)).toThrow(
        'AUTHENTICATED_HUMAN_REVIEW_REQUIRED',
      );
      const reopened = new CompositionPlanRepository(
        f.path,
        { get: (id) => f.repository.getRun(id)! },
        { getScript: () => f.script as any },
        { readOnly: true },
      );
      try {
        expect(
          reopened.getCompositionPlan(f.value.compositionPlanId),
        ).toBeNull();
      } finally {
        reopened.close();
      }
    } finally {
      q.close();
      f.close();
    }
  });
});
