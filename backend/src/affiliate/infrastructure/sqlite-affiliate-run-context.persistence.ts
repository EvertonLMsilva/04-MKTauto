import { Inject, Injectable } from '@nestjs/common';
import { AFFILIATE_DATABASE } from './affiliate-database.config.js';
import { SqliteAffiliateRunContextRepository } from './sqlite-affiliate-run-context.repository.js';
import type { AffiliateRunContextFactory } from '../application/ports/affiliate-run-context.port.js';
@Injectable()
export class SqliteAffiliateRunContextPersistence implements AffiliateRunContextFactory {
  constructor(
    @Inject(AFFILIATE_DATABASE) private readonly database: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.database)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new SqliteAffiliateRunContextRepository(this.database, { readOnly });
  }
}
