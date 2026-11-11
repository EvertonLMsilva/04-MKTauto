import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_REPOSITORY,
  type ResearchRepository,
  type ResearchRepositoryFactory,
} from './research-repository.port.js';
import type { ResearchReader } from './research-reader.port.js';
import { buildResearchShortlist } from './research-shortlist.js';
import { analyzeTrendRun } from './trend-analysis.js';
import {
  rankTrendCandidates,
  DEFAULT_TREND_RANKING_CONFIG,
} from '../domain/ranking.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';

type ReadOperation =
  | 'getRun'
  | 'getOperation'
  | 'getCandidateHistory'
  | 'getResearchDailyRun'
  | 'getResearchDailyRunByPipeline'
  | 'getResearchArtifact'
  | 'getResearchShortlistByPipeline'
  | 'getReferenceAnalysisRun'
  | 'getReferenceInsight';
type WriteOperation =
  | 'recordOperation'
  | 'recordAnalysis'
  | 'beginResearchDailyRun'
  | 'finishResearchDailyRun'
  | 'recordResearchArtifact'
  | 'recordResearchShortlist'
  | 'beginReferenceAnalysisRun'
  | 'finishReferenceAnalysisRun'
  | 'recordReferenceInsight';

@Injectable()
export class ResearchService implements ResearchReader {
  constructor(
    @Inject(RESEARCH_REPOSITORY)
    private readonly persistence: ResearchRepositoryFactory,
  ) {}
  private read<T>(operation: (repository: ResearchRepository) => T): T {
    const repository = this.persistence.open(true);
    try {
      return operation(repository);
    } finally {
      repository.close();
    }
  }
  private write<T>(operation: (repository: ResearchRepository) => T): T {
    const repository = this.persistence.open();
    try {
      return repository.atomic(() => operation(repository));
    } finally {
      repository.close();
    }
  }
  getShortlist(id: string) {
    return this.read((repository) => repository.getShortlist(id));
  }
  getInsight(id: string) {
    return this.read((repository) => repository.getInsight(id));
  }
  get(operation: ReadOperation, id: string) {
    return this.read((repository) => repository[operation](id));
  }
  execute(operation: WriteOperation, value: any) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ContractValidationError(
        'INVALID_TYPE',
        'request',
        'deve ser objeto',
      );
    return this.write((repository) => repository[operation](value));
  }
  shortlist(value: any) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ContractValidationError(
        'INVALID_TYPE',
        'request',
        'deve ser objeto',
      );
    const { researchInput, researchTopicCatalog, policy } = value;
    return this.write((store) =>
      buildResearchShortlist({
        store,
        researchInput,
        researchTopicCatalog,
        ...(policy !== undefined ? { policy } : {}),
      }),
    );
  }
  async analyze(value: any) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.proposals))
      throw new ContractValidationError(
        'LOCAL_CLUSTERER_REQUIRED',
        'proposals',
        'propostas locais obrigatórias',
      );
    const store = this.persistence.open();
    try {
      // No external adapter. Proposals undergo the original evidence and membership checks.
      return await analyzeTrendRun({
        store,
        runId: value.runId,
        idempotencyKey: value.idempotencyKey,
        config:
          value.config === undefined
            ? DEFAULT_TREND_RANKING_CONFIG
            : value.config,
        now: value.now,
        analysisContext: value.analysisContext,
        historyScope: value.historyScope,
        clusterer: async () => value.proposals,
      });
    } finally {
      store.close();
    }
  }
  ranking(id: string) {
    return this.read((store) => {
      const catalog = store.getRun(id);
      return catalog
        ? rankTrendCandidates({
            candidates: catalog.candidates,
            scores: catalog.scores,
            clusters: catalog.topicClusters,
          })
        : null;
    });
  }
}
