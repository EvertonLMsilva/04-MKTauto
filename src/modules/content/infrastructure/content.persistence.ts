import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import { ScriptRepository } from './script.repository.js';
import type { ContentStore } from '../application/content.port.js';

export const CONTENT_DATABASE = Symbol('CONTENT_DATABASE');
export class ContentPersistence implements ContentStore {
  constructor(
    private readonly path: string | null,
    private readonly operations: Pick<ContentOperationsService, 'get'>,
    private readonly affiliate: AffiliateRunContext,
  ) {}
  open(readOnly = false) {
    if (!this.path)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new ScriptRepository(this.path, this.operations, this.affiliate, {
      readOnly,
    });
  }
}
