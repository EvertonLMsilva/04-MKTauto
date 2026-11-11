import type { createResearchShortlist } from '../domain/research-shortlist-contracts.js';
import type { createReferenceInsight } from '../domain/reference-insight-contracts.js';

export interface ResearchReader {
  getShortlist(id: string): ReturnType<typeof createResearchShortlist> | null;
  getInsight(id: string): ReturnType<typeof createReferenceInsight> | null;
}
