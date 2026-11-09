import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import type { CampaignOperationsPersistence } from '../application/campaign-operations.port.js';
import { CampaignRepository } from './campaign.repository.js';

export class SqliteCampaignOperationsPersistence implements CampaignOperationsPersistence {
  constructor(private readonly path: string | null) {}
  open() {
    if (!this.path || !isAbsolute(this.path))
      throw new Error('CAMPAIGN_DATABASE_REQUIRED');
    const check = new DatabaseSync(this.path, { readOnly: true });
    try {
      if (
        ![41, 42, 43, 44].includes(
          Number(check.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        check
          .prepare('SELECT name FROM schema_migrations WHERE version=41')
          .get()?.name !== '041_campaign_orchestration'
      )
        throw new Error('CAMPAIGN_SCHEMA_41_REQUIRED');
    } finally {
      check.close();
    }
    const db = new DatabaseSync(this.path);
    try {
      db.exec('PRAGMA foreign_keys=ON');
      return {
        repository: new CampaignRepository(db),
        close: () => db.close(),
      };
    } catch (error) {
      db.close();
      throw error;
    }
  }
}
