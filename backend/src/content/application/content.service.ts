import type { ContentStore, ContentRepository } from './content.port.js';

export class ContentService {
  constructor(private readonly store: ContentStore) {}
  private session<T>(
    readOnly: boolean,
    operation: (repository: ContentRepository) => T,
  ): T {
    const repository = this.store.open(readOnly);
    try {
      return operation(repository);
    } finally {
      repository.close();
    }
  }
  registerBatch(value: unknown) {
    return this.session(false, (r) => r.registerBatch(value));
  }
  getIdea(id: string) {
    return this.session(true, (r) => r.getIdeaWithScore(id));
  }
  listIdeas(id: string) {
    return this.session(true, (r) => r.listIdeasByPipelineRun(id));
  }
  selectIdea(value: unknown) {
    return this.session(false, (r) => r.registerSelection(value));
  }
  getSelection(id: string) {
    return this.session(true, (r) => r.getSelection(id));
  }
  listSelections(id: string) {
    return this.session(true, (r) => r.listSelectionsByPipelineRun(id));
  }
  listSelectionsByBatch(id: string) {
    return this.session(true, (r) => r.listSelectionsByBatch(id));
  }
  selectAffiliate(value: unknown) {
    return this.session(false, (r) =>
      r.registerAffiliateEditorialSelection(value),
    );
  }
  getAffiliateSelection(id: string) {
    return this.session(true, (r) => r.getAffiliateEditorialSelection(id));
  }
  registerScript(value: unknown) {
    return this.session(false, (r) => r.registerScript(value));
  }
  getScript(id: string) {
    return this.session(true, (r) => r.getScript(id));
  }
  listScripts(id: string) {
    return this.session(true, (r) => r.listScriptsByPipelineRun(id));
  }
  listScriptsBySelection(id: string) {
    return this.session(true, (r) => r.listScriptsBySelection(id));
  }
}
