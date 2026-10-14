import type {
  IdeaWithScore,
  IdeaSelection,
  AffiliateEditorialSelection,
  EditorialScript,
} from '../domain/content.types.js';

export interface ContentRepository {
  close(): void;
  registerBatch(value: unknown): IdeaWithScore[];
  getIdeaWithScore(id: string): IdeaWithScore | null;
  listIdeasByPipelineRun(id: string): IdeaWithScore[];
  registerSelection(value: unknown): IdeaSelection;
  getSelection(id: string): IdeaSelection | null;
  listSelectionsByPipelineRun(id: string): IdeaSelection[];
  listSelectionsByBatch(id: string): IdeaSelection[];
  registerAffiliateEditorialSelection(
    value: unknown,
  ): AffiliateEditorialSelection;
  getAffiliateEditorialSelection(
    id: string,
  ): AffiliateEditorialSelection | null;
  registerScript(value: unknown): EditorialScript;
  getScript(id: string): EditorialScript | null;
  listScriptsByPipelineRun(id: string): EditorialScript[];
  listScriptsBySelection(id: string): EditorialScript[];
}
export interface ContentStore {
  open(readOnly?: boolean): ContentRepository;
}
