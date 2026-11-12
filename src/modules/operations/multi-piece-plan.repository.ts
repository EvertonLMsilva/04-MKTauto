import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  canonicalJson,
  identifier,
  instant,
} from '../content-operations/domain/campaign.js';
import {
  MultiPiecePlanError,
  multiPieceRegistration,
  resolvePlanIdentities,
  planTimestamp,
  planReceipt,
  planRecordHash,
  planRow,
  pieceRows,
  occurrenceRows,
  type StoredMultiPiecePlan,
  type MultiPiecePlanIdentityReaders,
} from './multi-piece-plan.contract.js';

const plans = 'operations_multi_piece_plans_v1',
  pieces = 'operations_multi_piece_plan_pieces_v1',
  occurrences = 'operations_multi_piece_plan_occurrences_v1',
  requests = 'operations_multi_piece_plan_requests_v1';
const tables = [plans, pieces, occurrences, requests];
const schemaObjects = [
  ...tables,
  ...tables.flatMap((t) => [`${t}_no_update`, `${t}_no_delete`]),
  `${pieces}_sealed`,
  `${occurrences}_sealed`,
  `${requests}_complete`,
  'operations_multi_piece_plans_project_v1',
  'operations_multi_piece_plan_campaign_v1',
  'operations_multi_piece_plan_destination_v1',
  'operations_multi_piece_plan_request_hash_v1',
];
function hashInput(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw new MultiPiecePlanError('MULTI_PIECE_REQUEST_INVALID');
}
function same(actual: unknown, expected: unknown) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CORRUPT');
}
export class MultiPiecePlanRepository {
  constructor(
    private readonly path: string,
    private readonly readers?: MultiPiecePlanIdentityReaders,
    private readonly now = () => new Date().toISOString(),
  ) {}
  private connection<T>(write: boolean, action: (db: DatabaseSync) => T): T {
    if (!isAbsolute(this.path))
      throw new MultiPiecePlanError('MULTI_PIECE_DATABASE_REQUIRED');
    // Probe read-only first: a missing path must never create a database.
    let probe: DatabaseSync;
    try {
      probe = new DatabaseSync(this.path, { readOnly: true });
    } catch (error) {
      throw new MultiPiecePlanError('MULTI_PIECE_DATABASE_REQUIRED', error);
    }
    probe.close();
    const db = new DatabaseSync(this.path, { readOnly: !write });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const installed = new Set(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')",
          )
          .all()
          .map((r) => r.name),
      );
      if (schemaObjects.some((name) => !installed.has(name)))
        throw new MultiPiecePlanError('MULTI_PIECE_SCHEMA_NOT_PROVISIONED');
      // This connection exclusively owns its transaction; no caller-owned session
      // or asynchronous callback can outlive its snapshot/write lock.
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      for (const table of tables) {
        if (db.prepare(`PRAGMA foreign_key_check(${table})`).all().length)
          throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CORRUPT');
      }
      const result = action(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      if (error instanceof MultiPiecePlanError) throw error;
      const busy =
        error &&
        typeof error === 'object' &&
        'errcode' in error &&
        [5, 6].includes(Number(error.errcode));
      throw new MultiPiecePlanError(
        busy ? 'MULTI_PIECE_PLAN_BUSY' : 'MULTI_PIECE_PERSISTENCE_FAILED',
        error,
      );
    } finally {
      db.close();
    }
  }
  private load(db: DatabaseSync, hash: string): StoredMultiPiecePlan | null {
    const row = db
      .prepare(`SELECT * FROM ${plans} WHERE plan_hash=?`)
      .get(hash);
    if (!row) {
      for (const table of [pieces, occurrences, requests])
        if (db.prepare(`SELECT 1 FROM ${table} WHERE plan_hash=?`).get(hash))
          throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CORRUPT');
      return null;
    }
    try {
      const input = JSON.parse(String(row.input_json)) as unknown;
      const payload = JSON.parse(String(row.payload_json)) as unknown;
      const recalculated = multiPieceRegistration({
        requestId: 'recovery_check',
        input,
        plan: payload,
      });
      const createdAt = planTimestamp(row.created_at),
        plan = recalculated.plan;
      if (plan.planHash !== hash) throw new Error('HASH_MISMATCH');
      same(row, planRow(recalculated.input, plan, createdAt));
      same(
        db
          .prepare(`SELECT * FROM ${pieces} WHERE plan_hash=? ORDER BY ordinal`)
          .all(hash),
        pieceRows(plan),
      );
      same(
        db
          .prepare(
            `SELECT * FROM ${occurrences} WHERE plan_hash=? ORDER BY ordinal`,
          )
          .all(hash),
        occurrenceRows(plan),
      );
      const bindings = db
        .prepare(
          `SELECT * FROM ${requests} WHERE plan_hash=? ORDER BY created_at,request_id`,
        )
        .all(hash);
      if (!bindings.length) throw new Error('UNSEALED_PLAN');
      const receipts = bindings.map((binding) => {
        const receipt = planReceipt(
          plan,
          String(binding.request_id),
          planTimestamp(binding.created_at),
          createdAt,
        );
        same(binding, {
          project_id: plan.projectId,
          request_id: receipt.requestIdentity.requestId,
          plan_hash: hash,
          created_at: receipt.createdAt,
          receipt_hash: planRecordHash(receipt),
        });
        return receipt;
      });
      return { input: recalculated.input, plan, createdAt, receipts };
    } catch (error) {
      throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CORRUPT', error);
    }
  }
  private insert(
    db: DatabaseSync,
    table: string,
    row: Record<string, SQLInputValue>,
  ) {
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    ).run(...Object.values(row));
  }
  async registerPlan(raw: unknown) {
    const registration = multiPieceRegistration(raw);
    await resolvePlanIdentities(registration.input, this.readers);
    return this.connection(true, (db) => {
      const { plan, input, requestId } = registration;
      const prior = db
        .prepare(
          `SELECT plan_hash FROM ${requests} WHERE project_id=? AND request_id=?`,
        )
        .get(input.projectId, requestId);
      if (prior && prior.plan_hash !== plan.planHash)
        throw new MultiPiecePlanError('MULTI_PIECE_REQUEST_CONFLICT');
      const existing = this.load(db, plan.planHash);
      if (existing && canonicalJson(existing.input) !== canonicalJson(input))
        throw new MultiPiecePlanError('MULTI_PIECE_PLAN_CONFLICT');
      if (prior)
        return existing!.receipts.find(
          (r) => r.requestIdentity.requestId === requestId,
        )!;
      const createdAt = instant(this.now()),
        planCreatedAt = existing?.createdAt ?? createdAt;
      if (!existing) {
        this.insert(db, plans, planRow(input, plan, planCreatedAt));
        for (const row of pieceRows(plan)) this.insert(db, pieces, row);
        for (const row of occurrenceRows(plan))
          this.insert(db, occurrences, row);
      }
      const receipt = planReceipt(plan, requestId, createdAt, planCreatedAt);
      this.insert(db, requests, {
        project_id: input.projectId,
        request_id: requestId,
        plan_hash: plan.planHash,
        created_at: createdAt,
        receipt_hash: planRecordHash(receipt),
      });
      // Validate the complete persisted snapshot before committing, not after.
      return this.load(db, plan.planHash)!.receipts.find(
        (r) => r.requestIdentity.requestId === requestId,
      )!;
    });
  }
  getPlanByHash(hash: string) {
    hashInput(hash);
    return this.connection(false, (db) => this.load(db, hash));
  }
  listPlansByProject(projectId: string) {
    identifier(projectId);
    return this.connection(false, (db) =>
      db
        .prepare(
          `SELECT plan_hash FROM ${plans} WHERE project_id=? ORDER BY created_at,plan_hash`,
        )
        .all(projectId)
        .map((row) => this.load(db, String(row.plan_hash))!),
    );
  }
  listPiecesByPlan(hash: string) {
    return this.getPlanByHash(hash)?.plan.pieces ?? [];
  }
  listOccurrencesByPlan(hash: string) {
    return (
      this.getPlanByHash(hash)?.plan.pieces.flatMap((piece) =>
        piece.occurrences.map((occurrence) => ({
          ...occurrence,
          pieceId: piece.pieceId,
          campaignId: piece.campaignId,
          campaignRevision: piece.campaignRevision,
          contentType: piece.contentType,
          localDate: piece.localDate,
          localTime: piece.localTime,
        })),
      ) ?? []
    );
  }
}
