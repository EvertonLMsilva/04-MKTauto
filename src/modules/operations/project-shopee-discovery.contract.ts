import {
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
} from '../affiliate/domain/shopee-dynamic.js';
import { buildShopeeOffersQuery } from '../affiliate/infrastructure/shopee-offers.js';
export const PROJECT_DISCOVERY_VERSION =
  'operations-project-shopee-discovery/1.0.0' as const;
export interface ProjectShopeeDiscoveryInput {
  schemaVersion: typeof PROJECT_DISCOVERY_VERSION;
  projectId?: string;
  projectVersion?: number;
  niche: string;
  queries: ShopeeDynamicConfiguration['queries'];
  maxPages: number;
  maxCandidates: number;
  minCommissionRate?: string;
  minPrice?: string;
  maxPrice?: string;
  excludedProductIds?: string[];
  excludedShopIds?: string[];
  excludedTerms?: string[];
}
export function discoveryFailure(code: string, status = 400): never {
  throw Object.assign(new Error(code), { code, status });
}
export function projectDiscoveryInput(projectId: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    discoveryFailure('SHOPEE_PREVIEW_INPUT_INVALID');
  const input = value as ProjectShopeeDiscoveryInput;
  const allowed = [
    'schemaVersion',
    'projectId',
    'projectVersion',
    'niche',
    'queries',
    'maxPages',
    'maxCandidates',
    'minCommissionRate',
    'minPrice',
    'maxPrice',
    'excludedProductIds',
    'excludedShopIds',
    'excludedTerms',
  ];
  if (
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    input.schemaVersion !== PROJECT_DISCOVERY_VERSION ||
    (input.projectId !== undefined && input.projectId !== projectId) ||
    (input.projectVersion !== undefined &&
      (!Number.isSafeInteger(input.projectVersion) || input.projectVersion < 1))
  )
    discoveryFailure('SHOPEE_PREVIEW_INPUT_INVALID');
  try {
    const configuration = validateDynamicConfiguration({
      projectId,
      niche: input.niche,
      queries: input.queries,
      maxPages: input.maxPages,
      maxSelected: input.maxCandidates,
      ...(input.minCommissionRate !== undefined
        ? { minCommissionRate: input.minCommissionRate }
        : {}),
      ...(input.minPrice !== undefined ? { minPrice: input.minPrice } : {}),
      ...(input.maxPrice !== undefined ? { maxPrice: input.maxPrice } : {}),
      excludedProductIds:
        input.excludedProductIds === undefined ? [] : input.excludedProductIds,
      excludedShopIds:
        input.excludedShopIds === undefined ? [] : input.excludedShopIds,
      excludedTerms:
        input.excludedTerms === undefined ? [] : input.excludedTerms,
      subIds: [],
      authorizations: [],
    });
    for (const query of configuration.queries) buildShopeeOffersQuery(query);
    return { configuration, projectVersion: input.projectVersion };
  } catch {
    return discoveryFailure('SHOPEE_PREVIEW_INPUT_INVALID');
  }
}
/** Logical handoff only. Each existing domain retains its own review and effect gates. */
export const discoveryHandoff = Object.freeze({
  next: 'REVIEW_RIGHTS_AND_ASSOCIATION',
  stages: [
    'PROJECT',
    'DISCOVERY',
    'CANDIDATES',
    'RIGHTS_AND_ASSOCIATION_REVIEW',
    'EXISTING_AFFILIATE_REGISTRATION',
    'CAMPAIGN',
    'BRIEFING',
    'OPERATIONS',
  ],
  campaignCreated: false,
  registrationPerformed: false,
  linkGenerated: false,
});
