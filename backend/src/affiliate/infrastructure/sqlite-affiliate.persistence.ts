import { Inject, Injectable } from '@nestjs/common';
import { AFFILIATE_DATABASE } from './affiliate-database.config.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import type { AffiliateRepositoryFactory } from '../application/ports/affiliate-repository.port.js';
@Injectable()
export class SqliteAffiliatePersistence implements AffiliateRepositoryFactory {
  constructor(
    @Inject(AFFILIATE_DATABASE) private readonly database: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.database)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new SqliteAffiliateRepository(this.database, { readOnly });
  }
}
