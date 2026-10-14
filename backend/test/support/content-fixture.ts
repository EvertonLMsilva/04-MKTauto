import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { ScriptRepository } = await import(
  new URL('../../../src/script-repository.js', import.meta.url).href
);
const { IdeaService } = await import(
  new URL('../../../src/idea-service.js', import.meta.url).href
);
const { IdeaSelectionService } = await import(
  new URL('../../../src/idea-selection-service.js', import.meta.url).href
);
const { PipelineRunService } = await import(
  new URL('../../../src/pipeline-run-service.js', import.meta.url).href
);
const { PIPELINE_HANDOFF_CONTRACT_VERSION } = await import(
  new URL('../../../src/project-pipeline-handoff.js', import.meta.url).href
);
const { RADAR_CONTRACT_VERSION } = await import(
  new URL('../../../src/domain/contracts.js', import.meta.url).href
);
const {
  DEFAULT_RESEARCH_SHORTLIST_POLICY,
  RESEARCH_SHORTLIST_CONTRACT_VERSION,
} = await import(
  new URL(
    '../../../src/domain/research-shortlist-contracts.js',
    import.meta.url,
  ).href
);
const { IDEA_SELECTION_CONTRACT_VERSION, selectionContentHash } = await import(
  new URL('../../../src/domain/idea-selection-contracts.js', import.meta.url)
    .href
);
const { SCRIPT_CONTRACT_VERSION, scriptContentHash } = await import(
  new URL('../../../src/domain/script-contracts.js', import.meta.url).href
);
const STARTED_AT = '2026-09-28T11:00:00.000Z';
function script(selection: any, overrides: any = {}): any {
  const blocks = [
    {
      position: 1,
      purpose: 'EXPLANATION',
      narration:
        'Primeiro, escolha uma tarefa pequena e defina um resultado claro.',
    },
  ];
  const value: any = {
    schemaVersion: SCRIPT_CONTRACT_VERSION,
    scriptId: 'script_001',
    pipelineRunId: selection.pipelineRunId,
    projectId: selection.projectId,
    projectVersion: selection.projectVersion,
    ideaSelectionId: selection.ideaSelectionId,
    ideaSelectionContentHash: selection.contentHash,
    ideaCandidateId: selection.ideaCandidateId,
    ideaContentHash: selection.ideaContentHash,
    language: 'pt-BR',
    contentFormat: 'short_video',
    hook: 'Você pode organizar a rotina com três passos simples.',
    narrativeBlocks: blocks,
    fullNarration: '',
    visualDirections: [
      {
        position: 1,
        blockPosition: 1,
        description: 'Lista simples aparecendo em tela.',
      },
    ],
    cta: 'Salve para testar depois.',
    estimatedDurationSeconds: 30,
    sensitiveClaims: [],
    reviewFlags: [],
    origin: 'OPERATOR',
    createdAt: '2026-09-28T14:00:00.000Z',
    revision: 1,
    supersedesScriptId: null,
    contentHash: '0'.repeat(64),
    ...overrides,
  };
  value.fullNarration = [
    value.hook,
    ...value.narrativeBlocks.map(({ narration }: any) => narration),
    value.cta,
  ]
    .filter(Boolean)
    .join('\n\n');
  value.contentHash = scriptContentHash(value);
  return value;
}
function setup(path: string, editorial = true) {
  const repository = new ScriptRepository(path);
  repository.create(project(), { createdAt: STARTED_AT });
  new PipelineRunService(repository).start(request());
  seedResearch(repository.db);
  if (!editorial) return { repository, selected: null };
  const [{ idea, score }] = new IdeaService(repository).registerBatch(
    submission(),
  );
  const value: any = {
    schemaVersion: IDEA_SELECTION_CONTRACT_VERSION,
    ideaSelectionId: 'selection_001',
    pipelineRunId: idea.pipelineRunId,
    projectId: idea.projectId,
    projectVersion: idea.projectVersion,
    ideaBatchId: idea.ideaBatchId,
    ideaCandidateId: idea.ideaCandidateId,
    ideaScoreId: score.ideaScoreId,
    ideaContentHash: idea.contentHash,
    ideaScoreContentHash: score.contentHash,
    decision: 'SELECTED',
    actor: { type: 'HUMAN', id: 'operator_001' },
    decidedAt: '2026-09-28T13:00:00.000Z',
    editorialRationale: 'Escolha editorial explícita',
    revision: 1,
    supersedesIdeaSelectionId: null,
    contentHash: '0'.repeat(64),
  };
  value.contentHash = selectionContentHash(value);
  const selected = new IdeaSelectionService(repository).select(value);
  return { repository, selected };
}
function submission(): any {
  return {
    ideaBatchId: 'idea_batch_1',
    pipelineRunId: 'run_e04_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    researchShortlistId: 'research-shortlist:001',
    origin: 'OPERATOR',
    createdAt: '2026-09-28T12:00:00.000Z',
    proposals: [
      {
        ideaCandidateId: 'idea_candidate_1',
        title: 'IA para organizar a rotina',
        editorialAngle: 'Ferramentas práticas para produtividade',
        evidenceCandidateIds: ['candidate-1'],
        referenceInsightId: null,
        referenceEvidenceIds: [],
      },
    ],
  };
}
function seedResearch(db: any): any {
  const shortlist = researchShortlist();
  db.prepare(
    `INSERT INTO trend_runs (id, schema_version, state, created_at, updated_at, ranking_config_version, payload_json)
    VALUES (?, ?, 'SUCCEEDED', ?, ?, 'trend-score/1.0.0', '{}')`,
  ).run('trend-run-1', RADAR_CONTRACT_VERSION, STARTED_AT, STARTED_AT);
  db.prepare(
    `INSERT INTO research_daily_runs
    (id, pipeline_run_id, project_id, project_version, logical_date, timezone, research_input_hash, config_hash, config_json, source_plan_json, state, trend_run_id, started_at)
    VALUES (?, ?, ?, 1, '2026-09-28', 'America/Sao_Paulo', ?, ?, '{}', '[]', 'COMPLETED', ?, ?)`,
  ).run(
    'research-daily-1',
    'run_e04_001',
    'project_curiosidades_ia',
    'a'.repeat(64),
    'b'.repeat(64),
    'trend-run-1',
    STARTED_AT,
  );
  db.prepare(
    `INSERT INTO research_artifacts
    (artifact_id, schema_version, research_daily_run_id, trend_run_id, pipeline_run_id, project_id, project_version, content_hash, payload_json, created_at)
    VALUES (?, 'research-topic-catalog/1.0.0', ?, ?, ?, ?, 1, ?, '{}', ?)`,
  ).run(
    'research-catalog:001',
    'research-daily-1',
    'trend-run-1',
    'run_e04_001',
    'project_curiosidades_ia',
    'c'.repeat(64),
    STARTED_AT,
  );
  db.prepare(
    `INSERT INTO research_shortlists
    (artifact_id, schema_version, revision, pipeline_run_id, project_id, project_version, logical_date, research_artifact_id, trend_run_id, research_input_hash,
     research_topic_catalog_hash, trend_catalog_hash, policy_version, state, content_hash, payload_json, created_at)
    VALUES (?, ?, 1, ?, ?, 1, '2026-09-28', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
  ).run(
    shortlist.artifactId,
    shortlist.schemaVersion,
    shortlist.pipelineRunId,
    shortlist.projectId,
    shortlist.researchTopicCatalogArtifactId,
    shortlist.trendRunId,
    shortlist.researchInputHash,
    shortlist.researchTopicCatalogHash,
    shortlist.trendCatalogHash,
    shortlist.policy.version,
    shortlist.contentHash,
    JSON.stringify(shortlist),
    shortlist.createdAt,
  );
}
function researchShortlist(): any {
  const item = shortlistItem();
  return {
    schemaVersion: RESEARCH_SHORTLIST_CONTRACT_VERSION,
    artifactId: 'research-shortlist:001',
    artifactType: 'research_shortlist',
    revision: 1,
    pipelineRunId: 'run_e04_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    logicalDate: '2026-09-28',
    timezone: 'America/Sao_Paulo',
    createdAt: STARTED_AT,
    createdBy: 'SYSTEM',
    researchInputHash: 'a'.repeat(64),
    researchTopicCatalogArtifactId: 'research-catalog:001',
    researchTopicCatalogHash: 'c'.repeat(64),
    trendRunId: 'trend-run-1',
    trendCatalogHash: 'd'.repeat(64),
    policy: DEFAULT_RESEARCH_SHORTLIST_POLICY,
    state: 'COMPLETED',
    orderedCandidates: [item],
    decisions: [
      {
        candidateId: item.candidate.id,
        decision: 'INCLUDED',
        position: 1,
        reasons: item.inclusionReasons,
      },
    ],
    coverage: [],
    gaps: [],
    contentHash: 'e'.repeat(64),
    rights: {
      usageCondition: 'REFERENCE_ONLY',
      mediaDownloaded: false,
      republicationAllowed: false,
    },
  };
}
function shortlistItem(): any {
  const component: any = {
    availability: 'AVAILABLE',
    value: 50,
    evidenceSnapshotIds: ['snapshot-1'],
  };
  return {
    position: 1,
    candidate: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: 'candidate-1',
      identityKey: 'YOUTUBE:video-1',
      platform: 'YOUTUBE',
      platformVideoId: 'video-1',
      canonicalUrl: 'https://youtube.com/watch?v=video-1',
      state: 'ACTIVE',
      firstSeenAt: STARTED_AT,
      lastSeenAt: STARTED_AT,
      reappearanceCount: 1,
      durationSeconds: 45,
      publishedAt: STARTED_AT,
      region: 'BR',
      language: 'pt-BR',
      usageCondition: 'REFERENCE_ONLY',
      snapshotIds: ['snapshot-1'],
      topicClusterIds: [],
    },
    cluster: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: 'cluster-1',
      label: 'cluster-1',
      niche: 'inteligência artificial',
      subtheme: 'produtividade',
      likelyAudience: 'adultos',
      narrativePattern: 'explicação',
      localization: 'Brasil',
      candidateIds: ['candidate-1'],
      evidenceSnapshotIds: ['snapshot-1'],
      createdBy: 'OLLAMA',
      explanation: 'evidência persistida',
    },
    score: {
      schemaVersion: RADAR_CONTRACT_VERSION,
      id: 'score-1',
      candidateId: 'candidate-1',
      formulaVersion: 'trend-score/1.0.0',
      calculatedAt: STARTED_AT,
      value: 80,
      confidence: 1,
      components: {
        velocity: component,
        engagement: component,
        recency: component,
        recurrence: component,
      },
      explanation: 'score persistido',
    },
    inclusionReasons: ['BASE_RANK', 'DIVERSITY_ACCEPTED'],
  };
}
function request(): any {
  return {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: 'run_e04_001',
    projectId: 'project_curiosidades_ia',
    projectVersion: 1,
    startedAt: STARTED_AT,
  };
}
function project(): any {
  return {
    id: 'project_curiosidades_ia',
    name: 'Curiosidades IA',
    version: 1,
    niche: 'inteligência artificial',
    subniches: ['ferramentas'],
    audience: {
      profile: 'Pessoas interessadas em tecnologia',
      language: 'pt-BR',
    },
    references: [],
    channel: {
      publishing: {
        contentsPerDay: 1,
        networks: ['instagram'],
        timezone: 'America/Sao_Paulo',
        times: ['10:00'],
      },
    },
  };
}
export { submission, script, researchShortlist };
export function contentFixture({ editorial = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-content-'));
  const database = join(directory, 'catalog.sqlite');
  const { repository, selected } = setup(database, editorial);
  repository.close();
  return {
    database,
    selected,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
