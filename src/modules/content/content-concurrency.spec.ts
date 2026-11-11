import {
  contentFixture,
  submission,
  script,
} from '../../../test/support/content-fixture.js';
import { contentStore } from '../../../test/support/content-store.js';
import { raceContent } from '../../../test/support/content-concurrency.js';
import { selectionContentHash } from './domain/idea-selection-contracts.js';

describe('Content simultaneous SQLite writers', () => {
  it('serializes identical batch replay without duplicate artifacts', async () => {
    const f = contentFixture({ editorial: false });
    try {
      const value = submission();
      expect(
        await raceContent(f.database, 'registerBatch', [value, value]),
      ).toEqual([{ ok: true }, { ok: true }]);
      const r = contentStore(f.database).open();
      try {
        expect(
          r.db.prepare('SELECT COUNT(*) AS n FROM idea_batches').get()?.n,
        ).toBe(1);
        expect(
          r.db.prepare('SELECT COUNT(*) AS n FROM idea_candidates').get()?.n,
        ).toBe(1);
      } finally {
        r.close();
      }
    } finally {
      f.close();
    }
  });
  it('allows one editorial revision and rejects the concurrent fork atomically', async () => {
    const f = contentFixture();
    try {
      const one = {
        ...f.selected,
        ideaSelectionId: 'selection_fork_one',
        revision: 2,
        supersedesIdeaSelectionId: f.selected.ideaSelectionId,
        contentHash: '',
      };
      one.contentHash = selectionContentHash(one);
      const two = {
        ...one,
        ideaSelectionId: 'selection_fork_two',
        contentHash: '',
      };
      two.contentHash = selectionContentHash(two);
      const results = await raceContent(f.database, 'registerSelection', [
        one,
        two,
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)?.code).toMatch(
        /IDEA_SELECTION_(REVISION_CONFLICT|ALREADY_SUPERSEDED)/,
      );
      const r = contentStore(f.database).open();
      try {
        expect(
          r.listSelectionsByPipelineRun(f.selected.pipelineRunId),
        ).toHaveLength(2);
        expect(
          r.db
            .prepare(
              "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='idea_selection'",
            )
            .get()?.n,
        ).toBe(2);
      } finally {
        r.close();
      }
    } finally {
      f.close();
    }
  });
  it('serializes script replay without duplicating lineage', async () => {
    const f = contentFixture();
    try {
      const value = script(f.selected);
      expect(
        await raceContent(f.database, 'registerScript', [value, value]),
      ).toEqual([{ ok: true }, { ok: true }]);
      const r = contentStore(f.database).open();
      try {
        expect(
          r.listScriptsByPipelineRun(f.selected.pipelineRunId),
        ).toHaveLength(1);
        expect(
          r.db
            .prepare(
              "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='script'",
            )
            .get()?.n,
        ).toBe(1);
      } finally {
        r.close();
      }
    } finally {
      f.close();
    }
  });
});
