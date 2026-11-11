CREATE TABLE fal_financial_settlements (
  generation_key TEXT PRIMARY KEY REFERENCES fal_generations(generation_key),
  final_amount TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TRIGGER fal_settlement_no_update BEFORE UPDATE ON fal_financial_settlements
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_SETTLEMENT'); END;
CREATE TRIGGER fal_settlement_no_delete BEFORE DELETE ON fal_financial_settlements
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_SETTLEMENT'); END;
