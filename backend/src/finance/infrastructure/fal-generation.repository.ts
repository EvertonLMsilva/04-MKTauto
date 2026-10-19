import { createHash } from 'node:crypto';
import type { CostLedgerRepository } from './cost-ledger.repository.js';
import type { FinancialDatabase } from '../application/financial-readers.port.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { validateMediaProviderOutput } from '../../media/domain/media-acquisition-contracts.js';
import { validateCostEvent } from '../domain/cost-event-contracts.js';
import { falFailure } from '../domain/fal-errors.js';
export { falFailure } from '../domain/fal-errors.js';
// Keep the original byte-level JSON receipt shared by every reader of fal output.
export function verifiedFalOutput(row: {
  output_json: string | null;
  output_hash: string | null;
}) {
  const output =
    row.output_json === null
      ? null
      : validateMediaProviderOutput(JSON.parse(row.output_json));
  if (output && digest(row.output_json) !== row.output_hash)
    throw falFailure('PROVIDER_PERSISTED_JOB_INVALID');
  return output;
}
// Exact monetary arithmetic, with the same maximum precision as CostLedger.
export function money(value: any) {
  if (typeof value !== 'string' || !/^\d{1,40}(?:\.\d{1,18})?$/.test(value))
    throw falFailure('PROVIDER_INVALID_BUDGET', 'amount');
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer + fraction.padEnd(18, '0'));
}
export class FalGenerationRepository {
  readonly repository: CostLedgerRepository;
  readonly costs: CostLedgerRepository;
  readonly db: FinancialDatabase;
  constructor(ledger: CostLedgerRepository) {
    this.repository = ledger;
    this.costs = ledger;
    this.db = ledger.db;
  }
  close() {
    this.costs.close();
  }
  getRequestBinding(id: string) {
    return (
      this.db
        .prepare(
          'SELECT generation_key,request_hash FROM fal_generation_requests WHERE acquisition_request_id=?',
        )
        .get(id) ?? null
    );
  }
  get(key: any) {
    const row = this.db
      .prepare('SELECT * FROM fal_generations WHERE generation_key = ?')
      .get(key);
    if (!row) return null;
    if (affiliateHash(JSON.parse(row.basis_json)) !== key)
      throw falFailure('PROVIDER_PERSISTED_JOB_INVALID');
    const output = verifiedFalOutput(row);
    const events = this.observedEvents(key, row.pipeline_run_id);
    return {
      key,
      state: row.state,
      requestId: row.request_id,
      statusUrl: row.status_url,
      responseUrl: row.response_url,
      output,
      basis: JSON.parse(row.basis_json),
      createdAt: row.created_at,
      financiallySettled: Boolean(
        this.db
          .prepare(
            'SELECT 1 FROM fal_financial_settlements WHERE generation_key=?',
          )
          .get(key),
      ),
      observedCostAmount: events.length
        ? decimal(
            events.reduce(
              (total: any, event: any) => total + money(event.amount),
              0n,
            ),
          )
        : null,
      cost: events.at(-1) ?? null,
    };
  }
  observedEvents(key: any, runId: any) {
    const prefix = `cost:fal:${key}`;
    return this.costs
      .listCostEventsByPipelineRun(runId)
      .filter(
        (event: any) =>
          event.costEventId === prefix ||
          event.costEventId.startsWith(`${prefix}:`),
      );
  }
  observedTotal(key: any, runId: any) {
    return this.observedEvents(key, runId).reduce(
      (total: any, event: any) => total + money(event.amount),
      0n,
    );
  }
  getByAcquisitionRequest(id: any) {
    const alias = this.db
      .prepare(
        'SELECT generation_key FROM fal_generation_requests WHERE acquisition_request_id=?',
      )
      .get(id);
    return alias ? this.get(alias.generation_key) : null;
  }
  reserve({ basis, request, budget, estimate }: any) {
    const key = affiliateHash(basis);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const priorRequest = this.db
        .prepare(
          'SELECT * FROM fal_generation_requests WHERE acquisition_request_id = ?',
        )
        .get(request.mediaAcquisitionRequestId);
      if (
        priorRequest &&
        (priorRequest.generation_key !== key ||
          priorRequest.request_hash !== request.contentHash)
      )
        throw falFailure('PROVIDER_REQUEST_CONFLICT');
      let job = this.get(key);
      let owner = false;
      if (!job) {
        validateBudget(budget, estimate);
        const run = this.repository.getRun(basis.pipelineRunId);
        if (!run || run.state !== 'RUNNING')
          throw falFailure('PROVIDER_RUN_NOT_ACTIVE');
        const ledger = this.costs.getCostLedgerByPipelineRun(
          basis.pipelineRunId,
        );
        // No currency conversion is guessed; a mixed-currency ledger requires explicit reconciliation.
        if (
          ledger.totalsByCurrency.some(
            (total: any) => total.currency !== budget.currency,
          )
        )
          throw falFailure('PROVIDER_BUDGET_CURRENCY_MISMATCH');
        let used = ledger.totalsByCurrency.reduce(
          (sum: any, total: any) => sum + money(total.amount),
          0n,
        );
        const reservations = this.db
          .prepare(
            `SELECT generation_key, estimate_amount, currency FROM fal_generations
          WHERE pipeline_run_id = ?`,
          )
          .all(basis.pipelineRunId);
        for (const reserved of reservations) {
          if (reserved.currency !== budget.currency)
            throw falFailure('PROVIDER_BUDGET_CURRENCY_MISMATCH');
          const settled = this.db
            .prepare(
              'SELECT 1 FROM fal_financial_settlements WHERE generation_key=?',
            )
            .get(reserved.generation_key);
          if (!settled) {
            const remainder =
              money(reserved.estimate_amount) -
              this.observedTotal(reserved.generation_key, basis.pipelineRunId);
            if (remainder > 0n) used += remainder;
          }
        }
        if (used + money(estimate.amount) > money(budget.amount))
          throw falFailure('PROVIDER_BUDGET_EXCEEDED');
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO fal_generations
          (generation_key,pipeline_run_id,basis_json,state,estimate_amount,currency,estimate_source,created_at,updated_at)
          VALUES (?,?,?,'DISPATCHING',?,?,?,?,?)`,
          )
          .run(
            key,
            basis.pipelineRunId,
            JSON.stringify(basis),
            estimate.amount,
            estimate.currency,
            estimate.source,
            now,
            now,
          );
        job = this.get(key);
        owner = true;
      }
      if (!priorRequest)
        this.db
          .prepare('INSERT INTO fal_generation_requests VALUES (?,?,?)')
          .run(request.mediaAcquisitionRequestId, key, request.contentHash);
      this.db.exec('COMMIT');
      return { ...job, owner };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  submitted(
    key: any,
    requestId: any,
    {
      statusUrl = null,
      responseUrl = null,
      reconciliationPending = false,
    }: any = {},
  ) {
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9_-]{3,120}$/.test(requestId)
    )
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    this.db
      .prepare(
        `UPDATE fal_generations SET request_id=?,status_url=?,response_url=?, state=?, updated_at=?
      WHERE generation_key=? AND state='DISPATCHING' AND request_id IS NULL`,
      )
      .run(
        requestId,
        statusUrl,
        responseUrl,
        reconciliationPending ? 'RECONCILIATION_PENDING' : 'IN_QUEUE',
        new Date().toISOString(),
        key,
      );
    return this.get(key);
  }
  uncertain(key: any) {
    this.db
      .prepare(
        `UPDATE fal_generations SET state='RECONCILIATION_PENDING',updated_at=?
      WHERE generation_key=? AND state='DISPATCHING' AND request_id IS NULL`,
      )
      .run(new Date().toISOString(), key);
  }
  state(key: any, state: any) {
    if (!['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(state))
      throw falFailure('PROVIDER_INVALID_RESPONSE');
    // Polling can race. Never regress completed/in-progress evidence.
    this.db
      .prepare(
        `UPDATE fal_generations SET state=?,updated_at=? WHERE generation_key=?
      AND (state IN ('IN_QUEUE','IN_PROGRESS') OR (state='RECONCILIATION_PENDING' AND request_id IS NOT NULL))
      AND NOT (state='IN_PROGRESS' AND ?='IN_QUEUE')`,
      )
      .run(state, new Date().toISOString(), key, state);
    return this.get(key);
  }
  complete(key: any, output: any) {
    const payload = JSON.stringify(validateMediaProviderOutput(output));
    this.db
      .prepare(
        `UPDATE fal_generations SET output_json=?,output_hash=?,updated_at=?
      WHERE generation_key=? AND state='COMPLETED' AND output_json IS NULL`,
      )
      .run(payload, digest(payload), new Date().toISOString(), key);
    return this.get(key)!.output;
  }
  recordObservedCost(key: any, observation: any) {
    // Use the ledger connection for both writes; its nested write uses a savepoint.
    const db = this.costs.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.get(key);
      if (!job?.requestId) throw falFailure('PROVIDER_COST_WITHOUT_REQUEST');
      if (
        !observation ||
        observation.currency !==
          this.db
            .prepare(
              'SELECT currency FROM fal_generations WHERE generation_key=?',
            )
            .get(key).currency ||
        typeof observation.source !== 'string' ||
        !/^[a-zA-Z0-9_.:/-]{3,120}$/.test(observation.source)
      )
        throw falFailure('PROVIDER_INVALID_COST');
      if (
        observation.final !== undefined &&
        typeof observation.final !== 'boolean'
      )
        throw falFailure('PROVIDER_INVALID_COST');
      const run = this.repository.getRun(job.basis.pipelineRunId);
      const evidence = validateCostEvent({
        schemaVersion: 'cost-event/1.0.0',
        costEventId: `cost:fal:${key}`,
        category: 'media_cost',
        pipelineRunId: run.pipelineRunId,
        projectId: run.projectId,
        projectVersion: run.projectVersion,
        contentIdentity: null,
        artifactId: null,
        amount: observation.amount,
        currency: observation.currency,
        occurredAt: observation.occurredAt,
        origin: observation.source,
        attributionRuleVersion: 'fal-observed-cost/1.0.0',
        recordedAt: job.createdAt,
      });
      const hash = digest(JSON.stringify(evidence));
      const eventId = `${evidence.costEventId}:${hash}`;
      const settled = db
        .prepare(
          'SELECT * FROM fal_financial_settlements WHERE generation_key=?',
        )
        .get(key);
      const prior = this.costs.getCostEvent(eventId);
      let result = prior;
      if (settled) {
        if (observation.final ? settled.evidence_hash !== hash : !prior)
          throw falFailure('PROVIDER_COST_ALREADY_SETTLED');
      } else {
        if (observation.final && !['COMPLETED', 'FAILED'].includes(job.state))
          throw falFailure('PROVIDER_COST_NOT_TERMINAL');
        const current = this.observedTotal(key, run.pipelineRunId);
        const target = money(evidence.amount);
        if (!prior && target < current)
          throw falFailure('PROVIDER_COST_REGRESSION');
        if (!prior && target > current)
          result = this.costs.registerCostEvent({
            ...evidence,
            costEventId: eventId,
            amount: decimal(target - current),
          });
        if (observation.final) {
          if (target !== this.observedTotal(key, run.pipelineRunId))
            throw falFailure('PROVIDER_COST_REGRESSION');
          db.prepare(
            'INSERT INTO fal_financial_settlements VALUES (?,?,?,?,?)',
          ).run(
            key,
            evidence.amount,
            hash,
            observation.source,
            observation.occurredAt,
          );
        }
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
}
function decimal(value: any) {
  const raw = value.toString().padStart(19, '0');
  const fraction = raw.slice(-18).replace(/0+$/, '');
  return fraction ? `${raw.slice(0, -18)}.${fraction}` : raw.slice(0, -18);
}
function digest(value: any) {
  return createHash('sha256').update(value).digest('hex');
}
function validateBudget(budget: any, estimate: any) {
  if (
    !estimate ||
    typeof estimate.source !== 'string' ||
    !/^[a-zA-Z0-9_.:/-]{3,120}$/.test(estimate.source) ||
    money(estimate.amount) <= 0n
  )
    throw falFailure('PROVIDER_COST_ESTIMATE_REQUIRED');
  if (
    !budget ||
    money(budget.amount) <= 0n ||
    !/^[A-Z]{3}$/.test(budget.currency)
  )
    throw falFailure('PROVIDER_INVALID_BUDGET');
  if (estimate.currency !== budget.currency)
    throw falFailure('PROVIDER_BUDGET_CURRENCY_MISMATCH');
}
