import { Inject, Injectable } from '@nestjs/common';
import {
  DISCOVERY_REPOSITORY,
  DISCOVERY_SOURCE,
} from './ports/discovery.port.js';
import type {
  DiscoveryRepositoryFactory,
  DiscoverySourceFactory,
} from './ports/discovery.port.js';
import { PROJECT_SNAPSHOT_READER } from '../../project/application/ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import {
  affiliateIdentifier,
  affiliateHash,
  immutable,
} from '../domain/affiliate-contracts.js';
import {
  DEFAULT_AFFILIATE_DISCOVERY_POLICY,
  discoveryFail,
  rankAffiliateDiscovery,
} from '../domain/affiliate-discovery.js';
interface SelectionCommand {
  discoveryRunId: string;
  projectId: string;
  projectVersion: number;
}
@Injectable()
export class AffiliateDiscoveryService {
  constructor(
    @Inject(DISCOVERY_REPOSITORY)
    private readonly persistence: DiscoveryRepositoryFactory,
    @Inject(DISCOVERY_SOURCE) private readonly sources: DiscoverySourceFactory,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  async select(raw: unknown) {
    const keys = ['discoveryRunId', 'projectId', 'projectVersion'];
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== keys.length ||
      keys.some((k) => !Object.hasOwn(raw, k))
    )
      discoveryFail('DISCOVERY_FIELDS_INVALID');
    const input = immutable(raw as SelectionCommand);
    affiliateIdentifier(input.discoveryRunId, 'discoveryRunId');
    affiliateIdentifier(input.projectId, 'projectId');
    if (!Number.isSafeInteger(input.projectVersion) || input.projectVersion < 1)
      discoveryFail('DISCOVERY_PROJECT_VERSION_INVALID');
    if (!(await this.projects.get(input.projectId, input.projectVersion)))
      discoveryFail('DISCOVERY_PROJECT_NOT_FOUND');
    const source = await this.sources.open(),
      policy = DEFAULT_AFFILIATE_DISCOVERY_POLICY;
    const hash = affiliateHash({ input, policy, sourceScope: source.scope });
    const repo = this.persistence.open();
    try {
      const prior = repo.get(input.discoveryRunId, hash);
      if (prior) return prior;
      const batch = await source.enumerateCandidates(),
        at = this.now();
      return repo.reserve(
        input.discoveryRunId,
        hash,
        () => {
          const ranking = rankAffiliateDiscovery(
            batch.candidates,
            policy,
            at,
            repo.used(batch.candidates),
          );
          const chosen = ranking.ranked[0];
          const selection = chosen
            ? {
                ...chosen,
                actor: {
                  type: 'AUTOMATION' as const,
                  id: 'kate_mkt_discovery',
                },
                externalProductId: chosen.candidate.externalProductId,
                sourceId: chosen.candidate.sourceId,
              }
            : null;
          return {
            discoveryRunId: input.discoveryRunId,
            selection,
            ranking,
            candidates: batch.candidates,
            source: batch.source,
            errors: batch.errors,
            policy,
            evaluatedAt: at,
          };
        },
        at,
      );
    } finally {
      repo.close();
    }
  }
  get(id: string) {
    affiliateIdentifier(id, 'discoveryRunId');
    const repo = this.persistence.open(true);
    try {
      return repo.get(id);
    } finally {
      repo.close();
    }
  }
}
