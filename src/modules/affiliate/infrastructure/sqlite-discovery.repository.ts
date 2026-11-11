import {
  runAffiliateIo,
  iterateAffiliateIo,
} from '../application/affiliate-io.js';
import type { AffiliateSession } from './affiliate-sql.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import { affiliateHash, immutable } from '../domain/affiliate-contracts.js';
import { discoveryFail } from '../domain/affiliate-discovery.js';
import type { DiscoveryCandidate } from '../domain/affiliate-discovery.js';
import type {
  DiscoveryDecision,
  DiscoveryRepository,
} from '../application/ports/discovery.port.js';
export class SqliteDiscoveryRepository implements DiscoveryRepository {
  private readonly catalog: SqliteAffiliateRepository;
  constructor(
    path: string | AffiliateSession,
    {
      readOnly = false,
    }: {
      readOnly?: boolean;
    } = {},
  ) {
    this.catalog = new SqliteAffiliateRepository(path, { readOnly });
  }
  close() {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.catalog.close();
      }.call(this),
    );
  }
  get(id: string, requestHash?: string): DiscoveryDecision | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield (yield this.catalog.sql.prepare(
          'SELECT * FROM affiliate_discovery_decisions WHERE discovery_run_id=?',
        )).get(id);
        if (!row) return null;
        if (requestHash !== undefined && row.request_hash !== requestHash)
          discoveryFail('DISCOVERY_IDEMPOTENCY_CONFLICT');
        let decision: DiscoveryDecision;
        try {
          decision = JSON.parse(String(row.payload_json)) as DiscoveryDecision;
        } catch {
          discoveryFail('DISCOVERY_PERSISTED_INTEGRITY');
        }
        if (
          affiliateHash(decision) !== row.payload_hash ||
          decision.discoveryRunId !== id ||
          (decision.selection?.externalProductId ?? null) !==
            row.selected_external_product_id
        )
          discoveryFail('DISCOVERY_PERSISTED_INTEGRITY');
        return immutable(decision);
      }.call(this),
    );
  }
  used(candidates: readonly DiscoveryCandidate[]): Set<string> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const db = this.catalog.sql;
        const used = new Set(
          (yield db
            .prepare(
              'SELECT selected_external_product_id id FROM affiliate_discovery_decisions WHERE selected_external_product_id IS NOT NULL',
            )
            .all()).map((r: any) => String(r.id)),
        );
        for (const c of candidates) {
          const ids = [
            `shopee_${affiliateHash({ externalProductId: c.externalProductId })}`,
            c.productSpecificationEvidence.product?.productId,
          ];
          if (
            yield iterateAffiliateIo(
              ids,
              function* (
                this: any,
                id: string | undefined,
              ): Generator<unknown, any, any> {
                return (
                  id &&
                  (yield db
                    .prepare(
                      'SELECT 1 FROM affiliate_run_bindings WHERE product_id=? LIMIT 1',
                    )
                    .get(id))
                );
              }.bind(this),
              'some',
            )
          )
            used.add(c.externalProductId);
        }
        return used;
      }.call(this),
    );
  }
  reserve(
    id: string,
    hash: string,
    create: () => DiscoveryDecision | Promise<DiscoveryDecision>,
    at: string,
  ): DiscoveryDecision {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const db = this.catalog.sql;
        return yield this.catalog.transaction(() =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.get(id, hash);
              if (prior) {
                return prior;
              }
              const decision = yield create(),
                state = decision.selection ? 'RUNNING' : 'BLOCKED';
              if (decision.discoveryRunId !== id)
                discoveryFail('DISCOVERY_PERSISTED_INTEGRITY');
              yield db
                .prepare(
                  'INSERT INTO affiliate_discovery_decisions VALUES(?,?,?,?,?)',
                )
                .run(
                  id,
                  hash,
                  decision.selection?.externalProductId ?? null,
                  affiliateHash(decision),
                  JSON.stringify(decision),
                );
              // Exactly the legacy reservation checkpoint. RUNNING does not assert a
              // commercial success, and this adapter never advances production states.
              yield db
                .prepare(
                  'INSERT INTO affiliate_discovery_execution VALUES(?,?,NULL)',
                )
                .run(id, state);
              yield db
                .prepare(
                  'INSERT INTO affiliate_discovery_events(discovery_run_id,state,recorded_at) VALUES(?,?,?)',
                )
                .run(id, state, at);
              return immutable(decision);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
}
