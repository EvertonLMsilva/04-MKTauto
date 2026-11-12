import type { CommercialImageReadinessService } from './commercial-image-readiness.service.js';
import {
  buildCommercialImageReferenceHandoff,
  validateCommercialImageReferenceHandoffInput,
} from '../domain/commercial-image-reference-handoff.js';

export class CommercialImageReferenceHandoffService {
  constructor(
    private readonly readiness: Pick<
      CommercialImageReadinessService,
      'evaluate'
    >,
  ) {}
  async prepare(raw: unknown) {
    const input = validateCommercialImageReferenceHandoffInput(raw);
    // No cache: physical bytes, rights and current revisions are always read by
    // the canonical C-017 service. This service has no storage/transport writer.
    const canonical = await this.readiness.evaluate(input.reference);
    return buildCommercialImageReferenceHandoff(input, canonical);
  }
  async revalidate(raw: unknown, expectedPreparationHash: string) {
    const input = validateCommercialImageReferenceHandoffInput(raw);
    if (
      input.expectedPreparationHash &&
      input.expectedPreparationHash !== expectedPreparationHash
    )
      throw new Error('COMMERCIAL_IMAGE_REFERENCE_CONFLICT');
    return this.prepare({ ...input, expectedPreparationHash });
  }
}
