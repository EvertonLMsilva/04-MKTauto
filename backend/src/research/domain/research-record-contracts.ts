export { ContractValidationError } from '../../project/domain/project.errors.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const RADAR_CONTRACT_VERSION = 'trend-contracts/1.2.0';
const SUPPORTED_RADAR_CONTRACT_VERSIONS = Object.freeze([
  'trend-contracts/1.0.0',
  'trend-contracts/1.1.0',
  RADAR_CONTRACT_VERSION,
]);
export const TREND_SCORE_VERSION = 'trend-score/1.0.0';
export const TREND_PLATFORMS = Object.freeze([
  'YOUTUBE',
  'INSTAGRAM',
  'THREADS',
  'TIKTOK',
]);
export const SOURCE_RUN_STATES = Object.freeze([
  'SUCCESS',
  'PARTIAL',
  'BLOCKED_BY_PROVIDER',
  'FAILED',
]);
export const TREND_CANDIDATE_STATES = Object.freeze([
  'DISCOVERED',
  'ACTIVE',
  'SHORTLISTED',
  'SELECTED',
  'STALE',
]);
export function canonicalTrendIdentity({
  platform,
  platformVideoId,
  canonicalUrl,
}: any): any {
  requireEnum(platform, TREND_PLATFORMS, 'platform');
  if (platformVideoId !== undefined && platformVideoId !== null) {
    requirePlatformVideoId(platformVideoId, 'platformVideoId');
    return `${platform}:${platformVideoId}`;
  }
  return `${platform}:url:${normalizeCanonicalUrl(canonicalUrl, platform)}`;
}
export function validateTrendCandidate(value: any): any {
  requireRecord(value, 'candidate');
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'identityKey',
      'platform',
      'platformVideoId',
      'canonicalUrl',
      'state',
      'firstSeenAt',
      'lastSeenAt',
      'reappearanceCount',
      'durationSeconds',
      'publishedAt',
      'region',
      'language',
      'usageCondition',
      'snapshotIds',
      'topicClusterIds',
      'author',
      'title',
      'category',
      'rankingExclusionReason',
    ],
    'candidate',
  );
  requireSchemaVersion(value.schemaVersion, 'candidate.schemaVersion');
  requireIdentifier(value.id, 'candidate.id');
  requireEnum(value.platform, TREND_PLATFORMS, 'candidate.platform');
  if (value.platformVideoId !== undefined)
    requirePlatformVideoId(value.platformVideoId, 'candidate.platformVideoId');
  normalizeCanonicalUrl(value.canonicalUrl, value.platform);
  requireTextContract(value.identityKey, 'candidate.identityKey');
  const expectedIdentity = canonicalTrendIdentity(value);
  if (value.identityKey !== expectedIdentity)
    fail(
      'INVALID_IDENTITY',
      'candidate.identityKey',
      `esperado ${expectedIdentity}`,
    );
  requireEnum(value.state, TREND_CANDIDATE_STATES, 'candidate.state');
  requireDateTime(value.firstSeenAt, 'candidate.firstSeenAt');
  requireDateTime(value.lastSeenAt, 'candidate.lastSeenAt');
  requireDateTime(value.publishedAt, 'candidate.publishedAt');
  if (Date.parse(value.lastSeenAt) < Date.parse(value.firstSeenAt))
    fail('INVALID_DATETIME', 'candidate.lastSeenAt', 'anterior a firstSeenAt');
  if (!Number.isInteger(value.reappearanceCount) || value.reappearanceCount < 1)
    fail(
      'INVALID_RANGE',
      'candidate.reappearanceCount',
      'deve ser inteiro positivo',
    );
  validateCandidateDuration(value.durationSeconds);
  optionalText(value.region, 'candidate.region');
  optionalText(value.language, 'candidate.language');
  optionalText(value.author, 'candidate.author');
  optionalText(value.title, 'candidate.title');
  optionalText(value.category, 'candidate.category');
  optionalText(
    value.rankingExclusionReason,
    'candidate.rankingExclusionReason',
  );
  requireEnum(
    value.usageCondition,
    ['REFERENCE_ONLY', 'USAGE_UNKNOWN', 'USAGE_CONFIRMED'],
    'candidate.usageCondition',
  );
  requireIdentifierArray(value.snapshotIds, 'candidate.snapshotIds');
  requireIdentifierArray(value.topicClusterIds, 'candidate.topicClusterIds');
  return value;
}
export function validateSourceRun(value: any): any {
  requireRecord(value, 'sourceRun');
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'trendRunId',
      'platform',
      'status',
      'startedAt',
      'completedAt',
      'capabilities',
      'coverage',
      'gaps',
      'errorCode',
    ],
    'sourceRun',
  );
  requireSchemaVersion(value.schemaVersion, 'sourceRun.schemaVersion');
  requireIdentifier(value.id, 'sourceRun.id');
  requireIdentifier(value.trendRunId, 'sourceRun.trendRunId');
  requireEnum(value.platform, TREND_PLATFORMS, 'sourceRun.platform');
  requireEnum(value.status, SOURCE_RUN_STATES, 'sourceRun.status');
  requireDateTime(value.startedAt, 'sourceRun.startedAt');
  requireDateTime(value.completedAt, 'sourceRun.completedAt');
  requireRecord(value.capabilities, 'sourceRun.capabilities');
  requireExactKeys(
    value.capabilities,
    ['discovery', 'metrics', 'supportsRegions', 'limitations'],
    'sourceRun.capabilities',
    true,
  );
  requireEnum(
    value.capabilities.discovery,
    [
      'GLOBAL_TRENDS',
      'PUBLIC_QUERY',
      'HASHTAG_SEARCH',
      'AUTHORIZED_ONLY',
      'UNAVAILABLE',
    ],
    'sourceRun.capabilities.discovery',
  );
  requireEnumArray(
    value.capabilities.metrics,
    ['VIEWS', 'LIKES', 'COMMENTS', 'SHARES'],
    'sourceRun.capabilities.metrics',
  );
  if (typeof value.capabilities.supportsRegions !== 'boolean')
    fail(
      'INVALID_TYPE',
      'sourceRun.capabilities.supportsRegions',
      'deve ser booleano',
    );
  requireTextArray(
    value.capabilities.limitations,
    'sourceRun.capabilities.limitations',
  );
  requireRecord(value.coverage, 'sourceRun.coverage');
  requireExactKeys(
    value.coverage,
    ['requestedRegions', 'coveredRegions', 'complete'],
    'sourceRun.coverage',
    true,
  );
  requireTextArray(
    value.coverage.requestedRegions,
    'sourceRun.coverage.requestedRegions',
  );
  requireTextArray(
    value.coverage.coveredRegions,
    'sourceRun.coverage.coveredRegions',
  );
  if (typeof value.coverage.complete !== 'boolean')
    fail('INVALID_TYPE', 'sourceRun.coverage.complete', 'deve ser booleano');
  requireTextArray(value.gaps, 'sourceRun.gaps');
  optionalText(value.errorCode, 'sourceRun.errorCode');
  if (
    value.status === 'SUCCESS' &&
    (!value.coverage.complete || value.gaps.length > 0)
  )
    fail(
      'INVALID_COVERAGE',
      'sourceRun',
      'SUCCESS exige cobertura completa e nenhuma lacuna',
    );
  if (
    value.status === 'PARTIAL' &&
    (value.coverage.complete || value.gaps.length === 0)
  )
    fail(
      'INVALID_COVERAGE',
      'sourceRun',
      'PARTIAL exige cobertura incompleta e lacunas explícitas',
    );
  if (
    ['BLOCKED_BY_PROVIDER', 'FAILED'].includes(value.status) &&
    !value.errorCode
  )
    fail(
      'REQUIRED',
      'sourceRun.errorCode',
      'obrigatório para fonte bloqueada ou falha',
    );
  if (
    ['BLOCKED_BY_PROVIDER', 'FAILED'].includes(value.status) &&
    (value.coverage.complete || value.gaps.length === 0)
  ) {
    fail(
      'INVALID_COVERAGE',
      'sourceRun',
      'bloqueio ou falha exige cobertura incompleta e lacuna explícita',
    );
  }
  return value;
}
export function validateTopicCluster(
  value: any,
  knownCandidateIds: any = [],
  knownSnapshotIds: any = [],
): any {
  requireRecord(value, 'topicCluster');
  const localizationField =
    value.schemaVersion === RADAR_CONTRACT_VERSION
      ? 'localization'
      : 'ptBrLocalization';
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'label',
      'niche',
      'subtheme',
      'likelyAudience',
      'narrativePattern',
      localizationField,
      'candidateIds',
      'evidenceSnapshotIds',
      'createdBy',
      'explanation',
    ],
    'topicCluster',
    true,
  );
  requireSchemaVersion(value.schemaVersion, 'topicCluster.schemaVersion');
  requireIdentifier(value.id, 'topicCluster.id');
  requireTextContract(value.label, 'topicCluster.label');
  requireTextContract(value.niche, 'topicCluster.niche');
  requireTextContract(value.subtheme, 'topicCluster.subtheme');
  requireTextContract(value.likelyAudience, 'topicCluster.likelyAudience');
  requireTextContract(value.narrativePattern, 'topicCluster.narrativePattern');
  requireTextContract(
    value[localizationField],
    `topicCluster.${localizationField}`,
  );
  requireIdentifierArray(value.candidateIds, 'topicCluster.candidateIds', true);
  requireIdentifierArray(
    value.evidenceSnapshotIds,
    'topicCluster.evidenceSnapshotIds',
    true,
  );
  requireKnownIds(
    value.candidateIds,
    knownCandidateIds,
    'topicCluster.candidateIds',
  );
  requireKnownIds(
    value.evidenceSnapshotIds,
    knownSnapshotIds,
    'topicCluster.evidenceSnapshotIds',
  );
  requireEnum(value.createdBy, ['HUMAN', 'OLLAMA'], 'topicCluster.createdBy');
  requireTextContract(value.explanation, 'topicCluster.explanation');
  return value;
}
export function validateTrendScore(value: any): any {
  requireRecord(value, 'score');
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'candidateId',
      'formulaVersion',
      'calculatedAt',
      'value',
      'confidence',
      'components',
      'explanation',
    ],
    'score',
    true,
  );
  requireSchemaVersion(value.schemaVersion, 'score.schemaVersion');
  requireIdentifier(value.id, 'score.id');
  requireIdentifier(value.candidateId, 'score.candidateId');
  if (value.formulaVersion !== TREND_SCORE_VERSION)
    fail(
      'UNSUPPORTED_VERSION',
      'score.formulaVersion',
      `esperado ${TREND_SCORE_VERSION}`,
    );
  requireDateTime(value.calculatedAt, 'score.calculatedAt');
  requireRange(value.value, 0, 100, 'score.value');
  requireRange(value.confidence, 0, 1, 'score.confidence');
  requireRecord(value.components, 'score.components');
  requireExactKeys(
    value.components,
    ['velocity', 'engagement', 'recency', 'recurrence'],
    'score.components',
    true,
  );
  for (const component of ['velocity', 'engagement', 'recency', 'recurrence']) {
    validateScoreComponent(
      value.components[component],
      `score.components.${component}`,
    );
  }
  requireTextContract(value.explanation, 'score.explanation');
  const available = Object.values(value.components).filter(
    (component: any) => component.availability === 'AVAILABLE',
  ).length;
  if (available < 4 && value.confidence >= 1)
    fail(
      'INVALID_CONFIDENCE',
      'score.confidence',
      'componente indisponível deve reduzir confiança',
    );
  return value;
}
function validateScoreComponent(value: any, path: any): any {
  validateAvailability(value, path, {
    max: 100,
    code: 'INVALID_SCORE_COMPONENT',
    extraKeys: ['evidenceSnapshotIds'],
  });
  requireIdentifierArray(
    value.evidenceSnapshotIds,
    `${path}.evidenceSnapshotIds`,
    true,
  );
}
function validateAvailability(
  value: any,
  path: any,
  { max, code, extraKeys = [] }: any,
): any {
  requireRecord(value, path);
  requireExactKeys(
    value,
    ['availability', 'value', 'reason', ...extraKeys],
    path,
  );
  requireEnum(
    value.availability,
    ['AVAILABLE', 'UNAVAILABLE'],
    `${path}.availability`,
  );
  if (value.availability === 'AVAILABLE') {
    if (value.reason !== undefined)
      fail(code, path, 'valor disponível não aceita reason');
    if (!Number.isFinite(value.value) || value.value < 0 || value.value > max)
      fail(code, `${path}.value`, `deve estar entre 0 e ${max}`);
  } else {
    if (Object.hasOwn(value, 'value'))
      fail(
        code,
        `${path}.value`,
        'métrica indisponível não pode conter valor estimado',
      );
    requireTextContract(value.reason, `${path}.reason`);
  }
}
function validateCandidateDuration(value: any): any {
  if (Number.isFinite(value)) {
    if (value < 15 || value > 180)
      fail(
        'INVALID_DURATION',
        'candidate.durationSeconds',
        'deve estar entre 15 e 180 segundos',
      );
    return;
  }
  validateAvailability(value, 'candidate.durationSeconds', {
    max: 180,
    code: 'INVALID_DURATION',
  });
  if (value.availability === 'AVAILABLE' && value.value < 15) {
    fail(
      'INVALID_DURATION',
      'candidate.durationSeconds.value',
      'deve estar entre 15 e 180 segundos',
    );
  }
}
function requireSchemaVersion(value: any, path: any): any {
  if (!SUPPORTED_RADAR_CONTRACT_VERSIONS.includes(value)) {
    fail(
      'UNSUPPORTED_VERSION',
      path,
      `versões aceitas: ${SUPPORTED_RADAR_CONTRACT_VERSIONS.join(', ')}`,
    );
  }
}
function requireRecord(value: any, path: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path, 'deve ser objeto');
}
function requireExactKeys(
  value: any,
  allowed: any,
  path: any,
  requireAll: any = false,
): any {
  const unknown = Object.keys(value).filter(
    (key: any) => !allowed.includes(key),
  );
  if (unknown.length > 0)
    fail('UNKNOWN_FIELD', path, `campos desconhecidos: ${unknown.join(', ')}`);
  if (requireAll)
    for (const key of allowed)
      if (!Object.hasOwn(value, key))
        fail('REQUIRED', `${path}.${key}`, 'campo obrigatório');
}
function requireIdentifier(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value))
    fail('INVALID_ID', path, 'formato inválido');
}
function requirePlatformVideoId(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value))
    fail('INVALID_ID', path, 'formato inválido');
}
function requireIdentifierArray(
  value: any,
  path: any,
  nonEmpty: any = false,
): any {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0))
    fail(
      'INVALID_TYPE',
      path,
      nonEmpty ? 'deve ser array não vazio' : 'deve ser array',
    );
  for (const item of value) requireIdentifier(item, path);
  if (new Set(value).size !== value.length)
    fail('DUPLICATE_ID', path, 'não aceita IDs duplicados');
}
function requireTextArray(value: any, path: any): any {
  if (!Array.isArray(value)) fail('INVALID_TYPE', path, 'deve ser array');
  for (const item of value) requireTextContract(item, path);
  if (new Set(value).size !== value.length)
    fail('DUPLICATE_VALUE', path, 'não aceita valores duplicados');
}
function requireEnumArray(value: any, allowed: any, path: any): any {
  if (!Array.isArray(value)) fail('INVALID_TYPE', path, 'deve ser array');
  for (const item of value) requireEnum(item, allowed, path);
  if (new Set(value).size !== value.length)
    fail('DUPLICATE_VALUE', path, 'não aceita valores duplicados');
}
function requireKnownIds(values: any, knownValues: any, path: any): any {
  const known = new Set(knownValues);
  for (const value of values)
    if (!known.has(value))
      fail('UNKNOWN_EVIDENCE', path, `evidência desconhecida: ${value}`);
}
function requireEnum(value: any, allowed: any, path: any): any {
  if (!allowed.includes(value))
    fail('INVALID_ENUM', path, `valores aceitos: ${allowed.join(', ')}`);
}
function requireTextContract(value: any, path: any): any {
  if (typeof value !== 'string' || value.trim() === '')
    fail('REQUIRED', path, 'texto obrigatório');
}
function optionalText(value: any, path: any): any {
  if (value !== undefined) requireTextContract(value, path);
}
function requireDateTime(value: any, path: any): any {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail('INVALID_DATETIME', path, 'deve ser data ISO 8601');
  }
}
function requireRange(value: any, min: any, max: any, path: any): any {
  if (!Number.isFinite(value) || value < min || value > max)
    fail('INVALID_RANGE', path, `deve estar entre ${min} e ${max}`);
}
function normalizeCanonicalUrl(value: any, platform: any): any {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_URL', 'canonicalUrl', 'URL inválida');
  }
  if (url.protocol !== 'https:')
    fail('INVALID_URL', 'canonicalUrl', 'deve usar HTTPS');
  if (url.username || url.password || url.port)
    fail(
      'INVALID_URL',
      'canonicalUrl',
      'credenciais e portas não são permitidas',
    );
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const hosts: any = {
    YOUTUBE: ['youtube.com', 'youtu.be'],
    INSTAGRAM: ['instagram.com'],
    THREADS: ['threads.net'],
    TIKTOK: ['tiktok.com'],
  };
  if (
    !hosts[platform]?.some(
      (allowed: any) => host === allowed || host.endsWith(`.${allowed}`),
    )
  ) {
    fail('INVALID_URL', 'canonicalUrl', `host não pertence a ${platform}`);
  }
  url.hash = '';
  url.hostname = host;
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (
    platform === 'YOUTUBE' &&
    host === 'youtube.com' &&
    url.pathname === '/watch'
  ) {
    const videoId = url.searchParams.get('v');
    if (!videoId)
      fail(
        'INVALID_URL',
        'canonicalUrl',
        'URL watch do YouTube exige parâmetro v',
      );
    requirePlatformVideoId(videoId, 'canonicalUrl.v');
    url.search = `?v=${encodeURIComponent(videoId!)}`;
  } else {
    url.search = '';
  }
  return url.toString().replace(/\/$/, '');
}
function fail(code: any, path: any, message: any): never {
  throw new ContractValidationError(code, path, message);
}

export const TREND_RUN_STATES: any = Object.freeze([
  'CREATED',
  'COLLECTING',
  'NORMALIZING',
  'CLUSTERING',
  'RANKING',
  'COMPLETED',
  'COMPLETED_WITH_GAPS',
  'FAILED',
]);
export function validateTrendSnapshot(value: any): any {
  requireRecord(value, 'snapshot');
  requireExactKeys(
    value,
    ['schemaVersion', 'id', 'candidateId', 'capturedAt', 'metrics'],
    'snapshot',
  );
  requireSchemaVersion(value.schemaVersion, 'snapshot.schemaVersion');
  requireIdentifier(value.id, 'snapshot.id');
  requireIdentifier(value.candidateId, 'snapshot.candidateId');
  requireDateTime(value.capturedAt, 'snapshot.capturedAt');
  requireRecord(value.metrics, 'snapshot.metrics');
  requireExactKeys(
    value.metrics,
    ['views', 'likes', 'comments', 'shares'],
    'snapshot.metrics',
    true,
  );
  for (const metric of ['views', 'likes', 'comments', 'shares']) {
    validateAvailability(value.metrics[metric], `snapshot.metrics.${metric}`, {
      max: Number.MAX_SAFE_INTEGER,
      code: 'INVALID_METRIC',
    });
  }
  return value;
}
export function validateTrendRun(value: any, sourceRuns: any = []): any {
  requireRecord(value, 'run');
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'state',
      'createdAt',
      'updatedAt',
      'sourceRunIds',
      'candidateIds',
      'rankingConfigVersion',
    ],
    'run',
  );
  requireSchemaVersion(value.schemaVersion, 'run.schemaVersion');
  requireIdentifier(value.id, 'run.id');
  requireEnum(value.state, TREND_RUN_STATES, 'run.state');
  requireDateTime(value.createdAt, 'run.createdAt');
  requireDateTime(value.updatedAt, 'run.updatedAt');
  requireIdentifierArray(value.sourceRunIds, 'run.sourceRunIds');
  requireIdentifierArray(value.candidateIds, 'run.candidateIds');
  requireTextContract(value.rankingConfigVersion, 'run.rankingConfigVersion');
  const validatedSources: any = sourceRuns.map(validateSourceRun);
  const knownIds: any = new Set(
    validatedSources.map((item: any): any => item.id),
  );
  for (const id of value.sourceRunIds)
    if (validatedSources.length > 0 && !knownIds.has(id))
      fail('UNKNOWN_EVIDENCE', 'run.sourceRunIds', `fonte desconhecida: ${id}`);
  const hasGap: any = validatedSources.some(
    (item: any): any => item.status !== 'SUCCESS',
  );
  if (value.state === 'COMPLETED' && hasGap)
    fail(
      'INVALID_RUN_COVERAGE',
      'run.state',
      'fontes incompletas exigem COMPLETED_WITH_GAPS',
    );
  if (
    value.state === 'COMPLETED_WITH_GAPS' &&
    validatedSources.length > 0 &&
    !hasGap
  )
    fail('INVALID_RUN_COVERAGE', 'run.state', 'nenhuma lacuna declarada');
  return value;
}
export function validateAiTopicProposal(
  value: any,
  knownCandidateIds: any,
  knownSnapshotIds: any,
): any {
  requireRecord(value, 'aiProposal');
  const allowed: any = [
    'label',
    'niche',
    'subtheme',
    'likelyAudience',
    'narrativePattern',
    'localization',
    'candidateIds',
    'evidenceSnapshotIds',
    'explanation',
  ];
  const unknown: any = Object.keys(value).filter(
    (key: any): any => !allowed.includes(key),
  );
  if (unknown.length > 0)
    fail(
      'AI_EVIDENCE_MUTATION',
      'aiProposal',
      `campos não permitidos: ${unknown.join(', ')}`,
    );
  requireExactKeys(value, allowed, 'aiProposal', true);
  requireTextContract(value.label, 'aiProposal.label');
  requireTextContract(value.niche, 'aiProposal.niche');
  requireTextContract(value.subtheme, 'aiProposal.subtheme');
  requireTextContract(value.likelyAudience, 'aiProposal.likelyAudience');
  requireTextContract(value.narrativePattern, 'aiProposal.narrativePattern');
  requireTextContract(value.localization, 'aiProposal.localization');
  requireIdentifierArray(value.candidateIds, 'aiProposal.candidateIds', true);
  requireIdentifierArray(
    value.evidenceSnapshotIds,
    'aiProposal.evidenceSnapshotIds',
    true,
  );
  requireKnownIds(
    value.candidateIds,
    knownCandidateIds,
    'aiProposal.candidateIds',
  );
  requireKnownIds(
    value.evidenceSnapshotIds,
    knownSnapshotIds,
    'aiProposal.evidenceSnapshotIds',
  );
  requireTextContract(value.explanation, 'aiProposal.explanation');
  return value;
}
export function serializePublicTrendCatalog(value: any): any {
  requireRecord(value, 'catalog');
  const sourceRuns: any = (value.sourceRuns ?? []).map((item: any): any =>
    validateSourceRun(
      pick(item, [
        'schemaVersion',
        'id',
        'trendRunId',
        'platform',
        'status',
        'startedAt',
        'completedAt',
        'capabilities',
        'coverage',
        'gaps',
        'errorCode',
      ]),
    ),
  );
  const run: any = validateTrendRun(
    pick(value.run, [
      'schemaVersion',
      'id',
      'state',
      'createdAt',
      'updatedAt',
      'sourceRunIds',
      'candidateIds',
      'rankingConfigVersion',
    ]),
    sourceRuns,
  );
  const candidates: any = (value.candidates ?? []).map((item: any): any =>
    validateTrendCandidate(
      pick(item, [
        'schemaVersion',
        'id',
        'identityKey',
        'platform',
        'platformVideoId',
        'canonicalUrl',
        'state',
        'firstSeenAt',
        'lastSeenAt',
        'reappearanceCount',
        'durationSeconds',
        'publishedAt',
        'region',
        'language',
        'usageCondition',
        'snapshotIds',
        'topicClusterIds',
        'author',
        'title',
        'category',
        'rankingExclusionReason',
      ]),
    ),
  );
  const snapshots: any = (value.snapshots ?? []).map((item: any): any =>
    validateTrendSnapshot(
      pick(item, [
        'schemaVersion',
        'id',
        'candidateId',
        'capturedAt',
        'metrics',
      ]),
    ),
  );
  const candidateIds: any = candidates.map((item: any): any => item.id);
  const snapshotIds: any = snapshots.map((item: any): any => item.id);
  const topicClusters: any = (value.topicClusters ?? []).map((item: any): any =>
    validateTopicCluster(
      pick(item, [
        'schemaVersion',
        'id',
        'label',
        'niche',
        'subtheme',
        'likelyAudience',
        'narrativePattern',
        'ptBrLocalization',
        'localization',
        'candidateIds',
        'evidenceSnapshotIds',
        'createdBy',
        'explanation',
      ]),
      candidateIds,
      snapshotIds,
    ),
  );
  const scores: any = (value.scores ?? []).map((item: any): any =>
    validateTrendScore(
      pick(item, [
        'schemaVersion',
        'id',
        'candidateId',
        'formulaVersion',
        'calculatedAt',
        'value',
        'confidence',
        'components',
        'explanation',
      ]),
    ),
  );
  return {
    schemaVersion: RADAR_CONTRACT_VERSION,
    layout: TREND_CATALOG_LAYOUT,
    run,
    sourceRuns,
    candidates,
    snapshots,
    topicClusters,
    scores,
  };
}
function pick(value: any, keys: any): any {
  requireRecord(value, 'value');
  return Object.fromEntries(
    keys
      .filter((key: any): any => Object.hasOwn(value, key))
      .map((key: any): any => [key, value[key]]),
  );
}

export const TREND_CATALOG_LAYOUT = Object.freeze({
  root: 'data/trends/<project-id>/v<project-version>/<YYYY-MM-DD>/<pipeline-run-id>',
  legacyRoot: 'data/trends/<YYYY-MM-DD>',
  files: Object.freeze(['catalog.json', 'ranking.csv', 'report.html']),
  candidateDirectory: 'candidates/<candidate-id>',
  candidateFiles: Object.freeze([
    'candidate.json',
    'thumbnail.<ext> (somente quando permitido)',
  ]),
  mediaFilesAllowed: false,
});
