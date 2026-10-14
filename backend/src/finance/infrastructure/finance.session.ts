import { FinanceGate } from './finance-gate.repository.js';
import { CostLedgerRepository } from './cost-ledger.repository.js';
import {
  SqliteVideoFinancialCommitmentsReader,
  SqliteTtsFinancialCommitmentsReader,
  SqliteCampaignReferenceReader,
  SqliteFinancialAttributionReader,
} from './financial-readers.sqlite.js';

export class FinanceSession extends FinanceGate {
  private readonly ledger: CostLedgerRepository;
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
  }
  close() {
    this.ledger.close();
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
