import type { DatabaseSync } from 'node:sqlite';
import type {
  DestinationReservations,
  PublicationNetwork,
} from '../application/ports/destination-publication.port.js';
import { InstagramPublicationRepository } from './instagram-publication.repository.js';
import { socialFail } from '../domain/social-publication-contracts.js';

export class DestinationReservationsRepository implements DestinationReservations {
  constructor(private readonly db: DatabaseSync) {}
  list(id: string) {
    const current = this.db
      .prepare(
        'SELECT operation_id,network,account_id FROM multi_network_publication_reservations WHERE execution_id=?',
      )
      .all(id)
      .map((r) => ({
        operationId: String(r.operation_id),
        network: r.network as PublicationNetwork,
        accountId: String(r.account_id),
      }));
    const legacy = this.db
      .prepare(
        'SELECT r.operation_id,o.account_id FROM instagram_publication_reservations r JOIN social_publication_operations o ON o.operation_id=r.operation_id WHERE r.execution_id=?',
      )
      .all(id)
      .map((r) => ({
        operationId: String(r.operation_id),
        network: 'INSTAGRAM' as const,
        accountId: String(r.account_id),
      }));
    return [...legacy, ...current];
  }
  forExecution(id: string, network: PublicationNetwork, account: string) {
    return (
      this.list(id).find(
        (r) => r.network === network && r.accountId === account,
      ) ?? null
    );
  }
  activeForExecution(id: string, network: PublicationNetwork, account: string) {
    const historical = this.forExecution(id, network, account);
    if (
      !historical ||
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 44
    )
      return historical;
    const owner = this.db
      .prepare(
        'SELECT * FROM publication_active_ownership WHERE execution_id=? AND network=? AND account_id=?',
      )
      .get(id, network, account);
    if (!owner || owner.reservation_operation_id !== historical.operationId)
      socialFail('SOCIAL_RESERVATION_CONFLICT');
    return { ...historical, operationId: String(owner.active_operation_id) };
  }
  reserve(id: string, op: any, pkg: any, review: string, at: string) {
    const network: PublicationNetwork = op.network ?? 'INSTAGRAM';
    const account =
      network === 'FACEBOOK_REELS'
        ? op.accountId.replace(/^facebook_reels:/, '')
        : op.accountId;
    const destination =
      network === 'FACEBOOK_REELS' ? op.accountId : `instagram:${account}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.forExecution(id, network, account);
      if (prior) {
        if (prior.operationId !== op.operationId)
          socialFail('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
        this.authorize(op, at);
        this.db.exec('COMMIT');
        return prior;
      }
      // Include pre-reservation historical operations and alternate package revisions.
      const historical = this.db
        .prepare(
          `SELECT 1 FROM social_publication_operations o
        LEFT JOIN manual_distribution_records p ON p.kind='PACKAGE' AND p.record_id=o.package_hash
        WHERE o.operation_id<>? AND o.account_id=? AND json_extract(o.payload_json,'$.mediaHash')=?
        AND (p.record_id IS NULL OR json_extract(p.payload_json,'$.campaignId')=?) LIMIT 1`,
        )
        .get(op.operationId, op.accountId, op.mediaHash, pkg.campaignId);
      if (historical) socialFail('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
      this.db
        .prepare(
          'INSERT INTO multi_network_publication_reservations VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          network,
          account,
          destination,
          pkg.campaignId,
          op.mediaHash,
          op.operationId,
          pkg.contentHash,
          review,
          at,
        );
      this.db.exec('COMMIT');
      return this.forExecution(id, network, account);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  authorize(op: any, at: string) {
    let reservationId = op.operationId;
    let owner;
    if (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) >= 44
    ) {
      if (
        this.db
          .prepare(
            'SELECT 1 FROM publication_supersessions WHERE predecessor_id=?',
          )
          .get(op.operationId)
      )
        socialFail('SOCIAL_OPERATION_SUPERSEDED');
      owner = this.db
        .prepare(
          'SELECT * FROM publication_active_ownership WHERE active_operation_id=?',
        )
        .get(op.operationId);
      const lineage = this.db
        .prepare(
          'SELECT root_operation_id,supersession_revision FROM social_publication_operations WHERE operation_id=?',
        )
        .get(op.operationId);
      if (
        !owner ||
        !lineage ||
        owner.reservation_operation_id !==
          (lineage.root_operation_id ?? op.operationId) ||
        owner.active_operation_id !== op.operationId ||
        owner.revision !== lineage.supersession_revision ||
        owner.network !== (op.network ?? 'INSTAGRAM') ||
        owner.account_id !==
          (op.network === 'FACEBOOK_REELS'
            ? op.accountId.replace(/^facebook_reels:/, '')
            : op.accountId) ||
        owner.artifact_hash !== op.mediaHash
      )
        socialFail('SOCIAL_RESERVATION_CONFLICT');
      reservationId = String(owner.reservation_operation_id);
    }
    const row = this.db
      .prepare(
        'SELECT * FROM multi_network_publication_reservations WHERE operation_id=?',
      )
      .get(reservationId);
    if (!row) {
      const legacy = new InstagramPublicationRepository(this.db).authorize(
        op,
        at,
      );
      if (
        owner &&
        (owner.execution_id !== legacy.execution_id ||
          owner.campaign_id !== legacy.campaign_id)
      )
        socialFail('SOCIAL_RESERVATION_CONFLICT');
      return legacy;
    }
    const review = this.db
      .prepare(
        "SELECT content_hash,payload_json FROM manual_distribution_records WHERE kind='REVIEW' AND record_id=?",
      )
      .get(op.packageHash);
    if (
      (owner &&
        ['execution_id', 'campaign_id', 'network', 'account_id'].some(
          (k) => owner[k] !== row[k],
        )) ||
      row.package_hash !== op.packageHash ||
      row.artifact_hash !== op.mediaHash ||
      row.destination !==
        (op.network === 'FACEBOOK_REELS'
          ? op.accountId
          : `instagram:${op.accountId}`)
    )
      socialFail('SOCIAL_RESERVATION_CONFLICT');
    if (
      review?.content_hash !== row.review_hash ||
      JSON.parse(String(review.payload_json)).mediaDecision.decision !==
        'APPROVED' ||
      new InstagramPublicationRepository(this.db).revoked(
        String(row.review_hash),
      )
    )
      socialFail('SOCIAL_APPROVAL_REVOKED');
    return row;
  }
}
