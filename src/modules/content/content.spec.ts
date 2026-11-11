import {
  contentFixture,
  submission,
  script,
} from '../../../test/support/content-fixture.js';
import { ContentPersistence } from './infrastructure/content.persistence.js';
import { SqliteOperationsRepository } from '../content-operations/infrastructure/sqlite-operations.repository.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
function store(database: string) {
  return new ContentPersistence(
    database,
    {
      get: (id: string) => {
        const r = new SqliteOperationsRepository(database, { readOnly: true });
        try {
          const run = r.getRun(id);
          if (!run) throw new Error('missing run');
          return run;
        } finally {
          r.close();
        }
      },
    },
    new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(database),
    ),
  );
}
describe('Content editorial persistence', () => {
  let fixture: ReturnType<typeof contentFixture>;
  beforeEach(() => {
    fixture = contentFixture();
  });
  afterEach(() => fixture.close());
  it('registers scripts, replays exactly and preserves append-only revisions', () => {
    const r = store(fixture.database).open();
    try {
      const v = script(fixture.selected);
      const saved = r.registerScript(v);
      expect(r.registerScript(v)).toEqual(saved);
      expect(r.getScript(v.scriptId)).toEqual(saved);
      const corrected = script(fixture.selected, {
        scriptId: 'script_revision_2',
        revision: 2,
        supersedesScriptId: v.scriptId,
        hook: 'Nova abertura editorial',
      });
      expect(r.registerScript(corrected).revision).toBe(2);
      expect(
        r.listScriptsBySelection(fixture.selected.ideaSelectionId),
      ).toHaveLength(2);
    } finally {
      r.close();
    }
  });
  it('rejects nonexistent Research and leaves no partial batch', () => {
    const r = store(fixture.database).open();
    try {
      expect(() =>
        r.registerBatch({
          ...submission(),
          ideaBatchId: 'batch_missing',
          researchShortlistId: 'research-shortlist:missing',
        }),
      ).toThrowError(
        expect.objectContaining({ code: 'RESEARCH_SHORTLIST_NOT_FOUND' }),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
      ).toBe(1);
    } finally {
      r.close();
    }
  });
  it('rolls back script and lineage after a trigger failure', () => {
    const r = store(fixture.database).open();
    try {
      r.db.exec(
        "CREATE TRIGGER test_reject BEFORE INSERT ON scripts BEGIN SELECT RAISE(ABORT,'test failure'); END",
      );
      expect(() => r.registerScript(script(fixture.selected))).toThrowError(
        expect.objectContaining({ code: 'SCRIPT_PERSISTENCE_FAILED' }),
      );
      expect(
        r.db
          .prepare(
            "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='script'",
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      r.close();
    }
  });
});
