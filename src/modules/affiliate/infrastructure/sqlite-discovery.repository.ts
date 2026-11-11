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
  constructor(path: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    this.catalog = new SqliteAffiliateRepository(path, { readOnly });
  }
  close() {
    this.catalog.close();
  }
  get(id: string, requestHash?: string): DiscoveryDecision | null {
    const row = this.catalog.db
      .prepare(
        'SELECT * FROM affiliate_discovery_decisions WHERE discovery_run_id=?',
      )
      .get(id);
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
  }
  used(candidates: readonly DiscoveryCandidate[]): Set<string> {
    const db = this.catalog.db;
    const used = new Set(
      db
        .prepare(
          'SELECT selected_external_product_id id FROM affiliate_discovery_decisions WHERE selected_external_product_id IS NOT NULL',
        )
        .all()
        .map((r) => String(r.id)),
    );
    for (const c of candidates) {
      const ids = [
        `shopee_${affiliateHash({ externalProductId: c.externalProductId })}`,
        c.productSpecificationEvidence.product?.productId,
      ];
      if (
        ids.some(
          (id) =>
            id &&
            db
              .prepare(
                'SELECT 1 FROM affiliate_run_bindings WHERE product_id=? LIMIT 1',
              )
              .get(id),
        )
      )
        used.add(c.externalProductId);
    }
    return used;
  }
  reserve(
    id: string,
    hash: string,
    create: () => DiscoveryDecision,
    at: string,
  ): DiscoveryDecision {
    const db = this.catalog.db;
    try {
      db.exec('BEGIN IMMEDIATE');
      const prior = this.get(id, hash);
      if (prior) {
        db.exec('COMMIT');
        return prior;
      }
      const decision = create(),
        state = decision.selection ? 'RUNNING' : 'BLOCKED';
      if (decision.discoveryRunId !== id)
        discoveryFail('DISCOVERY_PERSISTED_INTEGRITY');
      db.prepare(
        'INSERT INTO affiliate_discovery_decisions VALUES(?,?,?,?,?)',
      ).run(
        id,
        hash,
        decision.selection?.externalProductId ?? null,
        affiliateHash(decision),
        JSON.stringify(decision),
      );
      // Exactly the legacy reservation checkpoint. RUNNING does not assert a
      // commercial success, and this adapter never advances production states.
      db.prepare(
        'INSERT INTO affiliate_discovery_execution VALUES(?,?,NULL)',
      ).run(id, state);
      db.prepare(
        'INSERT INTO affiliate_discovery_events(discovery_run_id,state,recorded_at) VALUES(?,?,?)',
      ).run(id, state, at);
      db.exec('COMMIT');
      return immutable(decision);
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
}
