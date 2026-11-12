import {
  affiliateHash,
  affiliateIdentifier,
} from '../affiliate/domain/affiliate-contracts.js';
import {
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
} from '../affiliate/domain/shopee-dynamic.js';
import { buildShopeeOffersQuery } from '../affiliate/infrastructure/shopee-offers.js';
import { validateShopeeLinkInput } from '../affiliate/infrastructure/shopee-links.js';
import { instant } from '../content-operations/domain/campaign.js';
import { discoveryFailure } from './project-shopee-discovery.contract.js';
export interface ProjectHandoffInput {
  schemaVersion: 'operations-project-shopee-handoff/1.0.0';
  mode: 'FAKE';
  intent: 'PREPARE_FAKE_CATALOG';
  projectVersion: number;
  occurrenceId: string;
  requestedAt: string;
  configuration: ShopeeDynamicConfiguration;
  configurationHash: string;
  identityHash: string;
}
export function handoffScope(projectId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    discoveryFailure('SHOPEE_HANDOFF_INPUT_INVALID');
  const input = raw as ProjectHandoffInput;
  if (
    Object.keys(input).sort().join(',') !==
      'configuration,configurationHash,identityHash,intent,mode,occurrenceId,projectVersion,requestedAt,schemaVersion' ||
    input.schemaVersion !== 'operations-project-shopee-handoff/1.0.0' ||
    input.mode !== 'FAKE' ||
    input.intent !== 'PREPARE_FAKE_CATALOG' ||
    !Number.isSafeInteger(input.projectVersion) ||
    input.projectVersion < 1
  )
    discoveryFailure('SHOPEE_HANDOFF_INPUT_INVALID');
  affiliateIdentifier(projectId, 'projectId');
  affiliateIdentifier(input.occurrenceId, 'occurrenceId');
  const configuration = validateDynamicConfiguration(input.configuration);
  if (configuration.projectId !== projectId)
    discoveryFailure('SHOPEE_PROJECT_MISMATCH');
  for (const query of configuration.queries) buildShopeeOffersQuery(query);
  validateShopeeLinkInput({
    offerId: 'policy',
    originUrl: 'https://shopee.com.br/product/1/1',
    subIds: configuration.subIds,
  });
  const requestedAt = instant(input.requestedAt);
  const identity = {
    projectId,
    projectVersion: input.projectVersion,
    occurrenceId: input.occurrenceId,
    requestedAt,
    mode: 'FAKE' as const,
  };
  const configurationHash = affiliateHash(configuration),
    identityHash = affiliateHash(identity);
  if (
    input.configurationHash !== configurationHash ||
    input.identityHash !== identityHash
  )
    discoveryFailure('SHOPEE_HANDOFF_SCOPE_MISMATCH');
  return {
    identity,
    configuration,
    configurationHash,
    identityHash,
    key: affiliateHash({ projectId, occurrenceId: input.occurrenceId }),
  };
}
