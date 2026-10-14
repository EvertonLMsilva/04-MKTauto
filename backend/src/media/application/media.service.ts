import type {
  MediaStore,
  MediaRepository,
  QualityRepository,
  CompositionRepository,
} from './media.port.js';
export class MediaService {
  constructor(private readonly store: MediaStore) {}
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
  findReport(policy: string, id: string, hash: string) {
    return this.quality((r) => r.findQualityControlReport(policy, id, hash));
  }
}
