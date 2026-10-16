import {
  reference,
  referenceResearchStore,
} from '../../test/support/frozen-parity.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteResearchRepository } from './infrastructure/sqlite-research.repository.js';
import { calculateTrendScores, rankTrendCandidates } from './domain/ranking.js';
import { analyzeTrendRun } from './application/trend-analysis.js';
import {
  buildResearchShortlist,
  selectResearchShortlistCandidates,
} from './application/research-shortlist.js';
import { createResearchInput } from './domain/research-contracts.js';
import { createHash } from 'node:crypto';
import {
  batch,
  cluster,
  score,
  researchInput,
  DAY_ONE,
  DAY_TWO,
} from '../../test/support/research-catalog-fixture.js';
import { referenceInsight } from '../../test/support/research-insight-fixture.js';
import { SqliteResearchReader } from './infrastructure/sqlite-research.reader.js';
import { raceResearch } from '../../test/support/research-concurrency.js';
const ranking = {
  rankTrendCandidates: reference('ranking.rankTrendCandidates'),
  calculateTrendScores: reference('ranking.calculateTrendScores'),
};
const analysis = { analyzeTrendRun: reference('analysis.analyzeTrendRun') };
const shortlist = {
  buildResearchShortlist: reference('shortlist.buildResearchShortlist'),
  selectResearchShortlistCandidates: reference(
    'shortlist.selectResearchShortlistCandidates',
  ),
};
const research = {
  createResearchInput: reference('research.createResearchInput'),
};
function provision(path: string) {
  const db = new DatabaseSync(path);
  try {
    provisionSchema(db, 39);
  } finally {
    db.close();
  }
}
function json(value: any): string {
  return Array.isArray(value)
    ? `[${value.map(json).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${json(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);
}
function hash(value: any) {
  return createHash('sha256').update(json(value)).digest('hex');
}

function fixture(
  operation: (ts: SqliteResearchRepository, js: any, path: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'research-parity-'));
  const path = join(directory, 'ts.sqlite');
  provision(path);
  const ts = new SqliteResearchRepository(path);
  const js = referenceResearchStore();
  try {
    operation(ts, js, path);
  } finally {
    ts.close();
    js.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('local Research against frozen legacy evidence', () => {
  it('serializes simultaneous exact retries and rejects competing content without partial writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-race-'));
    const path = join(directory, 'catalog.sqlite');
    provision(path);
    const value = batch({ key: 'race', at: DAY_ONE, views: 100 });
    try {
      expect(await raceResearch(path, [value, value])).toEqual([
        { ok: true },
        { ok: true },
      ]);
      const results = await raceResearch(path, [
        batch({
          key: 'competing',
          at: DAY_TWO,
          views: 120,
          runId: 'run-two',
          snapshotId: 'snapshot-two',
        }),
        batch({
          key: 'competing',
          at: DAY_TWO,
          views: 130,
          runId: 'run-two',
          snapshotId: 'snapshot-two',
        }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)?.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      const store = new SqliteResearchRepository(path);
      try {
        expect(
          store.db.prepare('SELECT COUNT(*) n FROM trend_operations').get().n,
        ).toBe(2);
        expect(store.getCandidateHistory('candidate-1').snapshots).toHaveLength(
          2,
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('preserves research snapshots, lineage, shortlist states, immutable evidence and Content readers', () =>
    fixture((ts, js) => {
      const input = createResearchInput(researchInput(['youtube']));
      expect(input).toEqual(
        research.createResearchInput(researchInput(['youtube'])),
      );
      let source: any;
      for (const store of [ts, js]) {
        store.recordOperation(batch({ key: 'one', at: DAY_ONE, views: 100 }));
        store.recordAnalysis({
          idempotencyKey: 'analysis',
          runId: 'run-2026-09-26',
          topicClusters: [cluster()],
          scores: [score()],
        });
        const run = {
          id: 'research-run',
          ...input.execution,
          logicalDate: input.window.logicalDate,
          timezone: input.projectSnapshot.channel.publishing.timezone,
          researchInputHash: hash(input),
          configHash: 'b'.repeat(64),
          config: {},
          sourcePlan: [],
        };
        expect(store.beginResearchDailyRun(run).state).toBe('RUNNING');
        expect(() =>
          store.beginResearchDailyRun({
            ...run,
            researchInputHash: 'c'.repeat(64),
          }),
        ).toThrow(expect.objectContaining({ code: 'RESEARCH_RUN_CONFLICT' }));
        const base = {
          schemaVersion: 'research-topic-catalog/1.0.0',
          artifactId: 'catalog:001',
          artifactType: 'topic_discovery',
          revision: 1,
          ...input.execution,
          logicalDate: input.window.logicalDate,
          timezone: run.timezone,
          createdAt: DAY_ONE,
          createdBy: 'SYSTEM',
          researchInputHash: hash(input),
          analysisContext: {
            niche: 'educação',
            subniches: ['ciência prática'],
            audience: 'adultos curiosos',
            language: 'pt-BR',
          },
          sourcePlan: [
            {
              network: 'youtube',
              role: 'CONFIGURED_NETWORK',
              adapter: 'fixture',
              status: 'SUCCESS',
              sourceRunIds: ['source-run-2026-09-26'],
              gaps: [],
            },
          ],
          trendRunId: 'run-2026-09-26',
          state: 'COMPLETED',
          gaps: [],
          rights: {
            usageCondition: 'REFERENCE_ONLY',
            mediaDownloaded: false,
            republicationAllowed: false,
          },
        };
        delete (base as any).startedAt;
        source = { ...base, contentHash: hash(base) };
        store.recordResearchArtifact({
          researchDailyRunId: run.id,
          artifact: source,
        });
        store.finishResearchDailyRun({
          id: run.id,
          state: 'COMPLETED',
          trendRunId: source.trendRunId,
          completedAt: DAY_TWO,
          durationMs: 1,
          result: {},
        });
      }
      expect(ts.getResearchDailyRun('research-run')).toEqual(
        js.getResearchDailyRun('research-run'),
      );
      const tsResult = buildResearchShortlist({
        store: ts,
        researchInput: input,
        researchTopicCatalog: source,
        clock: () => new Date(DAY_ONE),
      });
      const jsResult = shortlist.buildResearchShortlist({
        store: js,
        researchInput: input,
        researchTopicCatalog: source,
        clock: () => new Date(DAY_ONE),
      });
      expect(tsResult).toEqual(jsResult);
      expect(tsResult.state).toBe('COMPLETED_WITH_GAPS');
      expect(
        buildResearchShortlist({
          store: ts,
          researchInput: input,
          researchTopicCatalog: source,
          clock: () => new Date(DAY_TWO),
        }),
      ).toEqual(tsResult);
      expect(
        new SqliteResearchReader(ts.db).getShortlist(tsResult.artifactId),
      ).toEqual(tsResult);
      expect(() =>
        ts.recordResearchShortlist({
          ...tsResult,
          contentHash: '0'.repeat(64),
        }),
      ).toThrow(
        expect.objectContaining({ code: 'RESEARCH_SHORTLIST_HASH_MISMATCH' }),
      );
      expect(() =>
        ts.recordResearchArtifact({
          researchDailyRunId: 'research-run',
          artifact: {
            ...source,
            gaps: ['changed'],
            contentHash: '0'.repeat(64),
          },
        }),
      ).toThrow(
        expect.objectContaining({ code: 'RESEARCH_ARTIFACT_HASH_MISMATCH' }),
      );
      for (const state of ['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED']) {
        const catalog = ts.getRun(source.trendRunId);
        expect(selectResearchShortlistCandidates(catalog, state)).toEqual(
          shortlist.selectResearchShortlistCandidates(catalog, state),
        );
      }
      let insight: any = referenceInsight();
      const { contentHash: _hash, ...content } = insight;
      insight = { ...content, contentHash: hash(content) };
      for (const store of [ts, js]) {
        const run = {
          id: 'reference-run',
          pipelineRunId: insight.pipelineRunId,
          projectId: insight.projectId,
          projectVersion: insight.projectVersion,
          logicalDate: insight.logicalDate,
          timezone: insight.analysisWindow.timezone,
          researchInputHash: insight.researchInputHash,
          projectSnapshotHash: insight.projectSnapshotHash,
          policyVersion: insight.policyVersion,
          configHash: 'd'.repeat(64),
          startedAt: DAY_ONE,
        };
        store.beginReferenceAnalysisRun(run);
        expect(
          store.recordReferenceInsight({
            referenceAnalysisRunId: run.id,
            artifact: insight,
          }),
        ).toEqual(insight);
        expect(
          store.recordReferenceInsight({
            referenceAnalysisRunId: run.id,
            artifact: insight,
          }),
        ).toEqual(insight);
        expect(() =>
          store.recordReferenceInsight({
            referenceAnalysisRunId: run.id,
            artifact: { ...insight, projectVersion: 2 },
          }),
        ).toThrow(
          expect.objectContaining({
            code: 'REFERENCE_INSIGHT_LINEAGE_MISMATCH',
          }),
        );
        store.finishReferenceAnalysisRun({
          id: run.id,
          state: 'COMPLETED',
          completedAt: DAY_TWO,
          durationMs: 2,
          result: {},
        });
      }
      expect(ts.getReferenceAnalysisRun('reference-run')).toEqual(
        js.getReferenceAnalysisRun('reference-run'),
      );
      expect(ts.getInsight(insight.artifactId)).toEqual(insight);
    }));
  it('records observations, reappearance, immutable snapshots, history and retries identically', () =>
    fixture((ts, js) => {
      for (const value of [
        batch({ key: 'one', at: DAY_ONE, views: 100 }),
        batch({
          key: 'two',
          at: DAY_TWO,
          views: 220,
          runId: 'run-two',
          snapshotId: 'snapshot-two',
          reason: 'REAPPEARED',
        }),
      ]) {
        expect(ts.recordOperation(value)).toEqual(js.recordOperation(value));
        expect(ts.recordOperation(value)).toEqual(js.recordOperation(value));
      }
      expect(ts.getCandidateHistory('candidate-1')).toEqual(
        js.getCandidateHistory('candidate-1'),
      );
      for (const store of [ts, js])
        expect(() =>
          store.recordOperation(batch({ key: 'one', at: DAY_ONE, views: 101 })),
        ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
    }));

  it.each(['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'])(
    'preserves persisted %s research and reference state and rejects invalid states',
    (state) =>
      fixture((ts, js) => {
        const run = {
          id: 'state-run',
          pipelineRunId: 'pipeline-state',
          projectId: 'project-state',
          projectVersion: 1,
          logicalDate: '2026-09-26',
          timezone: 'America/Sao_Paulo',
          researchInputHash: 'a'.repeat(64),
          configHash: 'b'.repeat(64),
          config: {},
          sourcePlan: [],
          startedAt: DAY_ONE,
        };
        for (const store of [ts, js]) {
          store.beginResearchDailyRun(run);
          store.startResearchDailyStep({
            researchDailyRunId: run.id,
            stepKey: 'local',
            startedAt: DAY_ONE,
          });
          store.finishResearchDailyStep({
            researchDailyRunId: run.id,
            stepKey: 'local',
            state: state === 'COMPLETED_WITH_GAPS' ? 'COMPLETED' : state,
            completedAt: DAY_TWO,
            durationMs: 1,
            result: {},
          });
          store.finishResearchDailyRun({
            id: run.id,
            state,
            completedAt: DAY_TWO,
            durationMs: 1,
            result: {},
          });
          expect(() =>
            store.finishResearchDailyRun({
              id: run.id,
              state: 'INVALID',
              completedAt: DAY_TWO,
              durationMs: 1,
              result: {},
            }),
          ).toThrow();
          store.beginReferenceAnalysisRun({
            ...run,
            id: 'reference-state',
            pipelineRunId: 'reference-pipeline-state',
            projectSnapshotHash: 'c'.repeat(64),
            policyVersion: 'reference-analysis-policy/1.0.0',
          });
          store.startReferenceAnalysisStep({
            referenceAnalysisRunId: 'reference-state',
            referenceKey: 'local',
            startedAt: DAY_ONE,
          });
          expect(() =>
            store.finishReferenceAnalysisStep({
              referenceAnalysisRunId: 'reference-state',
              referenceKey: 'local',
              state: 'COMPLETED',
              completedAt: DAY_TWO,
              durationMs: 1,
              result: { nested: { transcript: 'private' } },
            }),
          ).toThrow(
            expect.objectContaining({ code: 'FORBIDDEN_REFERENCE_STEP_FIELD' }),
          );
          store.finishReferenceAnalysisRun({
            id: 'reference-state',
            state,
            completedAt: DAY_TWO,
            durationMs: 1,
            result: {},
          });
        }
        expect(ts.getResearchDailyRun(run.id)).toEqual(
          js.getResearchDailyRun(run.id),
        );
        expect(ts.getReferenceAnalysisRun('reference-state')).toEqual(
          js.getReferenceAnalysisRun('reference-state'),
        );
      }),
  );

  it('matches ranking ties, missing metrics, diversity relaxation and shortlist exclusions', () => {
    const candidates = Array.from(
      { length: 25 },
      (_, index) =>
        batch({
          key: `k${index}`,
          at: DAY_ONE,
          views: 100,
          candidateId: `candidate-${index}`,
          snapshotId: `snapshot-${index}`,
          platformVideoId: `video-${index}`,
          canonicalUrl: `https://youtube.com/watch?v=video-${index}`,
        }).observations[0].candidate,
    );
    const clusters = [
      {
        ...cluster(),
        candidateIds: candidates.map((candidate) => candidate.id),
        evidenceSnapshotIds: candidates.map((_, index) => `snapshot-${index}`),
      },
    ];
    const scores = candidates.map((candidate, index) => ({
      ...score(),
      id: `score-${index}`,
      candidateId: candidate.id,
    }));
    const input = { candidates, clusters, scores };
    expect(rankTrendCandidates(input)).toEqual(
      ranking.rankTrendCandidates(input),
    );
    const catalog = { ...input, topicClusters: clusters, sourceRuns: [] };
    expect(selectResearchShortlistCandidates(catalog, 'COMPLETED')).toEqual(
      shortlist.selectResearchShortlistCandidates(catalog, 'COMPLETED'),
    );
    const missing = {
      ...catalog,
      scores: [scores[0], scores[0]],
      candidates: [
        {
          ...candidates[0],
          durationSeconds: {
            availability: 'UNAVAILABLE',
            reason: 'NOT_RETURNED',
          },
        },
        candidates[1],
      ],
    };
    expect(selectResearchShortlistCandidates(missing, 'COMPLETED')).toEqual(
      shortlist.selectResearchShortlistCandidates(missing, 'COMPLETED'),
    );
    const local = { candidates, histories: {}, clusters, now: DAY_TWO };
    expect(calculateTrendScores(local)).toEqual(
      ranking.calculateTrendScores(local),
    );
  });

  it('rolls back the entire operation when a snapshot conflicts', () =>
    fixture((ts, js) => {
      for (const store of [ts, js]) {
        store.recordOperation(batch({ key: 'one', at: DAY_ONE, views: 100 }));
        expect(() =>
          store.recordOperation(
            batch({ key: 'bad', at: DAY_TWO, views: 999, runId: 'run-bad' }),
          ),
        ).toThrow();
        expect(store.getRun('run-bad')).toBeNull();
        expect(store.getOperation('bad')).toBeNull();
      }
      expect(ts.getCandidateHistory('candidate-1')).toEqual(
        js.getCandidateHistory('candidate-1'),
      );
    }));

  it('ranks local evidence with algorithm parity and validates clustering ownership', async () => {
    let tsCatalog: any;
    let jsCatalog: any;
    fixture((ts, js) => {
      for (const store of [ts, js])
        store.recordOperation(batch({ key: 'one', at: DAY_ONE, views: 100 }));
      tsCatalog = ts.getRun('run-2026-09-26');
      jsCatalog = js.getRun('run-2026-09-26');
      const input = {
        candidates: tsCatalog.candidates,
        histories: { 'candidate-1': ts.getCandidateHistory('candidate-1') },
        clusters: [cluster()],
        now: DAY_TWO,
      };
      const scores = calculateTrendScores(input);
      expect(scores).toEqual(ranking.calculateTrendScores(input));
      const ranked = {
        candidates: tsCatalog.candidates,
        scores,
        clusters: [cluster()],
      };
      expect(rankTrendCandidates(ranked)).toEqual(
        ranking.rankTrendCandidates(ranked),
      );
    });
    const {
      schemaVersion: _version,
      id: _id,
      createdBy: _author,
      ...proposal
    } = cluster();
    const calls: any[] = [];
    const store = (catalog: any) => ({
      getRun: () => catalog,
      getOperation: () => null,
      getCandidateHistory: () => ({ snapshots: catalog.snapshots }),
      recordAnalysis: (value: any) => {
        calls.push(value);
        return {
          ...catalog,
          topicClusters: value.topicClusters,
          scores: value.scores,
        };
      },
    });
    const input = {
      runId: 'run-2026-09-26',
      idempotencyKey: 'analysis',
      now: DAY_TWO,
      clusterer: async () => [proposal],
    };
    expect(
      await analyzeTrendRun({ ...input, store: store(tsCatalog) }),
    ).toEqual(
      await analysis.analyzeTrendRun({ ...input, store: store(jsCatalog) }),
    );
    expect(calls[0]).toEqual(calls[1]);
    await expect(
      analyzeTrendRun({
        ...input,
        store: store(tsCatalog),
        clusterer: async () => [
          { ...proposal, evidenceSnapshotIds: ['unknown'] },
        ],
      }),
    ).rejects.toThrow();
  });

  it('opens schema 39 without migrations and preserves lock contention and retry', () =>
    fixture((ts, _js, path) => {
      const other = new SqliteResearchRepository(path);
      const before = ts.db
        .prepare('SELECT * FROM schema_migrations ORDER BY version')
        .all();
      try {
        ts.db.exec('BEGIN IMMEDIATE');
        other.db.exec('PRAGMA busy_timeout=1');
        expect(() =>
          other.recordOperation(
            batch({ key: 'locked', at: DAY_ONE, views: 100 }),
          ),
        ).toThrow();
        ts.db.exec('ROLLBACK');
        other.recordOperation(
          batch({ key: 'locked', at: DAY_ONE, views: 100 }),
        );
        expect(ts.getOperation('locked')).toEqual(other.getOperation('locked'));
        expect(ts.db.prepare('PRAGMA user_version').get()?.user_version).toBe(
          39,
        );
        expect(
          ts.db
            .prepare('SELECT * FROM schema_migrations ORDER BY version')
            .all(),
        ).toEqual(before);
      } finally {
        other.close();
      }
    }));

  it('rejects unsupported schema without migrating', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-schema-'));
    const path = join(directory, 'bad.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version=38');
    db.close();
    try {
      expect(() => new SqliteResearchRepository(path)).toThrow(
        'RESEARCH_SCHEMA_VERSION_UNSUPPORTED',
      );
      const check = new DatabaseSync(path);
      expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(38);
      check.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
