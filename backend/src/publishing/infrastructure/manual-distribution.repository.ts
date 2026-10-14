import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../../affiliate/domain/affiliate.errors.js';
import {
  distributionFail,
  hashValue,
} from '../domain/manual-distribution-contracts.js';
import type { AffiliateRepository } from '../../affiliate/application/ports/affiliate-repository.port.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { DatabaseSync } from 'node:sqlite';
export class ManualDistributionRepository {
  readonly db: DatabaseSync;
  readonly catalog: Pick<AffiliateRepository, 'getCampaign' | 'getProduct'> &
    Pick<AffiliateRunContext, 'resolveRunBriefing'>;
  constructor(
    base: { db: DatabaseSync },
    catalog: ManualDistributionRepository['catalog'],
  ) {
    this.db = base.db;
    this.catalog = catalog;
  }
  command(
    kind: string,
    value: unknown,
    key: string,
    operation: () => any,
    guard = () => {},
  ) {
    if (!['PACKAGE', 'REVIEW', 'PUBLICATION', 'RESULTS'].includes(kind))
      throw new AffiliateRepositoryError(
        'INVALID_DISTRIBUTION_COMMAND',
        'type',
      );
    affiliateIdentifier(key, 'idempotencyKey');
    const hash = affiliateHash(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      guard();
      const prior = this.db
        .prepare('SELECT * FROM affiliate_commands WHERE idempotency_key=?')
        .get(key);
      let result: any;
      if (prior) {
        if (
          prior.command_type !== `DISTRIBUTION_${kind}` ||
          prior.payload_hash !== hash
        )
          throw new AffiliateRepositoryError(
            'AFFILIATE_IDEMPOTENCY_CONFLICT',
            'idempotencyKey',
          );
        try {
          result = JSON.parse(String(prior.result_json));
        } catch (cause) {
          throw new AffiliateRepositoryError(
            'INVALID_PERSISTED_AFFILIATE_DATA',
            'result',
            { cause },
          );
        }
        if (affiliateHash(result) !== prior.result_hash)
          throw new AffiliateRepositoryError(
            'AFFILIATE_HASH_MISMATCH',
            'result',
          );
        result = immutable(result);
      } else {
        result = operation();
        this.db
          .prepare('INSERT INTO affiliate_commands VALUES (?,?,?,?,?)')
          .run(
            key,
            `DISTRIBUTION_${kind}`,
            hash,
            affiliateHash(result),
            JSON.stringify(result),
          );
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(kind: string, id: string): any {
    const row = this.db
      .prepare(
        'SELECT * FROM manual_distribution_records WHERE kind=? AND record_id=?',
      )
      .get(kind, id);
    if (!row) return null;
    const value = JSON.parse(String(row.payload_json));
    if (
      affiliateHash(value) !== row.content_hash ||
      value.contentHash !== row.content_hash ||
      (value.packageHash ?? value.contentHash) !== row.package_hash
    )
      distributionFail('DISTRIBUTION_PERSISTED_INTEGRITY');
    return immutable(value);
  }
  put(kind: string, id: string, value: any): any {
    const prior = this.get(kind, id);
    if (prior) {
      if (prior.contentHash !== value.contentHash)
        distributionFail(`DISTRIBUTION_${kind}_CONFLICT`);
      return prior;
    }
    this.db
      .prepare('INSERT INTO manual_distribution_records VALUES (?,?,?,?,?)')
      .run(
        kind,
        id,
        value.packageHash ?? value.contentHash,
        value.contentHash,
        JSON.stringify(value),
      );
    return this.get(kind, id);
  }
  list(kind: string, packageHash?: string): any[] {
    if (packageHash !== undefined) hashValue(packageHash, 'packageHash');
    return this.db
      .prepare(
        `SELECT record_id FROM manual_distribution_records WHERE kind=?${packageHash === undefined ? '' : ' AND package_hash=?'} ORDER BY record_id`,
      )
      .all(...(packageHash === undefined ? [kind] : [kind, packageHash]))
      .map((row) => this.get(kind, String(row.record_id)));
  }
}
