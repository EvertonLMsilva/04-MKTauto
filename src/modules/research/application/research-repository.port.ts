import type { ResearchReader, ResearchResult } from './research-reader.port.js';
import type {
  ResearchShortlist,
  ReferenceInsight,
} from '../domain/research.types.js';

export const RESEARCH_REPOSITORY = Symbol('RESEARCH_REPOSITORY');
export const RESEARCH_READER = Symbol('RESEARCH_READER');
/** SQLite defaults stay synchronous; PostgreSQL explicitly opts into asynchronous I/O. */
export interface ResearchRepository<
  Async extends boolean = false,
> extends ResearchReader<Async> {
  atomic<T>(
    operation: () => ResearchResult<T, Async>,
  ): ResearchResult<T, Async>;
  close(): ResearchResult<void, Async>;
  recordOperation(value: any): any;
  recordAnalysis(value: any): any;
  getOperation(key: string): any;
  getRun(id: string): any;
  getCandidateHistory(id: string): any;
  getCandidateResearchHistory(id: string, scope: any): any;
  beginResearchDailyRun(value: any): any;
  getResearchDailyRun(id: string): any;
  getResearchDailyRunByPipeline(id: string): any;
  finishResearchDailyRun(value: any): any;
  recordResearchArtifact(value: any): any;
  getResearchArtifact(id: string): any;
  recordResearchShortlist(
    value: ResearchShortlist,
  ): ResearchResult<ResearchShortlist, Async>;
  getResearchShortlistByPipeline(
    id: string,
  ): ResearchResult<ResearchShortlist | null, Async>;
  beginReferenceAnalysisRun(value: any): any;
  getReferenceAnalysisRun(id: string): any;
  finishReferenceAnalysisRun(value: any): any;
  recordReferenceInsight(value: {
    referenceAnalysisRunId: string;
    artifact: ReferenceInsight;
  }): ResearchResult<ReferenceInsight, Async>;
  getReferenceInsight(
    id: string,
  ): ResearchResult<ReferenceInsight | null, Async>;
}
export interface ResearchRepositoryFactory<Async extends boolean = false> {
  open(readOnly?: boolean): ResearchResult<ResearchRepository<Async>, Async>;
}
