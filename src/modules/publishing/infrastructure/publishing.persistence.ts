import { DestinationReservationsRepository } from './destination-reservations.repository.js';
import { InstagramPublicationRepository } from './instagram-publication.repository.js';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import type { AffiliateRepositoryFactory } from '../../affiliate/application/ports/affiliate-repository.port.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type {
  PublishingMedia,
  PublishingStore,
} from '../application/publishing.port.js';
import { ManualDistributionRepository } from './manual-distribution.repository.js';
import { HumanApprovalRepository } from './human-approval.repository.js';
import { SocialPublicationRepository } from './social-publication.repository.js';
import { ManualDistributionService } from '../application/manual-distribution.service.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
export const PUBLISHING_DATABASE = Symbol('PUBLISHING_DATABASE');
export const SOCIAL_HISTORY_DATABASE = Symbol('SOCIAL_HISTORY_DATABASE');
export class PublishingPersistence implements PublishingStore {
  constructor(
    private readonly path: string | null,
    private readonly catalog: AffiliateRepositoryFactory,
    private readonly context: AffiliateRunContext,
    private readonly media: PublishingMedia,
    private readonly socialPath: string | null = null,
  ) {}
  private database(path: string | null, readOnly: boolean) {
    if (!path || !isAbsolute(path))
      throw new Error('PUBLISHING_DATABASE_REQUIRED');
    let db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout=5000');
      if (
        ![39, 40, 41, 42, 43, 44].includes(
          Number(db.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= 41 &&
          db
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw new Error('PUBLISHING_SCHEMA_VERSION_UNSUPPORTED');
      if (
        Number(db.prepare('PRAGMA user_version').get()?.user_version) === 44 &&
        db.prepare('SELECT name FROM schema_migrations WHERE version=44').get()
          ?.name !== '044_facebook_publication_supersession'
      )
        throw new Error('PUBLISHING_SCHEMA_VERSION_UNSUPPORTED');
      if (!readOnly) {
        db.close();
        db = new DatabaseSync(path);
        db.exec('PRAGMA busy_timeout=5000');
      }
      db.exec(readOnly ? 'PRAGMA query_only=ON' : 'PRAGMA foreign_keys=ON');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  open(readOnly = false) {
    const db = this.database(this.path, readOnly);
    let catalog: ReturnType<AffiliateRepositoryFactory['open']>;
    try {
      catalog = this.catalog.open(true);
    } catch (error) {
      db.close();
      throw error;
    }
    const evidence = {
      getVideoRender: (id: string) => this.media.getVideoRender(id),
      getQualityControlReport: (id: string) => this.media.report(id),
      verifyMedia: (ref: string) => this.media.verifyMedia(ref),
    };
    const manual = new ManualDistributionService({
      repository: new ManualDistributionRepository(
        { db },
        {
          getCampaign: (id, rev) => catalog.getCampaign(id, rev),
          getProduct: (id, rev) => catalog.getProduct(id, rev),
          resolveRunBriefing: (id, expected) =>
            this.context.resolveRunBriefing(id, expected),
        },
      ),
      evidence,
    });
    return {
      manual,
      approvals: new HumanApprovalRepository({ db }, evidence),
      close() {
        try {
          catalog.close();
        } finally {
          db.close();
        }
      },
    };
  }
  openInstagram(mode: 'fake' | 'live') {
    const db = this.database(this.path, false);
    let session: ReturnType<PublishingPersistence['open']> | undefined;
    try {
      if (
        ![42, 43, 44].includes(
          Number(db.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        db.prepare('SELECT name FROM schema_migrations WHERE version=42').get()
          ?.name !== '042_instagram_publication'
      )
        throw new Error('SOCIAL_SCHEMA_42_REQUIRED');
      const social = new SocialPublicationRepository({ db }, { mode });
      session = this.open();
      // Reuse catalog/evidence ports, with manual rules on the same connection as intent/reservation.
      const manual = new ManualDistributionService({
        repository: new ManualDistributionRepository(
          { db },
          session.manual.repository.catalog,
        ),
        evidence: session.manual.evidence,
      });
      return {
        social,
        manual,
        reservations: new InstagramPublicationRepository(db),
        close() {
          try {
            session!.close();
          } finally {
            db.close();
          }
        },
      };
    } catch (error) {
      session?.close();
      db.close();
      throw error;
    }
  }
  openDestination(mode: 'fake' | 'live') {
    const session = this.openInstagram(mode);
    if (
      ![43, 44].includes(
        Number(
          session.social.db.prepare('PRAGMA user_version').get()?.user_version,
        ),
      )
    ) {
      session.close();
      throw new Error('SOCIAL_SCHEMA_43_REQUIRED');
    }
    return {
      ...session,
      reservations: new DestinationReservationsRepository(session.social.db),
    };
  }
  readDestinations(id: string) {
    const db = this.database(this.path, true);
    try {
      const mode = db
        .prepare(
          'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
        )
        .get()?.execution_mode;
      if (mode !== 'fake' && mode !== 'live')
        throw new Error('SOCIAL_LIVE_PROVENANCE_REQUIRED');
      const social = new SocialPublicationRepository(
        { db },
        { mode, readOnly: true },
      );
      const reservations = new DestinationReservationsRepository(db);
      return reservations.list(id).flatMap((r) => {
        const active = reservations.activeForExecution(
          id,
          r.network,
          r.accountId,
        );
        const original = { ...r, operation: social.get(r.operationId) };
        return active && active.operationId !== r.operationId
          ? [
              original,
              {
                ...r,
                operationId: active.operationId,
                operation: social.get(active.operationId),
              },
            ]
          : [original];
      });
    } finally {
      db.close();
    }
  }
  readOperationalQueue(limit: number, offset: number) {
    const db = this.database(this.path, true);
    try {
      db.exec('BEGIN');
      const mode = db
        .prepare(
          'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
        )
        .get()?.execution_mode;
      if (mode !== 'fake' && mode !== 'live')
        throw new Error('SOCIAL_LIVE_PROVENANCE_REQUIRED');
      const social = new SocialPublicationRepository(
        { db },
        { mode, readOnly: true },
      );
      const reservations = new DestinationReservationsRepository(db);
      const relevant = `e.run_id IN (
        SELECT json_extract(payload_json,'$.identity.pipelineRunId')
        FROM manual_distribution_records WHERE kind='PACKAGE'
        AND json_extract(payload_json,'$.platform') IN ('instagram','facebook')
      ) OR EXISTS (
        SELECT 1 FROM campaign_execution_events h
        WHERE h.execution_id=e.execution_id AND h.sequence=1
        AND json_type(h.evidence_json,'$.publication') IS NOT NULL
      )`;
      const total = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM campaign_executions e WHERE ${relevant}`,
          )
          .get()?.n,
      );
      const executions = db
        .prepare(
          `SELECT e.execution_id,e.campaign_id,e.campaign_revision,e.run_id,
            e.production_date,e.scheduled_at,e.status,e.version,c.project_id
           FROM campaign_executions e JOIN affiliate_campaign_revisions c
           ON c.campaign_id=e.campaign_id AND c.revision=e.campaign_revision
           WHERE ${relevant}
           ORDER BY e.production_date DESC,e.execution_id DESC LIMIT ? OFFSET ?`,
        )
        .all(limit, offset);
      const items = executions.map((execution: any) => {
        const eventSql =
          'SELECT event_type,occurred_at,evidence_json FROM campaign_execution_events WHERE execution_id=?';
        const first = db
          .prepare(`${eventSql} ORDER BY sequence LIMIT 1`)
          .get(execution.execution_id);
        const last = db
          .prepare(`${eventSql} ORDER BY sequence DESC LIMIT 1`)
          .get(execution.execution_id);
        const blocking = db
          .prepare(
            `${eventSql} AND event_type IN ('PAUSED','STEP_FAILED') ORDER BY sequence DESC LIMIT 1`,
          )
          .get(execution.execution_id);
        const packages = db
          .prepare(
            `SELECT record_id,content_hash,payload_json FROM manual_distribution_records
             WHERE kind='PACKAGE' AND json_extract(payload_json,'$.identity.pipelineRunId')=?
             AND json_extract(payload_json,'$.platform') IN ('instagram','facebook')`,
          )
          .all(execution.run_id)
          .map((row: any) => {
            const value = JSON.parse(String(row.payload_json));
            if (
              value.contentHash !== row.content_hash ||
              value.contentHash !== row.record_id ||
              affiliateHash(value) !== row.content_hash
            )
              throw new Error('DISTRIBUTION_PERSISTED_INTEGRITY');
            const reviewRow = db
              .prepare(
                "SELECT content_hash,payload_json FROM manual_distribution_records WHERE kind='REVIEW' AND record_id=?",
              )
              .get(value.contentHash);
            const review = reviewRow
              ? JSON.parse(String(reviewRow.payload_json))
              : null;
            if (
              review &&
              (review.contentHash !== reviewRow!.content_hash ||
                affiliateHash(review) !== reviewRow!.content_hash)
            )
              throw new Error('DISTRIBUTION_PERSISTED_INTEGRITY');
            const revoked = review
              ? !!db
                  .prepare(
                    'SELECT 1 FROM instagram_approval_revocations WHERE review_hash=?',
                  )
                  .get(review.contentHash)
              : false;
            return { value, review, revoked };
          });
        const operations = reservations
          .list(String(execution.execution_id))
          .map((r) => {
            const active = reservations.activeForExecution(
              String(execution.execution_id),
              r.network,
              r.accountId,
            );
            const operation = active && social.get(active.operationId);
            if (!operation) throw new Error('SOCIAL_PERSISTED_INTEGRITY');
            return {
              network: r.network,
              accountId: r.accountId,
              originalOperationId: r.operationId,
              operation,
            };
          });
        return {
          execution,
          request: first ? JSON.parse(String(first.evidence_json)) : {},
          latestCampaignEvent: last
            ? {
                type: last.event_type,
                at: last.occurred_at,
                evidence: JSON.parse(String(last.evidence_json)),
              }
            : null,
          blockingEvent: blocking
            ? {
                type: blocking.event_type,
                at: blocking.occurred_at,
                evidence: JSON.parse(String(blocking.evidence_json)),
              }
            : null,
          packages,
          operations,
        };
      });
      return { total, items };
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
  }
  social<T>(action: (repository: SocialPublicationRepository) => T): T {
    const db = this.database(this.socialPath, true);
    try {
      const row = db
        .prepare(
          'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
        )
        .get();
      const mode = row?.execution_mode;
      if (mode !== 'fake' && mode !== 'live')
        throw new Error('SOCIAL_LIVE_PROVENANCE_REQUIRED');
      return action(
        new SocialPublicationRepository({ db }, { mode, readOnly: true }),
      );
    } finally {
      db.close();
    }
  }
}
