import { DatabaseSync } from 'node:sqlite';
import {
  contentFixture,
  submission,
  script,
} from '../../test/support/content-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { selectionContentHash } from './domain/idea-selection-contracts.js';
import { scriptContentHash } from './domain/script-contracts.js';
import type { IdeaSelection } from './domain/content.types.js';
import { createReferenceInsight } from '../research/domain/reference-insight-contracts.js';
const legacy = await import(
  new URL('../../../src/script-repository.js', import.meta.url).href
);
const legacySelection = await import(
  new URL('../../../src/domain/idea-selection-contracts.js', import.meta.url)
    .href
);
const legacyScript = await import(
  new URL('../../../src/domain/script-contracts.js', import.meta.url).href
);
function failure(operation: () => unknown) {
  try {
    operation();
    return null;
  } catch (error) {
    const e = error as {
      name: string;
      code: string;
      field?: string;
      path?: string;
      message: string;
    };
    return {
      name: e.name,
      code: e.code,
      field: e.field ?? e.path,
      message: e.message,
    };
  }
}
function rows(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return [
      'idea_batches',
      'idea_candidates',
      'idea_scores',
      'idea_candidate_evidence',
      'idea_selections',
      'scripts',
      'artifact_lineage',
      'artifact_lineage_inputs',
    ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all());
  } finally {
    db.close();
  }
}
function selected(item: ReturnType<typeof submission>): IdeaSelection {
  const value = {
    schemaVersion: 'idea-selection/1.0.0',
    ideaSelectionId: 'selection_001',
    pipelineRunId: item.pipelineRunId,
    projectId: item.projectId,
    projectVersion: item.projectVersion,
    ideaBatchId: item.ideaBatchId,
    ideaCandidateId: 'idea_candidate_1',
    ideaScoreId: 'idea-score:idea_candidate_1',
    ideaContentHash: '',
    ideaScoreContentHash: '',
    decision: 'SELECTED' as const,
    actor: { type: 'HUMAN' as const, id: 'operator_001' },
    decidedAt: '2026-09-28T13:00:00.000Z',
    editorialRationale: 'Escolha editorial explícita',
    revision: 1,
    supersedesIdeaSelectionId: null,
    contentHash: '',
  };
  return value;
}
describe('Content JS/TS parity and historical inputs', () => {
  it('matches batches, scores, editorial decisions, scripts, revisions, failures and stored lineage', () => {
    const js = contentFixture({ editorial: false }),
      ts = contentFixture({ editorial: false });
    const a = new legacy.ScriptRepository(js.database),
      b = contentStore(ts.database).open();
    try {
      const input = submission();
      const ideas = b.registerBatch(input);
      expect(ideas).toEqual(a.registerBatch(input));
      expect(b.registerBatch(input)).toEqual(a.registerBatch(input));
      const v = selected(input);
      v.ideaContentHash = ideas[0].idea.contentHash;
      v.ideaScoreContentHash = ideas[0].score.contentHash;
      v.contentHash = selectionContentHash(v);
      expect(v.contentHash).toBe(legacySelection.selectionContentHash(v));
      expect(b.registerSelection(v)).toEqual(a.registerSelection(v));
      expect(b.registerSelection(v)).toEqual(a.registerSelection(v));
      const revised = {
        ...v,
        ideaSelectionId: 'selection_revision_2',
        revision: 2,
        supersedesIdeaSelectionId: v.ideaSelectionId,
        contentHash: '',
      };
      revised.contentHash = selectionContentHash(revised);
      expect(b.registerSelection(revised)).toEqual(
        a.registerSelection(revised),
      );
      const s = script(v);
      expect(scriptContentHash(s)).toBe(legacyScript.scriptContentHash(s));
      expect(b.registerScript(s)).toEqual(a.registerScript(s));
      expect(b.registerScript(s)).toEqual(a.registerScript(s));
      const corrected = script(v, {
        scriptId: 'script_revision_2',
        revision: 2,
        supersedesScriptId: s.scriptId,
      });
      expect(b.registerScript(corrected)).toEqual(a.registerScript(corrected));
      for (const value of [
        { ...input, pipelineRunId: 'run_missing_001' },
        { ...input, proposals: [] },
        { ...input, researchShortlistId: 'research-shortlist:missing' },
        { ...input, projectVersion: 2 },
        {
          ...input,
          proposals: [
            { ...input.proposals[0], title: 'Outra ideia editorial' },
          ],
        },
      ])
        expect(failure(() => b.registerBatch(value))).toEqual(
          failure(() => a.registerBatch(value)),
        );
      for (const value of [
        { ...v, ideaSelectionId: 'selection_conflict' },
        { ...v, actor: { type: 'AUTOMATION', id: 'operator_001' } },
        { ...v, contentHash: 'f'.repeat(64) },
      ])
        expect(failure(() => b.registerSelection(value))).toEqual(
          failure(() => a.registerSelection(value)),
        );
      const absent = script(v, {
        scriptId: 'script_absent',
        ideaSelectionId: 'selection_missing',
      });
      expect(failure(() => b.registerScript(absent))).toEqual(
        failure(() => a.registerScript(absent)),
      );
      expect(rows(ts.database)).toEqual(rows(js.database));
    } finally {
      a.close();
      b.close();
      js.close();
      ts.close();
    }
  });
  it('rolls back batch, scores and lineage and maps inconsistent Research like JS', () => {
    const js = contentFixture({ editorial: false }),
      ts = contentFixture({ editorial: false });
    const a = new legacy.ScriptRepository(js.database),
      b = contentStore(ts.database).open();
    try {
      for (const db of [a.db, b.db])
        db.exec(
          "CREATE TRIGGER test_reject BEFORE INSERT ON idea_scores BEGIN SELECT RAISE(ABORT,'test failure'); END",
        );
      expect(failure(() => b.registerBatch(submission()))).toEqual(
        failure(() => a.registerBatch(submission())),
      );
      expect(rows(ts.database)).toEqual(rows(js.database));
      expect(
        b.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
      ).toBe(0);
      for (const db of [a.db, b.db]) {
        db.exec('DROP TRIGGER test_reject');
        const triggers = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='research_shortlists'",
          )
          .all();
        for (const trigger of triggers)
          db.exec(`DROP TRIGGER "${trigger.name}"`);
        db.exec("UPDATE research_shortlists SET payload_json='{}'");
      }
      expect(failure(() => b.registerBatch(submission()))).toEqual(
        failure(() => a.registerBatch(submission())),
      );
    } finally {
      a.close();
      b.close();
      js.close();
      ts.close();
    }
  });
  it('rejects missing insights and invalid evidence without persisting a batch', () => {
    const f = contentFixture({ editorial: false });
    const r = contentStore(f.database).open();
    try {
      const v = submission();
      v.proposals[0].referenceInsightId = 'reference-insight:missing';
      expect(() => r.registerBatch(v)).toThrowError(
        expect.objectContaining({ code: 'REFERENCE_INSIGHT_NOT_FOUND' }),
      );
      v.proposals[0].referenceInsightId = null;
      v.proposals[0].evidenceCandidateIds = ['missing-candidate'];
      expect(() => r.registerBatch(v)).toThrowError(
        expect.objectContaining({ code: 'IDEA_EVIDENCE_NOT_IN_SHORTLIST' }),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      f.close();
    }
  });
  it('preserves ReferenceInsight validation parity for malformed historical records', async () => {
    const js = await import(
      new URL(
        '../../../src/domain/reference-insight-contracts.js',
        import.meta.url,
      ).href
    );
    for (const v of [null, {}, { schemaVersion: 'invalid' }])
      expect(failure(() => createReferenceInsight(v))).toEqual(
        failure(() => js.createReferenceInsight(v)),
      );
  });
});
