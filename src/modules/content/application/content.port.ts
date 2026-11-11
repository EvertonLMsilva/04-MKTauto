import type {
  IdeaWithScore,
  IdeaSelection,
  AffiliateEditorialSelection,
  EditorialScript,
} from '../domain/content.types.js';

type Io<A extends boolean, T> = A extends true ? Promise<T> : T;
export interface ContentRepository<A extends boolean = false> {
  close(): Io<A, void>;
  registerBatch(value: unknown): Io<A, IdeaWithScore[]>;
  getIdeaWithScore(id: string): Io<A, IdeaWithScore | null>;
  listIdeasByPipelineRun(id: string): Io<A, IdeaWithScore[]>;
  registerSelection(value: unknown): Io<A, IdeaSelection>;
  getSelection(id: string): Io<A, IdeaSelection | null>;
  listSelectionsByPipelineRun(id: string): Io<A, IdeaSelection[]>;
  listSelectionsByBatch(id: string): Io<A, IdeaSelection[]>;
  registerAffiliateEditorialSelection(
    value: unknown,
  ): Io<A, AffiliateEditorialSelection>;
  getAffiliateEditorialSelection(
    id: string,
  ): Io<A, AffiliateEditorialSelection | null>;
  registerScript(value: unknown): Io<A, EditorialScript>;
  getScript(id: string): Io<A, EditorialScript | null>;
  listScriptsByPipelineRun(id: string): Io<A, EditorialScript[]>;
  listScriptsBySelection(id: string): Io<A, EditorialScript[]>;
}
export interface ContentStore<A extends boolean = false> {
  open(readOnly?: boolean): Io<A, ContentRepository<A>>;
}
