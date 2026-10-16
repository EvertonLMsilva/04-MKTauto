import { FinanceGate } from './finance-gate.repository.js';
import { CostLedgerRepository } from './cost-ledger.repository.js';
import {
  SqliteVideoFinancialCommitmentsReader,
  SqliteTtsFinancialCommitmentsReader,
  SqliteCampaignReferenceReader,
  SqliteFinancialAttributionReader,
  SqliteTtsFinancialSourcesReader,
} from './financial-readers.sqlite.js';
import { TtsFinanceRepository } from './tts-finance.repository.js';
import type { TtsResult } from '../domain/tts-financial-contracts.js';
import { CostAdjustmentsRepository } from './cost-adjustments.repository.js';

export class FinanceSession extends FinanceGate {
  private readonly ledger: CostLedgerRepository;
  private readonly ttsFinance: TtsFinanceRepository;
  constructor(path: string) {
    const ledger = new CostLedgerRepository(path);
    super(
      ledger,
      new SqliteVideoFinancialCommitmentsReader(ledger.db),
      new SqliteTtsFinancialCommitmentsReader(ledger.db),
      new SqliteCampaignReferenceReader(ledger),
      new SqliteFinancialAttributionReader(ledger.db),
    );
    this.ledger = ledger;
    this.ttsFinance = new TtsFinanceRepository(
      ledger,
      this,
      new SqliteTtsFinancialCommitmentsReader(ledger.db),
      new SqliteTtsFinancialSourcesReader(ledger.db),
      new SqliteCampaignReferenceReader(ledger),
    );
  }
  close() {
    this.ledger.close();
  }
  registerTtsAdjustment(value: unknown) {
    return new CostAdjustmentsRepository(this.ledger).register(value);
  }
  getTtsStatementV2(id: string) {
    return new CostAdjustmentsRepository(this.ledger).statement(id);
  }
  getLedgerV2ByPipelineRun(id: string) {
    return new CostAdjustmentsRepository(this.ledger).ledgerV2(id);
  }
  approveTts(plan: unknown, approval: unknown) {
    return this.ttsFinance.approveTts(plan, approval);
  }
  beginTts(plan: unknown, now = new Date().toISOString()) {
    return this.ttsFinance.beginTts(plan, now);
  }
  override getTts(id: string) {
    return this.ttsFinance.getTts(id);
  }
  dispatchTts(id: string, now = new Date().toISOString()): never {
    return this.ttsFinance.dispatchTts(id, now);
  }
  markTtsUnknown(id: string, errorCode?: string | null) {
    return this.ttsFinance.markTtsUnknown(id, errorCode);
  }
  recordTtsResult(id: string, result: TtsResult) {
    return this.ttsFinance.recordTtsResult(id, result);
  }
  reconcileTts(id: string, evidenceReference: string) {
    return this.ttsFinance.reconcileTts(id, evidenceReference);
  }
  accountTts(id: string) {
    return this.ttsFinance.accountTts(id);
  }
  register(value: unknown) {
    return this.ledger.registerCostEvent(value);
  }
  get(id: string) {
    return this.ledger.getCostEvent(id);
  }
  listByPipelineRun(id: string) {
    return this.ledger.listCostEventsByPipelineRun(id);
  }
  getLedgerByPipelineRun(id: string) {
    // The run and ordered events belong to one snapshot as well.
    this.db.exec('BEGIN');
    try {
      const value = this.ledger.getCostLedgerByPipelineRun(id);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  getGlobalOperation(id: string) {
    return (
      this.db
        .prepare('SELECT * FROM global_paid_operations WHERE operation_id=?')
        .get(id) ?? null
    );
  }
}
