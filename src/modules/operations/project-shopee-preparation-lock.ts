import { Inject, Injectable } from '@nestjs/common';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import {
  PROJECT_SNAPSHOT_READER,
  type ProjectSnapshotReader,
} from '../project/application/ports/project-snapshot-reader.port.js';
import {
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
} from '../affiliate/domain/shopee-dynamic.js';
import { discoveryFailure } from './project-shopee-discovery.contract.js';
/** Serializes configure + cycle across Operations entry points using the existing Affiliate journal. No timer. */
@Injectable()
export class ProjectShopeePreparationLock {
  constructor(
    @Inject(ShopeeDynamicJournal) readonly journal: ShopeeDynamicJournal,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
  ) {}
  async run<T>(
    raw: ShopeeDynamicConfiguration,
    action: () => Promise<T>,
    expectedProjectVersion?: number,
  ): Promise<T> {
    const configuration = validateDynamicConfiguration(raw);
    const project = await this.projects.get(configuration.projectId);
    if (!project) discoveryFailure('PROJECT_NOT_FOUND', 404);
    if (
      expectedProjectVersion !== undefined &&
      project.project.version !== expectedProjectVersion
    )
      discoveryFailure('SHOPEE_PROJECT_REVISION_MISMATCH');
    if (project.project.niche !== configuration.niche)
      discoveryFailure('SHOPEE_PROJECT_NICHE_MISMATCH');
    const journal = this.journal;
    journal.initialize();
    const previous = journal.get<{ generation: number; expiresAt: number }>(
      'OPERATIONS_PROJECT_LEASE',
      configuration.projectId,
    );
    if (
      previous &&
      previous.expiresAt > Date.now() &&
      !journal.get(
        'OPERATIONS_PROJECT_RELEASE',
        configuration.projectId,
        String(previous.generation),
      )
    )
      discoveryFailure('SHOPEE_PROJECT_BUSY', 409);
    const generation = (previous?.generation ?? 0) + 1;
    if (
      !journal.put(
        'OPERATIONS_PROJECT_LEASE',
        configuration.projectId,
        String(generation),
        { generation, expiresAt: Date.now() + 300000 },
      )
    )
      discoveryFailure('SHOPEE_PROJECT_BUSY', 409);
    try {
      return await action();
    } finally {
      journal.put(
        'OPERATIONS_PROJECT_RELEASE',
        configuration.projectId,
        String(generation),
        { generation },
      );
    }
  }
}
