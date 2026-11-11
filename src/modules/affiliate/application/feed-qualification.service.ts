import { Injectable } from '@nestjs/common';
import { affiliateHash, immutable } from '../domain/affiliate-contracts.js';
import {
  FEED_QUALIFICATION_POLICY,
  qualifyFeedRows,
} from '../domain/feed-qualification.js';
import { readQualificationFeeds } from '../infrastructure/feed-qualification.source.js';
import { catalogError } from '../infrastructure/discovery-error.js';

@Injectable()
export class FeedQualificationService {
  async qualify(
    options: { offset?: number; limit?: number; reportId?: string } = {},
  ) {
    const { offset = 0, limit = 50, reportId: expected } = options;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected))
    )
      throw catalogError('FEED_QUALIFICATION_INVALID_QUERY');
    const result = await this.analyze();
    if (expected !== undefined && expected !== result.reportId)
      throw catalogError('FEED_QUALIFICATION_REPORT_CHANGED');
    return immutable({
      ...result,
      offset,
      limit,
      items: result.items.slice(offset, offset + limit),
    });
  }
  // The full batch is also consumable by the local CLI, without pagination,
  // database initialization, cache mutation or registration effects.
  async analyze() {
    const { rows, sources } = await readQualificationFeeds(
      process.env.AFFILIATE_DISCOVERY_CONFIG,
    );
    const reportId = affiliateHash({
      policyVersion: FEED_QUALIFICATION_POLICY,
      sources,
    });
    const items = qualifyFeedRows(rows);
    return {
      reportId,
      policyVersion: FEED_QUALIFICATION_POLICY,
      sources,
      summary: {
        records: items.length,
        uniqueProducts: new Set(
          items
            .filter(
              (r) =>
                r.externalProductId &&
                !r.reasons.includes('PRODUCT_ID_INVALID'),
            )
            .map((r) => r.externalProductId),
        ).size,
        preCandidates: items.filter((r) => r.classification === 'PRE_CANDIDATE')
          .length,
        incomplete: items.filter((r) => r.classification === 'INCOMPLETE_DATA')
          .length,
        duplicates: items.filter((r) => r.duplicateOf !== null).length,
        requiresCommercialConfirmation: items.length,
        requiresMedia: items.length,
        requiresRights: items.length,
        catalogEligible: 0,
      },
      total: items.length,
      items,
    };
  }
}
