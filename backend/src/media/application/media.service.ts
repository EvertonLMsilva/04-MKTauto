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
  constructor(
    private readonly store: MediaStore,
    private readonly composer?: VideoComposer,
  ) {}
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
    const r = this.store.openQuality();
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
