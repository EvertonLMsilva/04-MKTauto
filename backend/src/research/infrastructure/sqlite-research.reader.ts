import type { DatabaseSync } from 'node:sqlite';
import type { ResearchReader } from '../application/research-reader.port.js';
import { createResearchShortlist } from '../domain/research-shortlist-contracts.js';
import { createReferenceInsight } from '../domain/reference-insight-contracts.js';

export class ResearchReadError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: registro histórico inválido`, options);
    this.name = 'ResearchReadError';
  }
}

// Queries only. The connection is borrowed from the editorial transaction so
// historical inputs are read from the same snapshot as the resulting artifacts.
export class SqliteResearchReader implements ResearchReader {
  constructor(private readonly database: DatabaseSync) {}
  getShortlist(id: string) {
    const row = this.database
      .prepare(
        'SELECT payload_json FROM research_shortlists WHERE artifact_id = ?',
      )
      .get(id);
    if (!row) return null;
    try {
      return createResearchShortlist(JSON.parse(String(row.payload_json)));
    } catch (cause) {
      throw new ResearchReadError(
        'INVALID_PERSISTED_RESEARCH_SHORTLIST',
        'researchShortlistId',
        { cause },
      );
    }
  }
  getInsight(id: string) {
    const row = this.database
      .prepare(
        'SELECT payload_json FROM reference_insights WHERE artifact_id = ?',
      )
      .get(id);
    if (!row) return null;
    try {
      return createReferenceInsight(JSON.parse(String(row.payload_json)));
    } catch (cause) {
      throw new ResearchReadError(
        'INVALID_PERSISTED_REFERENCE_INSIGHT',
        'referenceInsightId',
        { cause },
      );
    }
  }
}
