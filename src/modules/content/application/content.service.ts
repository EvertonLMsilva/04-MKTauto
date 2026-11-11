import { runContentIo } from './content-io.js';
import type { ContentStore, ContentRepository } from './content.port.js';

export class ContentService<A extends boolean = false> {
  constructor(private readonly store: ContentStore<A>) {}
  private session<T>(
    readOnly: boolean,
    operation: (repository: ContentRepository) => T,
  ): A extends true ? Promise<T> : T {
    const store = this.store;
    return runContentIo(
      (function* (): Generator<unknown, T, any> {
        const repository = yield store.open(readOnly);
        let result!: T;
        let failure: { error: unknown } | undefined;
        try {
          result = yield operation(repository);
        } catch (error) {
          failure = { error };
        }
        try {
          yield repository.close();
        } catch (error) {
          if (!failure) throw error;
        }
        if (failure) throw failure.error;
        return result;
      })(),
    );
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
