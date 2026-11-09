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
      return new DestinationReservationsRepository(db)
        .list(id)
        .map((r) => ({ ...r, operation: social.get(r.operationId) }));
    } finally {
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
