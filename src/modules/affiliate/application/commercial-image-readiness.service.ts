import type { AffiliateRepositoryFactory } from './ports/affiliate-repository.port.js';
import {
  evaluateCommercialImageReadiness,
  validateCommercialImageReadinessInput,
  type CommercialImageInspection,
} from '../domain/commercial-image-readiness.js';
import { inspectQualificationImage } from '../infrastructure/qualification-image.reader.js';

// Only the existing repository's read-only session and image inspector are used.
// No provider, publication, Finance reservation or approval writer is present.
export class CommercialImageReadinessService {
  constructor(
    private readonly persistence: AffiliateRepositoryFactory<boolean>,
  ) {}
  async evaluate(raw: unknown) {
    const input = validateCommercialImageReadinessInput(raw);
    const repo = await this.persistence.open(true);
    try {
      const product = await repo.getProduct(
        input.product.productId,
        input.product.revision,
      );
      const campaign = input.campaign
        ? await repo.getCampaign(
            input.campaign.campaignId,
            input.campaign.revision,
          )
        : null;
      const source = input.source
        ? await repo.getCampaignSource(
            input.source.sourceId,
            input.source.revision,
          )
        : null;
      let physical: CommercialImageInspection = {
        status: 'PENDING',
        reason: 'LOCAL_IMAGE_REQUIRED',
        contentHash: null,
        sizeBytes: null,
      };
      if (
        product?.localImage &&
        product.localImage.mediaReference === input.media.mediaRef &&
        product.localImage.contentHash === input.media.contentHash &&
        product.media.some((m) => m.mediaRef === input.media.mediaRef)
      ) {
        const inspection = await inspectQualificationImage(product.localImage);
        physical = {
          status: inspection.status,
          reason: 'reason' in inspection ? (inspection.reason ?? null) : null,
          contentHash:
            'contentHash' in inspection
              ? (inspection.contentHash ?? null)
              : null,
          sizeBytes:
            'sizeBytes' in inspection ? (inspection.sizeBytes ?? null) : null,
        };
      }
      // Revisions are append-only and contiguous in the existing repositories.
      // Check after the asynchronous physical read to avoid accepting a revision
      // superseded while that read was in progress. Execution must revalidate.
      const productCurrent =
        !!product &&
        !(await repo.getProduct(
          input.product.productId,
          input.product.revision + 1,
        ));
      const campaignCurrent =
        !input.campaign ||
        (!!campaign &&
          !(await repo.getCampaign(
            input.campaign.campaignId,
            input.campaign.revision + 1,
          )));
      return evaluateCommercialImageReadiness(input, {
        product,
        campaign,
        source,
        productCurrent,
        campaignCurrent,
        physical,
      });
    } finally {
      await repo.close();
    }
  }
}
