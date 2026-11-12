import {
  validateProjectDiscoveryAuthorization,
  validateProjectDiscoveryIdentity,
  validateLinkAuthorizationDraft,
  type ProjectDiscoveryAuthorization,
  type LinkAuthorizationDraft,
} from '../affiliate/domain/shopee-project-live-authorization.js';
import {
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
  type ShopeeDynamicAuthorization,
} from '../affiliate/domain/shopee-dynamic.js';
import { discoveryFailure } from './project-shopee-discovery.contract.js';

export const PROJECT_LIVE_PREFLIGHT_VERSION =
  'operations-project-shopee-live-preflight/1.0.0' as const;
export interface ProjectLivePreflightInput {
  schemaVersion: typeof PROJECT_LIVE_PREFLIGHT_VERSION;
  projectId: string;
  projectVersion: number;
  occurrenceId: string;
  configuration: ShopeeDynamicConfiguration;
  discoveryScope: ProjectDiscoveryAuthorization;
  snapshotHash: string | null;
  link: {
    draft: LinkAuthorizationDraft;
    authorization: ShopeeDynamicAuthorization | null;
  } | null;
}
function exact(
  raw: unknown,
  keys: string[],
): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== [...keys].sort().join(',')
  )
    discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_INPUT_INVALID');
}
export function projectLivePreflightInput(projectId: string, raw: unknown) {
  exact(raw, [
    'schemaVersion',
    'projectId',
    'projectVersion',
    'occurrenceId',
    'configuration',
    'discoveryScope',
    'snapshotHash',
    'link',
  ]);
  if (
    raw.schemaVersion !== PROJECT_LIVE_PREFLIGHT_VERSION ||
    raw.projectId !== projectId
  )
    discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_INPUT_INVALID');
  const identity = validateProjectDiscoveryIdentity({
    projectId: raw.projectId,
    projectVersion: raw.projectVersion,
    occurrenceId: raw.occurrenceId,
  });
  const configuration = validateDynamicConfiguration(
    raw.configuration as ShopeeDynamicConfiguration,
  );
  const scope = validateProjectDiscoveryAuthorization(raw.discoveryScope);
  if (
    scope.projectId !== identity.projectId ||
    scope.projectVersion !== identity.projectVersion ||
    scope.occurrenceId !== identity.occurrenceId
  )
    discoveryFailure('SHOPEE_PROJECT_SCOPE_MISMATCH');
  if (
    raw.snapshotHash !== null &&
    (typeof raw.snapshotHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.snapshotHash))
  )
    discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_INPUT_INVALID');
  let link: ProjectLivePreflightInput['link'] = null;
  if (raw.link !== null) {
    exact(raw.link, ['draft', 'authorization']);
    const draft = validateLinkAuthorizationDraft(raw.link.draft);
    if (
      raw.link.authorization !== null &&
      (!raw.link.authorization ||
        typeof raw.link.authorization !== 'object' ||
        Array.isArray(raw.link.authorization))
    )
      discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_INPUT_INVALID');
    link = {
      draft,
      authorization:
        raw.link.authorization === null
          ? null
          : validateDynamicConfiguration({
              ...configuration,
              authorizations: [
                raw.link.authorization as ShopeeDynamicAuthorization,
              ],
            }).authorizations[0],
    };
  }
  return {
    identity,
    configuration,
    scope,
    snapshotHash: raw.snapshotHash as string | null,
    link,
  };
}

export const projectLiveOperationalOrder = [
  'PROJECT',
  'PREFLIGHT',
  'SPECIFIC_DISCOVERY_AUTHORIZATION',
  'FROZEN_DISCOVERY',
  'SELECTION',
  'RIGHTS_AND_COMMERCIAL_REVIEW',
  'SPECIFIC_LINK_AUTHORIZATION',
  'RETURNED_LINK_AND_VERIFIED_ASSOCIATION',
  'CAMPAIGN_REGISTRATION',
  'BRIEFING',
  'SUBSEQUENT_RECURRENCE',
] as const;
