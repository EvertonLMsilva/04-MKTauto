import { DatabaseSync } from 'node:sqlite';
import {
  contentFixture,
  submission,
  researchShortlist,
} from '../../test/support/content-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import {
  referenceInsight,
  seedInsight,
} from '../../test/support/research-insight-fixture.js';
import { SqliteResearchReader } from './infrastructure/sqlite-research.reader.js';
import { createResearchShortlist } from './domain/research-shortlist-contracts.js';
import { createReferenceInsight } from './domain/reference-insight-contracts.js';
const legacy = await import(
  new URL(
    '../../../src/domain/research-shortlist-contracts.js',
    import.meta.url,
  ).href
);
const legacyInsight = await import(
  new URL('../../../src/domain/reference-insight-contracts.js', import.meta.url)
    .href
);

describe('Research public historical read boundary', () => {
  it('validates complete historical records with JS parity and preserves version variants', () => {
    const shortlist = researchShortlist();
    expect(createResearchShortlist(shortlist)).toEqual(
      legacy.createResearchShortlist(shortlist),
    );
    const insight = referenceInsight();
    expect(createReferenceInsight(insight)).toEqual(
      legacyInsight.createReferenceInsight(insight),
    );
    const old = structuredClone(shortlist);
    const item = old.orderedCandidates[0];
    item.candidate.schemaVersion = 'trend-contracts/1.1.0';
    item.cluster.schemaVersion = 'trend-contracts/1.1.0';
    item.cluster.ptBrLocalization = item.cluster.localization;
    delete item.cluster.localization;
    item.score.schemaVersion = 'trend-contracts/1.1.0';
    expect(createResearchShortlist(old)).toEqual(
      legacy.createResearchShortlist(old),
    );
  });
  it('reads valid insights, rejects incoherent evidence and never changes Research rows', () => {
    const f = contentFixture({ editorial: false });
    const r = contentStore(f.database).open();
    try {
      seedInsight(r.db);
      const before = r.db.prepare('SELECT * FROM reference_insights').all();
      const value = submission();
      value.proposals[0].referenceInsightId = 'reference-insight:001';
      value.proposals[0].referenceEvidenceIds = ['ref-evidence-1'];
      expect(r.registerBatch(value)[0].idea.referenceInsightId).toBe(
        'reference-insight:001',
      );
      expect(r.db.prepare('SELECT * FROM reference_insights').all()).toEqual(
        before,
      );
      const invalid = submission();
      invalid.ideaBatchId = 'batch_invalid_reference';
      invalid.proposals[0].ideaCandidateId = 'idea_invalid_reference';
      invalid.proposals[0].referenceInsightId = 'reference-insight:001';
      invalid.proposals[0].referenceEvidenceIds = ['missing-evidence'];
      expect(() => r.registerBatch(invalid)).toThrowError(
        expect.objectContaining({ code: 'REFERENCE_EVIDENCE_NOT_FOUND' }),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
      ).toBe(1);
    } finally {
      r.close();
      f.close();
    }
  });
  it('rejects valid records from another project version before any editorial insert', () => {
    const f = contentFixture({ editorial: false });
    const r = contentStore(f.database).open();
    try {
      const insight = referenceInsight();
      insight.projectVersion = 2;
      seedInsight(r.db, insight);
      const value = submission();
      value.proposals[0].referenceInsightId = insight.artifactId;
      expect(() => r.registerBatch(value)).toThrowError(
        expect.objectContaining({ code: 'IDEA_REFERENCE_SCOPE_MISMATCH' }),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      f.close();
    }
  });
  it('supports a read-only SQLite session and reports missing records', () => {
    const f = contentFixture({ editorial: false });
    const db = new DatabaseSync(f.database, { readOnly: true });
    try {
      const reader = new SqliteResearchReader(db);
      expect(reader.getShortlist('research-shortlist:001')).toBeTruthy();
      expect(reader.getShortlist('research-shortlist:missing')).toBeNull();
      expect(reader.getInsight('reference-insight:missing')).toBeNull();
      expect(() => db.exec('DELETE FROM research_shortlists')).toThrow();
    } finally {
      db.close();
      f.close();
    }
  });
});
