import { operationalQcIdentity } from '../../publishing/application/local-qc-identity.js';
import { adaptationHash } from '../domain/media-hash.js';
import {
  projectMediaHandoff,
  type MediaHandoffRequest,
} from './media-handoff.js';
import type {
  MediaStore,
  MediaRepository,
  QualityRepository,
  CompositionRepository,
} from './media.port.js';
import type { VideoComposer } from './video-composition.port.js';
import {
  VideoCompositionService,
  VideoCompositionError,
} from './video-composition.service.js';
export class MediaService {
  private readonly reviewRequests = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: MediaStore,
    private readonly composer?: VideoComposer,
  ) {}
  handoff(request: MediaHandoffRequest) {
    return projectMediaHandoff(this, request, (planId) => {
      if (!this.store.openInitialRender) return null;
      const repository = this.store.openInitialRender(true);
      try {
        return repository.listVideoRendersByCompositionPlan(planId);
      } finally {
        repository.close();
      }
    });
  }
  async compose(value: unknown, options: { signal?: AbortSignal } = {}) {
    if (!this.store.openInitialRender || !this.composer)
      throw new VideoCompositionError(
        'COMPOSER_UNAVAILABLE',
        'composer',
        'composer não configurado',
      );
    const repository = this.store.openInitialRender();
    try {
      return await new VideoCompositionService(
        repository,
        this.composer,
      ).compose(value, options);
    } finally {
      repository.close();
    }
  }
  compositionReceipt(id: string) {
    if (!this.store.openInitialRender)
      throw new VideoCompositionError(
        'COMPOSER_UNAVAILABLE',
        'composer',
        'persistência não configurada',
      );
    const repository = this.store.openInitialRender(true);
    try {
      return repository.getVideoComposition(id);
    } finally {
      repository.close();
    }
  }
  private composition<T>(
    readOnly: boolean,
    action: (repository: CompositionRepository) => T,
  ): T {
    const repository = this.store.openComposition(readOnly);
    try {
      return action(repository);
    } finally {
      repository.close();
    }
  }
  registerCompositionPlan(value: unknown) {
    return this.composition(false, (r) => r.registerCompositionPlan(value));
  }
  getCompositionPlan(id: string) {
    return this.composition(true, (r) => r.getCompositionPlan(id));
  }
  listCompositionPlansByPipelineRun(id: string) {
    return this.composition(true, (r) =>
      r.listCompositionPlansByPipelineRun(id),
    );
  }
  listCompositionPlansByScript(id: string) {
    return this.composition(true, (r) => r.listCompositionPlansByScript(id));
  }
  getVideoRender(id: string) {
    const reader = this.store.openRender();
    try {
      return reader.getVideoRender(id);
    } finally {
      reader.close();
    }
  }
  verifyMedia(reference: string): string {
    return this.store.verifyMedia(reference);
  }
  private session<T>(
    readOnly: boolean,
    action: (repository: MediaRepository) => T,
  ) {
    const r = this.store.open(readOnly);
    try {
      return action(r);
    } finally {
      r.close();
    }
  }
  private quality<T>(action: (repository: QualityRepository) => T) {
    const r = this.store.openQuality(true);
    try {
      return action(r);
    } finally {
      r.close();
    }
  }
  register(value: unknown) {
    return this.session(false, (r) => r.registerMediaAsset(value));
  }
  get(id: string) {
    return this.session(true, (r) => r.getMediaAsset(id));
  }
  listRun(id: string) {
    return this.session(true, (r) => r.listMediaAssetsByPipelineRun(id));
  }
  listScript(id: string) {
    return this.session(true, (r) => r.listMediaAssetsByScript(id));
  }
  listVisual(id: string, position: number) {
    return this.session(true, (r) =>
      r.listMediaAssetsByVisualDirection(id, position),
    );
  }
  recordAcquisition(value: unknown) {
    return this.session(false, (r) => r.registerAcquiredMediaAsset(value));
  }
  acquisition(id: string) {
    return this.session(true, (r) => r.getMediaAcquisition(id));
  }
  recordSelection(value: unknown) {
    return this.session(false, (r) => r.registerMediaSelection(value));
  }
  selection(id: string) {
    return this.session(true, (r) => r.getMediaSelection(id));
  }
  report(id: string) {
    return this.quality((r) => r.getQualityControlReport(id));
  }
  temporalReview(id: string) {
    const asset = this.get(id);
    if (!asset || asset.assetType !== 'VIDEO') return null;
    return this.quality(
      (r) =>
        r.getTemporalMediaQC?.({
          mediaAssetId: asset.mediaAssetId,
          mediaReference: asset.mediaReference,
          contentHash: asset.contentHash,
          scriptContentHash: asset.scriptContentHash,
          visualDirectionPosition: asset.visualDirectionPosition,
        }) ?? null,
    );
  }
  async prepareTemporalReview(id: string, referenceId?: string) {
    const repository = this.store.openQuality(false);
    try {
      if (!repository.prepareTemporalReview)
        throw Object.assign(new Error('HUMAN_APPROVAL_REVIEW_UNAVAILABLE'), {
          code: 'HUMAN_APPROVAL_REVIEW_UNAVAILABLE',
        });
      return await repository.prepareTemporalReview(id, referenceId);
    } finally {
      repository.close();
    }
  }
  async reviewMediaBytes(
    id: string,
    referenceId: string,
    kind: 'video' | 'reference',
  ) {
    const repository = this.store.openQuality(true);
    try {
      if (!repository.reviewMediaBytes)
        throw Object.assign(new Error('HUMAN_APPROVAL_REVIEW_UNAVAILABLE'), {
          code: 'HUMAN_APPROVAL_REVIEW_UNAVAILABLE',
        });
      return await repository.reviewMediaBytes(id, referenceId, kind);
    } finally {
      repository.close();
    }
  }
  async reviewTemporalMedia(id: string, input: unknown, principal: unknown) {
    const reviewer = operationalQcIdentity.assertActive(principal);
    const key = adaptationHash({
      id,
      input,
      actor: reviewer.id,
      credential: operationalQcIdentity.fingerprint(reviewer),
    });
    const prior = this.reviewRequests.get(key);
    if (prior) return prior;
    if (this.reviewRequests.size)
      throw Object.assign(new Error('HUMAN_APPROVAL_REVIEW_BUSY'), {
        code: 'HUMAN_APPROVAL_REVIEW_BUSY',
        field: 'review',
      });
    const operation = (async () => {
      const repository = this.store.openQuality(false);
      try {
        if (!repository.reviewTemporalMedia)
          throw new Error('HUMAN_APPROVAL_REVIEW_UNAVAILABLE');
        return await repository.reviewTemporalMedia(id, input, reviewer);
      } finally {
        repository.close();
      }
    })();
    this.reviewRequests.set(key, operation);
    try {
      return await operation;
    } finally {
      this.reviewRequests.delete(key);
    }
  }
  async evaluateTemporalMedia(id: string) {
    const repository = this.store.openQuality(false);
    try {
      if (!repository.evaluateTemporalMedia)
        throw new Error('TEMPORAL_QC_UNAVAILABLE');
      return await repository.evaluateTemporalMedia(id);
    } finally {
      repository.close();
    }
  }
  findReport(policy: string, id: string, hash: string) {
    return this.quality((r) => r.findQualityControlReport(policy, id, hash));
  }
}
