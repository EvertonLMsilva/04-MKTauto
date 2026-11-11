import { runAffiliateIo } from './affiliate-io.js';
import type { Io } from './affiliate-io.js';
import type { DiscoveryDecision } from './ports/discovery.port.js';
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
export class AffiliateDiscoveryService<A extends boolean = false> {
  constructor(
    @Inject(DISCOVERY_REPOSITORY)
    private readonly persistence: DiscoveryRepositoryFactory<A>,
    @Inject(DISCOVERY_SOURCE)
    private readonly sources: DiscoverySourceFactory,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  async select(raw: unknown): Promise<DiscoveryDecision> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
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
        if (
          !Number.isSafeInteger(input.projectVersion) ||
          input.projectVersion < 1
        )
          discoveryFail('DISCOVERY_PROJECT_VERSION_INVALID');
        if (
          !(yield yield this.projects.get(
            input.projectId,
            input.projectVersion,
          ))
        )
          discoveryFail('DISCOVERY_PROJECT_NOT_FOUND');
        const source = yield yield this.sources.open(),
          policy = DEFAULT_AFFILIATE_DISCOVERY_POLICY;
        const hash = affiliateHash({
          input,
          policy,
          sourceScope: source.scope,
        });
        const repo = yield this.persistence.open();
        try {
          const prior = yield repo.get(input.discoveryRunId, hash);
          if (prior) return prior;
          const batch = yield source.enumerateCandidates(),
            at = yield this.now();
          return yield repo.reserve(
            input.discoveryRunId,
            hash,
            () =>
              runAffiliateIo(
                function* (this: any): Generator<unknown, any, any> {
                  const ranking = rankAffiliateDiscovery(
                    batch.candidates,
                    policy,
                    at,
                    yield repo.used(batch.candidates),
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
                }.call(this),
              ),
            at,
          );
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
  get(id: string): Io<A, DiscoveryDecision | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        affiliateIdentifier(id, 'discoveryRunId');
        const repo = yield this.persistence.open(true);
        try {
          return yield repo.get(id);
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
}
