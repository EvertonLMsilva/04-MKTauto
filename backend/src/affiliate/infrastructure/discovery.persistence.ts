import { Inject, Injectable } from '@nestjs/common';
import { AFFILIATE_DATABASE } from './affiliate-database.config.js';
import { SqliteDiscoveryRepository } from './sqlite-discovery.repository.js';
import type { DiscoveryRepositoryFactory } from '../application/ports/discovery.port.js';
@Injectable()
export class DiscoveryPersistence implements DiscoveryRepositoryFactory {
  constructor(
    @Inject(AFFILIATE_DATABASE) private readonly database: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.database)
      throw Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new SqliteDiscoveryRepository(this.database, { readOnly });
  }
}
