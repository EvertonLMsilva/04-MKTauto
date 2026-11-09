import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { CampaignRepository } from '../../content-operations/infrastructure/campaign.repository.js';
import { DestinationReservationsRepository } from './destination-reservations.repository.js';
import { InstagramPublicationRepository } from './instagram-publication.repository.js';
import { SocialPublicationRepository } from './social-publication.repository.js';
import type { ManualDistributionRepository } from './manual-distribution.repository.js';
import {
  distributionFail,
  publicText,
  timestamp,
  https,
} from '../domain/manual-distribution-contracts.js';
import type { MeasurementTarget } from '../domain/commercial-measurement.js';
function fail(code: string): never {
  return distributionFail(code) as never;
}

export class CommercialMeasurementRepository {
  constructor(readonly records: ManualDistributionRepository) {}
  resolve(target: MeasurementTarget) {
    publicText(target.id, 'identity', 200);
    if (!['execution', 'operation', 'publication'].includes(target.kind))
      fail('DISTRIBUTION_INVALID_CONTRACT');
    const db = this.records.db;
    const hasTable = (name: string) =>
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name);
    let operation: any = null,
      publication: any = null;
    let executionId = target.kind === 'execution' ? target.id : null;
    let packageHash: string;
    let mode: string = 'manual';
    if (target.kind === 'execution') {
      const reservations = hasTable('multi_network_publication_reservations')
        ? new DestinationReservationsRepository(db).list(target.id)
        : hasTable('instagram_publication_reservations')
          ? [
              new InstagramPublicationRepository(db).forExecution(target.id),
            ].filter((r) => r !== null)
          : [];
      const operations = [...new Set(reservations.map((r) => r.operationId))]
        .map((id) => this.operation(id))
        .filter((op) => this.confirmed(op));
      const execution = new CampaignRepository(db).get(target.id);
      const publications = this.records
        .list('PUBLICATION')
        .filter(
          (p) =>
            p.state === 'PUBLISHED' &&
            this.records.get('PACKAGE', p.packageHash)?.identity
              .pipelineRunId === execution.run_id,
        );
      if (operations.length + publications.length > 1)
        fail('DISTRIBUTION_PUBLICATION_AMBIGUOUS');
      operation = operations[0] ?? null;
      publication = publications[0] ?? null;
    } else if (target.kind === 'operation')
      operation = this.operation(target.id);
    if (operation) {
      const receipt = operation.remoteReceipt;
      if (!this.confirmed(operation))
        fail('DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED');
      timestamp(receipt.publishedAt, 'publishedAt');
      if (!(
        operation.network === 'FACEBOOK_REELS' && receipt.permalink === null
      ))
        https(receipt.permalink, 'permalink');
      publication = {
        publicationId: operation.operationId,
        operationId: operation.operationId,
        remoteMediaId: operation.mediaId,
        permalink: receipt.permalink,
        publishedAt: receipt.publishedAt,
      };
      mode = operation.executionMode;
      packageHash = operation.packageHash;
    } else if (target.kind === 'operation')
      fail('DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED');
    else if (target.kind === 'publication') {
      publication = this.records.get('PUBLICATION', target.id);
      packageHash = publication?.packageHash;
    } else packageHash = publication?.packageHash;
    if (!publication || (!operation && publication.state !== 'PUBLISHED'))
      fail('DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED');
    const pkg = this.records.get('PACKAGE', packageHash!);
    if (!pkg) fail('DISTRIBUTION_PACKAGE_NOT_FOUND');
    if (!hasTable('campaign_executions'))
      fail('DISTRIBUTION_EXECUTION_SCOPE_REQUIRED');
    const row = db
      .prepare('SELECT execution_id FROM campaign_executions WHERE run_id=?')
      .get(pkg.identity.pipelineRunId);
    if (!row || (executionId !== null && row.execution_id !== executionId))
      fail('DISTRIBUTION_EXECUTION_SCOPE_MISMATCH');
    executionId = String(row.execution_id);
    const campaigns = new CampaignRepository(db),
      execution = campaigns.get(executionId),
      request = campaigns.history(executionId)[0].evidence as any;
    const brief = this.records.catalog.resolveRunBriefing(execution.run_id);
    if (
      !brief ||
      brief.campaignId !== pkg.campaignId ||
      brief.campaignRevision !== pkg.campaignRevision ||
      brief.productId !== pkg.productId ||
      brief.productRevision !== pkg.productRevision ||
      brief.affiliateUrl !== pkg.link
    )
      fail('DISTRIBUTION_PRODUCT_SCOPE_MISMATCH');
    const selection =
      request.selectionMode === 'CATALOG' ? request.catalogSelection : null;
    if (
      request.selectionMode === 'CATALOG' &&
      (!selection ||
        selection.productId !== pkg.productId ||
        selection.productRevision !== pkg.productRevision ||
        selection.sourceCampaignId !== pkg.campaignId ||
        selection.sourceCampaignRevision !== pkg.campaignRevision ||
        selection.affiliateUrl !== pkg.link ||
        selection.briefingHash !== brief.contentHash)
    )
      fail('DISTRIBUTION_PRODUCT_SCOPE_MISMATCH');
    if (
      !selection &&
      (execution.campaign_id !== pkg.campaignId ||
        execution.campaign_revision !== pkg.campaignRevision)
    )
      fail('DISTRIBUTION_PRODUCT_SCOPE_MISMATCH');
    if (
      operation &&
      ((operation.network === 'FACEBOOK_REELS'
        ? operation.accountId !== `facebook_reels:${pkg.account}` ||
          pkg.platform !== 'facebook'
        : operation.accountId !== pkg.account ||
          pkg.platform !== 'instagram') ||
        operation.mediaHash !== pkg.identity.videoRenderContentHash)
    )
      fail('DISTRIBUTION_PUBLICATION_SCOPE_MISMATCH');
    const unknownStageCosts = campaigns
      .history(executionId)
      .filter((h) => h.event_type === 'STEP_DONE')
      .filter((h) => {
        const cost = (h.evidence.result as any)?.cost;
        return (
          cost &&
          (cost.status === 'UNKNOWN' ||
            cost.availability === 'UNAVAILABLE' ||
            cost.amount === null)
        );
      })
      .map((h) => String(h.evidence.step));
    return {
      identity: {
        publicationId: publication.publicationId,
        operationId: operation?.operationId ?? null,
        executionId,
        pipelineRunId: execution.run_id,
        campaignId: execution.campaign_id,
        campaignRevision: execution.campaign_revision,
        productId: pkg.productId,
        productRevision: pkg.productRevision,
        productName: pkg.productName,
        affiliateLink: {
          url: pkg.link,
          campaignId: pkg.campaignId,
          campaignRevision: pkg.campaignRevision,
        },
        briefingId: brief.briefingId,
        briefingHash: brief.contentHash,
        packageHash: pkg.contentHash,
        platform: pkg.platform,
        account: pkg.account,
        executionMode: mode,
        remoteMediaId: operation
          ? publication.remoteMediaId
          : (publication.externalId ?? null),
        permalink: operation
          ? publication.permalink
          : (publication.externalUrl ?? null),
        publishedAt: publication.publishedAt,
      },
      unknownStageCosts: [...new Set(unknownStageCosts)],
      financialOperationIds: (
        request.legacyRecovery?.financialOperationIds ?? [
          request.generationRequestId,
        ]
      ).filter((id: unknown) => typeof id === 'string') as string[],
    };
  }
  private confirmed(operation: any): boolean {
    return !!(
      operation &&
      operation.state === 'PUBLISHED' &&
      operation.mediaId &&
      !operation.requiresReconciliation &&
      operation.remoteReceipt &&
      operation.remoteReceipt.mediaId === operation.mediaId
    );
  }
  private operation(id: string): any {
    const db = this.records.db;
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_publication_context'",
        )
        .get()
    )
      fail('DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED');
    const context = db
      .prepare(
        'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
      )
      .get();
    if (
      context?.execution_mode !== 'fake' &&
      context?.execution_mode !== 'live'
    )
      fail('DISTRIBUTION_PUBLICATION_PROVENANCE_REQUIRED');
    return new SocialPublicationRepository(
      { db },
      { mode: context!.execution_mode as 'fake' | 'live', readOnly: true },
    ).get(id);
  }
  history(
    identity: ReturnType<
      CommercialMeasurementRepository['resolve']
    >['identity'],
  ): any[] {
    return this.records
      .list('RESULTS', identity.packageHash)
      .filter((r) => r.publicationId === identity.publicationId)
      .map((r) => {
        if (r.schemaVersion === 'manual-commercial-results/1.0.0')
          return { ...r, revision: 1, observationId: observationId(r) };
        if (
          r.identity.executionId !== identity.executionId ||
          r.identity.productId !== identity.productId ||
          r.identity.productRevision !== identity.productRevision ||
          r.identity.affiliateLink.url !== identity.affiliateLink.url
        )
          fail('DISTRIBUTION_PRODUCT_SCOPE_MISMATCH');
        return r;
      })
      .sort(
        (a, b) =>
          a.recordedAt.localeCompare(b.recordedAt) ||
          a.revision - b.revision ||
          a.contentHash.localeCompare(b.contentHash),
      );
  }
}
export function observationId(value: {
  publicationId: string;
  periodStart: string;
  periodEnd: string;
  sourceReference: string;
  attribution: string;
}) {
  return affiliateHash({
    publicationId: value.publicationId,
    periodStart: new Date(value.periodStart).toISOString(),
    periodEnd: new Date(value.periodEnd).toISOString(),
    sourceReference: value.sourceReference,
    attribution: value.attribution,
  });
}
