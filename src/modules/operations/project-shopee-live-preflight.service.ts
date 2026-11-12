import { Inject, Injectable } from '@nestjs/common';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import type { ShopeeProjectLiveAuthorizationService } from '../affiliate/application/shopee-project-live-authorization.service.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  PROJECT_SNAPSHOT_READER,
  type ProjectSnapshotReader,
} from '../project/application/ports/project-snapshot-reader.port.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import { discoveryFailure } from './project-shopee-discovery.contract.js';
import {
  projectLivePreflightInput,
  PROJECT_LIVE_PREFLIGHT_VERSION,
  projectLiveOperationalOrder,
} from './project-shopee-live-preflight.contract.js';

type ReadOnlyAuthorization = Pick<
  ShopeeProjectLiveAuthorizationService,
  'previewDiscovery' | 'inspectDiscovery' | 'previewLink'
>;
@Injectable()
export class ProjectShopeeLivePreflightService {
  private readonly authorization: ReadOnlyAuthorization;
  constructor(
    @Inject(ShopeeDynamicService) dynamic: ShopeeDynamicService,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
  ) {
    // No financial adapter is installed by this task. C-016 fails closed.
    this.authorization = dynamic.projectLiveAuthorization();
  }
  async preview(projectId: string, raw: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    let input: ReturnType<typeof projectLivePreflightInput>;
    try {
      input = projectLivePreflightInput(projectId, raw);
    } catch {
      discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_INPUT_INVALID');
    }
    try {
      const project = await this.projects.get(projectId);
      if (!project) discoveryFailure('PROJECT_NOT_FOUND', 404);
      if (input.link && input.link.draft.operatorId !== actor.id)
        discoveryFailure('SHOPEE_PROJECT_SCOPE_MISMATCH');
      const discovery = await this.authorization.previewDiscovery(
        input.configuration,
        input.scope,
      );
      const inspection = await this.authorization.inspectDiscovery(
        input.identity,
      );
      let snapshotStatus: string = inspection.status;
      const frozen = inspection.result;
      const exactSnapshot =
        !!frozen &&
        input.snapshotHash === frozen.snapshotHash &&
        affiliateHash(frozen.identity) === affiliateHash(input.identity) &&
        frozen.scopeHash === discovery.scopeHash &&
        frozen.authorizationId === discovery.scope.authorizationId &&
        affiliateHash(frozen.configuration) ===
          discovery.scope.configurationHash;
      const blockers = [...discovery.blockers];
      if (frozen && !exactSnapshot) {
        snapshotStatus =
          input.snapshotHash === null
            ? 'HASH_CONFIRMATION_REQUIRED'
            : 'MISMATCH';
        blockers.push('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
      } else if (!frozen) blockers.push('FROZEN_DISCOVERY_REQUIRED');
      let linkPreview: Awaited<
        ReturnType<ReadOnlyAuthorization['previewLink']>
      > | null = null;
      if (exactSnapshot && input.link) {
        linkPreview = await this.authorization.previewLink(
          { ...input.identity, snapshotHash: input.snapshotHash! },
          input.link.draft,
          input.link.authorization ?? undefined,
        );
        blockers.push(...linkPreview.blockers);
      }
      blockers.push(
        'SPECIFIC_DISCOVERY_APPROVAL_REQUIRED',
        'SPECIFIC_LINK_APPROVAL_REQUIRED',
        'RETURNED_LINK_ASSOCIATION_EVIDENCE_REQUIRED',
      );
      const selected = linkPreview?.preparation.selection;
      return {
        schemaVersion: PROJECT_LIVE_PREFLIGHT_VERSION,
        project: {
          projectId: project.project.id,
          projectVersion: project.project.version,
          niche: project.project.niche,
        },
        identity: input.identity,
        campaignRequiredForDiscovery: false,
        discovery: {
          scope: {
            kind: discovery.scope.kind,
            ...input.identity,
            configurationHash: discovery.scope.configurationHash,
            notBefore: discovery.scope.notBefore,
            expiresAt: discovery.scope.expiresAt,
            maxOfferPages: discovery.scope.maxOfferPages,
            maxLinks: 0,
          },
          scopeHash: discovery.scopeHash,
          authorizationStatus: discovery.authorizationStatus,
          grantInspection: 'NOT_PERFORMED',
          maxOfferPages: discovery.scope.maxOfferPages,
          maxLinks: 0,
        },
        finance: {
          status: 'BLOCKED_COST_UNCONFIRMED',
          trustedReaderConfigured: false,
          requiredReader: 'ShopeeProjectLiveCostEvidenceReader.verifyNoCharge',
          requiredCostBasis: 'NO_CHARGE_CONFIRMED',
          proposedCostBasis: discovery.scope.costBasis,
          amount: null,
        },
        snapshot: {
          status: snapshotStatus,
          snapshotHash: exactSnapshot ? frozen!.snapshotHash : null,
          evidenceStatus: 'NOT_OPERATIONAL_ACCEPTANCE',
        },
        link: {
          status: !exactSnapshot
            ? 'SNAPSHOT_REQUIRED'
            : !input.link
              ? 'REVIEW_INPUT_REQUIRED'
              : linkPreview?.scope
                ? 'PROPOSED_BLOCKED'
                : 'EVIDENCE_REQUIRED',
          authorizationStatus: 'NOT_GRANTED',
          grantInspection: 'NOT_PERFORMED',
          scopeHash: linkPreview?.scopeHash ?? null,
          selection: selected
            ? {
                productId: selected.productId,
                shopId: selected.shopId,
                offerId: selected.offerId,
                productRevision: selected.productRevision,
                productHash: selected.productHash,
                requestHash: selected.requestHash,
              }
            : null,
          missingEvidence: linkPreview
            ? [
                ...new Set([
                  ...linkPreview.blockers,
                  ...linkPreview.preparation.missingFields,
                ]),
              ]
            : [
                'PRODUCT_AUTHORIZATION_REQUIRED',
                'REUSABLE_MEDIA_RIGHTS_REQUIRED',
                'COMMERCIAL_APPROVAL_REQUIRED',
              ],
          associationVerified: false,
          mutationExecuted: false,
          transportAuthorized: false,
        },
        blockers: [...new Set(blockers)],
        nextHumanAction:
          'COORDINATE_TRUSTED_FINANCE_EVIDENCE_BEFORE_SPECIFIC_DISCOVERY_APPROVAL',
        operationalOrder: projectLiveOperationalOrder,
        executionAllowed: false,
        publicationAuthorized: false,
        spendingAuthorized: false,
        schedulerStarted: false,
        catalogRegistrationAllowed: false,
        briefingCreationAllowed: false,
        recurrenceAllowed: false,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (
        /^(PROJECT_NOT_FOUND|SHOPEE_PROJECT_(PREFLIGHT_INPUT_INVALID|SCOPE_MISMATCH|AUTHORIZATION_INVALID|SNAPSHOT_MISMATCH)|SHOPEE_CONFIGURATION_INVALID)$/.test(
          code,
        )
      )
        discoveryFailure(code, code === 'PROJECT_NOT_FOUND' ? 404 : 400);
      discoveryFailure('SHOPEE_PROJECT_PREFLIGHT_UNAVAILABLE', 503);
    }
  }
}
