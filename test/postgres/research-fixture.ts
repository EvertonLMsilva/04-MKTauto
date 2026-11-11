import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../src/infrastructure/administration/schema-provisioner.js';
import { SqliteResearchRepository } from '../../src/modules/research/infrastructure/sqlite-research.repository.js';
import type { PostgresResearchRepository } from '../../src/modules/research/infrastructure/postgres-research.repository.js';
import { createResearchInput } from '../../src/modules/research/domain/research-contracts.js';
import {
  batch,
  cluster,
  score,
  researchInput,
  DAY_ONE,
  DAY_TWO,
} from '../support/research-catalog-fixture.js';
import { referenceInsight } from '../support/research-insight-fixture.js';

export type ResearchStore =
  SqliteResearchRepository | PostgresResearchRepository;
export { batch, cluster, score, DAY_ONE, DAY_TWO };

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function researchHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function reseal(value: any): any {
  const { contentHash: _prior, ...content } = structuredClone(value);
  return { ...content, contentHash: researchHash(content) };
}

export function sqliteResearchFixture() {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'mktauto-pg-research-'));
  const path = join(directory, 'research.sqlite');
  const provision = new DatabaseSync(path);
  try {
    provisionSchema(provision, 39);
  } finally {
    provision.close();
  }
  const repository = new SqliteResearchRepository(path);
  return {
    path,
    repository,
    cleanup() {
      repository.close();
      const resolved = realpathSync(directory);
      if (
        dirname(resolved) !== parent ||
        !basename(resolved).startsWith('mktauto-pg-research-')
      )
        throw new Error('Invalid disposable Research SQLite boundary');
      rmSync(resolved, { recursive: true, force: false });
    },
  };
}

export async function failureCode(operation: () => unknown) {
  try {
    await operation();
  } catch (error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeTypeOf('string');
    return error.code as string;
  }
  throw new Error('Expected a public Research rejection');
}

export function researchArtifacts() {
  const input = createResearchInput(researchInput(['youtube']));
  const daily = {
    id: 'research-run',
    ...input.execution,
    logicalDate: input.window.logicalDate,
    timezone: input.projectSnapshot.channel.publishing.timezone,
    researchInputHash: researchHash(input),
    configHash: 'b'.repeat(64),
    config: {},
    sourcePlan: [],
  };
  const catalog = reseal({
    schemaVersion: 'research-topic-catalog/1.0.0',
    artifactId: 'catalog:001',
    artifactType: 'topic_discovery',
    revision: 1,
    pipelineRunId: input.execution.pipelineRunId,
    projectId: input.execution.projectId,
    projectVersion: input.execution.projectVersion,
    logicalDate: input.window.logicalDate,
    timezone: daily.timezone,
    createdAt: DAY_ONE,
    createdBy: 'SYSTEM',
    researchInputHash: researchHash(input),
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
  });
  const insight = reseal(referenceInsight());
  const referenceRun = {
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
  return { input, daily, catalog, insight, referenceRun };
}

export async function seedCatalog(store: ResearchStore) {
  const value = batch({ key: 'one', at: DAY_ONE, views: 100 });
  await store.recordOperation(value);
  await store.recordAnalysis({
    idempotencyKey: 'analysis',
    runId: value.run.id,
    topicClusters: [cluster()],
    scores: [score()],
  });
  return value;
}

export async function catalogContract(store: ResearchStore) {
  const first = batch({ key: 'one', at: DAY_ONE, views: 100 });
  const second = batch({
    key: 'two',
    at: DAY_TWO,
    views: 220,
    runId: 'run-two',
    snapshotId: 'snapshot-two',
    reason: 'REAPPEARED',
  });
  const results = [];
  for (const value of [first, second]) {
    results.push(await store.recordOperation(value));
    expect(await store.recordOperation(value)).toEqual(results.at(-1));
  }
  await store.recordAnalysis({
    idempotencyKey: 'analysis',
    runId: first.run.id,
    topicClusters: [cluster()],
    scores: [score()],
  });
  return {
    results,
    operation: await store.getOperation('one'),
    first: await store.getRun(first.run.id),
    second: await store.getRun(second.run.id),
    history: await store.getCandidateHistory('candidate-1'),
    scopedHistory: await store.getCandidateResearchHistory('candidate-1', {
      runId: first.run.id,
      projectId: 'canal_educacao',
      projectVersion: 1,
    }),
    missing: [
      await store.getRun('missing'),
      await store.getOperation('missing'),
    ],
    reused: await failureCode(() =>
      store.recordOperation(batch({ key: 'one', at: DAY_ONE, views: 101 })),
    ),
  };
}

export async function lifecycleContract(store: ResearchStore, state: string) {
  const { daily, referenceRun } = researchArtifacts();
  await store.beginResearchDailyRun(daily);
  const beginAgain = await store.beginResearchDailyRun(daily);
  const firstStep = await store.startResearchDailyStep({
    researchDailyRunId: daily.id,
    stepKey: 'z-last',
    startedAt: DAY_ONE,
  });
  const replayStep = await store.startResearchDailyStep({
    researchDailyRunId: daily.id,
    stepKey: 'z-last',
    startedAt: DAY_TWO,
  });
  expect(replayStep).toEqual(firstStep);
  await store.startResearchDailyStep({
    researchDailyRunId: daily.id,
    stepKey: 'a-first',
    startedAt: DAY_ONE,
  });
  await store.finishResearchDailyStep({
    researchDailyRunId: daily.id,
    stepKey: 'z-last',
    state: state === 'COMPLETED_WITH_GAPS' ? 'COMPLETED' : state,
    completedAt: DAY_TWO,
    durationMs: 0.125,
    result: { count: 1 },
  });
  await store.finishResearchDailyRun({
    id: daily.id,
    state,
    completedAt: DAY_TWO,
    durationMs: 1.25,
    result: {},
  });
  await store.beginReferenceAnalysisRun(referenceRun);
  await store.startReferenceAnalysisStep({
    referenceAnalysisRunId: referenceRun.id,
    referenceKey: 'z-last',
    startedAt: DAY_ONE,
  });
  await store.startReferenceAnalysisStep({
    referenceAnalysisRunId: referenceRun.id,
    referenceKey: 'a-first',
    startedAt: DAY_ONE,
  });
  const forbidden = await failureCode(() =>
    store.finishReferenceAnalysisStep({
      referenceAnalysisRunId: referenceRun.id,
      referenceKey: 'z-last',
      state: 'COMPLETED',
      completedAt: DAY_TWO,
      durationMs: 1,
      result: { nested: { transcript: 'not-persisted-fixture' } },
    }),
  );
  await store.finishReferenceAnalysisStep({
    referenceAnalysisRunId: referenceRun.id,
    referenceKey: 'z-last',
    state: 'COMPLETED',
    completedAt: DAY_TWO,
    durationMs: 0.25,
    result: { observed: 1 },
  });
  await store.finishReferenceAnalysisRun({
    id: referenceRun.id,
    state,
    completedAt: DAY_TWO,
    durationMs: 2.5,
    result: {},
  });
  return {
    beginAgain,
    daily: await store.getResearchDailyRun(daily.id),
    byPipeline: await store.getResearchDailyRunByPipeline(daily.pipelineRunId),
    dailyStep: await store.getResearchDailyStep(daily.id, 'z-last'),
    reference: await store.getReferenceAnalysisRun(referenceRun.id),
    referenceStep: await store.getReferenceAnalysisStep(
      referenceRun.id,
      'z-last',
    ),
    forbidden,
    conflict: await failureCode(() =>
      store.beginResearchDailyRun({
        ...daily,
        researchInputHash: 'c'.repeat(64),
      }),
    ),
    invalid: await failureCode(() =>
      store.finishResearchDailyRun({
        id: daily.id,
        state: 'INVALID',
        completedAt: DAY_TWO,
        durationMs: 1,
        result: {},
      }),
    ),
  };
}
