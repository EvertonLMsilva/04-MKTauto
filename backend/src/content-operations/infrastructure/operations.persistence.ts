import { Inject, Injectable } from '@nestjs/common';
import { CONTENT_OPERATIONS_DATABASE } from '../application/ports/operations.port.js';
import type { OperationsStore } from '../application/ports/operations.port.js';
import { SqliteOperationsRepository } from './sqlite-operations.repository.js';
import { StageRecoveryRepository } from './stage-recovery.repository.js';
class OperationsSession extends SqliteOperationsRepository {
  readonly stages = new StageRecoveryRepository(this);
}
@Injectable()
export class OperationsPersistence implements OperationsStore {
  constructor(
    @Inject(CONTENT_OPERATIONS_DATABASE) private readonly path: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.path)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new OperationsSession(this.path, { readOnly });
  }
}
