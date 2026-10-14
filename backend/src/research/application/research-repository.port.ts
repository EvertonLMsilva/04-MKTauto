import type { ResearchReader } from './research-reader.port.js';
import type {
  ResearchShortlist,
  ReferenceInsight,
} from '../domain/research.types.js';

export const RESEARCH_REPOSITORY = Symbol('RESEARCH_REPOSITORY');
export const RESEARCH_READER = Symbol('RESEARCH_READER');
export interface ResearchRepository extends ResearchReader {
  atomic<T>(operation: () => T): T;
  close(): void;
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
  recordResearchShortlist(value: ResearchShortlist): ResearchShortlist;
  getResearchShortlistByPipeline(id: string): ResearchShortlist | null;
  beginReferenceAnalysisRun(value: any): any;
  getReferenceAnalysisRun(id: string): any;
  finishReferenceAnalysisRun(value: any): any;
  recordReferenceInsight(value: {
    referenceAnalysisRunId: string;
    artifact: ReferenceInsight;
  }): ReferenceInsight;
  getReferenceInsight(id: string): ReferenceInsight | null;
}
export interface ResearchRepositoryFactory {
  open(readOnly?: boolean): ResearchRepository;
}
