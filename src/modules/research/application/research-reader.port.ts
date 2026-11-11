import type { createResearchShortlist } from '../domain/research-shortlist-contracts.js';
import type { createReferenceInsight } from '../domain/reference-insight-contracts.js';

export type ResearchResult<
  T,
  Async extends boolean = false,
> = Async extends true ? Promise<T> : T;

export interface ResearchReader<Async extends boolean = false> {
  getShortlist(
    id: string,
  ): ResearchResult<ReturnType<typeof createResearchShortlist> | null, Async>;
  getInsight(
    id: string,
  ): ResearchResult<ReturnType<typeof createReferenceInsight> | null, Async>;
}
