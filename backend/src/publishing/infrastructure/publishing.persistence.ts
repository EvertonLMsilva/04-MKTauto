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
      if (db.prepare('PRAGMA user_version').get()?.user_version !== 39)
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
