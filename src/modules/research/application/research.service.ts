import { Inject, Injectable } from '@nestjs/common';
import {
  RESEARCH_REPOSITORY,
  type ResearchRepository,
  type ResearchRepositoryFactory,
} from './research-repository.port.js';
import type { ResearchReader, ResearchResult } from './research-reader.port.js';
import type {
  ResearchShortlist,
  ReferenceInsight,
} from '../domain/research.types.js';
import { runResearchIo } from './research-io.js';
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
export class ResearchService<
  Async extends boolean = false,
> implements ResearchReader<Async> {
  constructor(
    @Inject(RESEARCH_REPOSITORY)
    private readonly persistence: ResearchRepositoryFactory<Async>,
  ) {}
  private use<T>(
    readOnly: boolean,
    operation: (
      repository: ResearchRepository<Async>,
    ) => ResearchResult<T, Async>,
  ): ResearchResult<T, Async> {
    const persistence = this.persistence;
    return runResearchIo(
      (function* (): Generator<unknown, T, any> {
        const repository: ResearchRepository<Async> =
          yield persistence.open(readOnly);
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
          failure ??= { error };
        }
        if (failure) throw failure.error;
        return result;
      })(),
    ) as ResearchResult<T, Async>;
  }
  private read<T>(
    operation: (
      repository: ResearchRepository<Async>,
    ) => ResearchResult<T, Async>,
  ): ResearchResult<T, Async> {
    return this.use(true, operation);
  }
  private write<T>(
    operation: (
      repository: ResearchRepository<Async>,
    ) => ResearchResult<T, Async>,
  ): ResearchResult<T, Async> {
    return this.use(false, (repository) =>
      repository.atomic<T>(() => operation(repository)),
    );
  }
  getShortlist(id: string) {
    return this.read<ResearchShortlist | null>((repository) =>
      repository.getShortlist(id),
    );
  }
  getInsight(id: string) {
    return this.read<ReferenceInsight | null>((repository) =>
      repository.getInsight(id),
    );
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
    const store = await this.persistence.open();
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
      await store.close();
    }
  }
  ranking(id: string) {
    return this.read(
      (store) =>
        runResearchIo(
          (function* (): Generator<unknown, any, any> {
            const catalog = yield store.getRun(id);
            return catalog
              ? rankTrendCandidates({
                  candidates: catalog.candidates,
                  scores: catalog.scores,
                  clusters: catalog.topicClusters,
                })
              : null;
          })(),
        ) as ResearchResult<any, Async>,
    );
  }
}
