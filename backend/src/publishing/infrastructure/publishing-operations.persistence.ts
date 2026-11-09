import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import type { AffiliateRepositoryFactory } from '../../affiliate/application/ports/affiliate-repository.port.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type {
  PublishingOperationsPersistence,
  PublishingOperationsSession,
} from '../application/publishing-operations.port.js';
import { ManualDistributionRepository } from './manual-distribution.repository.js';
import { SocialPublicationRepository } from './social-publication.repository.js';

export class SqlitePublishingOperationsPersistence implements PublishingOperationsPersistence {
  constructor(
    private readonly path: string | null,
    private readonly catalog: AffiliateRepositoryFactory,
    private readonly context: AffiliateRunContext,
  ) {}
  open(): PublishingOperationsSession {
    if (!this.path || !isAbsolute(this.path))
      throw new Error('PUBLISHING_DATABASE_REQUIRED');
    const db = new DatabaseSync(this.path, { readOnly: true });
    let catalog: ReturnType<AffiliateRepositoryFactory['open']> | undefined;
    try {
      db.exec(
        'PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;PRAGMA query_only=ON',
      );
      catalog = this.catalog.open(true);
      const manual = new ManualDistributionRepository(
        { db },
        {
          getCampaign: (id, rev) => catalog!.getCampaign(id, rev),
          getProduct: (id, rev) => catalog!.getProduct(id, rev),
          resolveRunBriefing: (id, expected) =>
            this.context.resolveRunBriefing(id, expected),
        },
      );
      const table = (name: string) =>
        !!db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(name);
      const max = (name: string) =>
        table(name)
          ? Number(
              db.prepare(`SELECT COALESCE(MAX(rowid),0) n FROM ${name}`).get()
                ?.n,
            )
          : 0;
      return {
        checkpoint: () => ({
          social: max('social_publication_events'),
          manual: max('manual_distribution_records'),
        }),
        packages: (runId) =>
          db
            .prepare(
              "SELECT rowid,record_id FROM manual_distribution_records WHERE kind='PACKAGE' AND json_extract(payload_json,'$.identity.pipelineRunId')=? ORDER BY rowid",
            )
            .all(runId)
            .map((row) => {
              const value = manual.get('PACKAGE', String(row.record_id));
              const review = manual.get('REVIEW', value.contentHash);
              const revoked =
                !!review &&
                table('instagram_approval_revocations') &&
                manual.isApprovalRevoked(review.contentHash);
              return { cursor: Number(row.rowid), value, review, revoked };
            }),
        publications: (hash) =>
          manual.list('PUBLICATION', hash).map((value) => ({
            cursor: Number(
              db
                .prepare(
                  "SELECT rowid FROM manual_distribution_records WHERE kind='PUBLICATION' AND record_id=?",
                )
                .get(value.publicationId)?.rowid,
            ),
            value,
          })),
        operations: (hash) => {
          if (!table('social_publication_context')) return [];
          const mode = db
            .prepare(
              'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
            )
            .get()?.execution_mode;
          if (mode !== 'fake' && mode !== 'live') return [];
          const social = new SocialPublicationRepository(
            { db },
            { mode, readOnly: true },
          );
          return db
            .prepare(
              'SELECT operation_id FROM social_publication_operations WHERE package_hash=?',
            )
            .all(hash)
            .flatMap((row) => {
              const value = social.get(String(row.operation_id));
              if (!value) return [];
              const cursors = new Map(
                db
                  .prepare(
                    'SELECT rowid,version FROM social_publication_events WHERE operation_id=? ORDER BY version',
                  )
                  .all(value.operationId)
                  .map((r) => [Number(r.version), Number(r.rowid)]),
              );
              return [
                {
                  value,
                  mode,
                  history: social
                    .history(value.operationId)
                    .map((snapshot: any) => ({
                      cursor: cursors.get(snapshot.version)!,
                      value: snapshot,
                    })),
                },
              ];
            });
        },
        close: () => {
          try {
            catalog!.close();
          } finally {
            db.close();
          }
        },
      };
    } catch (error) {
      try {
        catalog?.close();
      } finally {
        db.close();
      }
      throw error;
    }
  }
}
