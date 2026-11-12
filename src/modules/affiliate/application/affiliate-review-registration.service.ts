import { Inject, Injectable } from '@nestjs/common';
import { operationalQcIdentity } from '../../publishing/application/local-qc-identity.js';
import { QualificationPreviewService } from './qualification-preview.service.js';
import { AffiliateService } from './affiliate.service.js';
import { reviewedRegistration } from '../domain/reviewed-registration.js';

@Injectable()
export class AffiliateReviewRegistrationService {
  constructor(
    @Inject(QualificationPreviewService)
    private readonly previews: QualificationPreviewService,
    @Inject(AffiliateService)
    private readonly affiliate: AffiliateService<boolean>,
  ) {}
  async register(raw: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    const command = reviewedRegistration(raw, actor.id);
    const replay = await this.affiliate.replayReviewedRegistration(
      command.payload,
      command.key,
    );
    // Historical receipt only: no new registration, media authorization or LIVE
    // permission is inferred when an already committed decision is replayed.
    if (replay) return replay;
    await this.previews.revalidateRegistration(
      command.request,
      command.payload.previewPackageHash,
    );
    operationalQcIdentity.assertActive(principal);
    return this.affiliate.registerReviewedRegistration(
      command.payload,
      command.key,
    );
  }
}
