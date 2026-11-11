import { historicalResidualContracts } from '../../../test/support/historical-residual-contracts.js';
import { fixture } from '../../../test/support/composition-plan-fixture.js';
import { raceMedia } from '../../../test/support/media-concurrency.js';
import { CompositionPlanRepository } from './infrastructure/composition-plan.reader.js';
import {
  compositionPlanContentHash,
  compositionPlanIdentityHash,
} from './domain/composition-plan-contracts.js';
const contracts = historicalResidualContracts('composition-plan-contracts');

function changed(value: any, changes: any) {
  const v = { ...value, ...changes };
  v.contentHash = compositionPlanContentHash(v);
  return v;
}
function outcome(action: () => unknown) {
  try {
    return action();
  } catch (e: any) {
    return { code: e.code, field: e.field ?? e.path };
  }
}
describe('CompositionPlan public Media persistence JS/TS parity', () => {
  it.each([false, true])(
    'registers, replays, lists and reopens V2=%s',
    (mixed) => {
      const f = fixture(mixed),
        g = fixture(mixed);
      try {
        expect(compositionPlanContentHash(f.value)).toBe(
          contracts.compositionPlanContentHash(f.value),
        );
        expect(compositionPlanIdentityHash(f.value)).toBe(
          contracts.compositionPlanIdentityHash(f.value),
        );
        expect(f.media.registerCompositionPlan(f.value)).toEqual(
          g.repository.registerCompositionPlan(g.value),
        );
        expect(f.media.registerCompositionPlan(f.value)).toEqual(
          g.repository.registerCompositionPlan(g.value),
        );
        expect(f.media.getCompositionPlan(f.value.compositionPlanId)).toEqual(
          f.value,
        );
        expect(
          f.media.listCompositionPlansByPipelineRun(f.value.pipelineRunId),
        ).toEqual([f.value]);
        expect(f.media.listCompositionPlansByScript(f.value.scriptId)).toEqual([
          f.value,
        ]);
        expect(f.media.getCompositionPlan('composition_missing')).toBeNull();
        const r = new CompositionPlanRepository(
          f.path,
          { get: (id) => f.repository.getRun(id) },
          { getScript: () => f.script },
          { readOnly: true },
        );
        try {
          expect(r.getCompositionPlan(f.value.compositionPlanId)).toEqual(
            f.value,
          );
          expect(r.getArtifact(f.value.compositionPlanId)).toEqual(
            g.repository.getArtifact(g.value.compositionPlanId),
          );
        } finally {
          r.close();
        }
      } finally {
        f.close();
        g.close();
      }
    },
  );
  it.each([false, true])(
    'rejects scope, hash, duration, revisions and conflicting replay V2=%s',
    (mixed) => {
      const f = fixture(mixed),
        g = fixture(mixed);
      try {
        for (const [changes, code] of [
          [{ projectVersion: 2 }, 'COMPOSITION_PLAN_RUN_SCOPE_MISMATCH'],
          [
            { scriptContentHash: 'f'.repeat(64) },
            'SCRIPT_CONTENT_HASH_MISMATCH',
          ],
          [
            { voiceTrackContentHash: 'f'.repeat(64) },
            'VOICE_TRACK_CONTENT_HASH_MISMATCH',
          ],
          [{ outputAspectRatio: '1:1' }, 'OUTPUT_ASPECT_RATIO_MISMATCH'],
          [
            {
              durationMilliseconds: 10001,
              segments: f.value.segments.map((s: any, i: number) => ({
                ...s,
                endMilliseconds: i ? 10001 : s.endMilliseconds,
              })),
            },
            'VOICE_TRACK_DURATION_MISMATCH',
          ],
          [
            {
              segments: f.value.segments.map((s: any, i: number) => ({
                ...s,
                startMilliseconds: i ? 3000 : 0,
                endMilliseconds: i ? 10000 : 3000,
              })),
            },
            'MEDIA_DURATION_INSUFFICIENT',
          ],
          [
            { revision: 2, supersedesCompositionPlanId: 'composition_missing' },
            'SUPERSEDED_COMPOSITION_PLAN_NOT_FOUND',
          ],
          [
            {
              segments: f.value.segments.map((s: any, i: number) => ({
                ...s,
                mediaAssetContentHash: i
                  ? s.mediaAssetContentHash
                  : 'f'.repeat(64),
              })),
            },
            'MEDIA_ASSET_CONTENT_HASH_MISMATCH',
          ],
        ] as const) {
          const value = changed(f.value, changes);
          const ts = outcome(() => f.media.registerCompositionPlan(value));
          expect(ts).toEqual(
            outcome(() => g.repository.registerCompositionPlan(value)),
          );
          expect(ts).toMatchObject({ code });
        }
        f.media.registerCompositionPlan(f.value);
        g.repository.registerCompositionPlan(g.value);
        for (const changes of [
          { createdAt: '2026-09-29T00:00:00.000Z' },
          { compositionPlanId: 'composition_other' },
        ]) {
          expect(
            outcome(() =>
              f.media.registerCompositionPlan(changed(f.value, changes)),
            ),
          ).toEqual(
            outcome(() =>
              g.repository.registerCompositionPlan(changed(g.value, changes)),
            ),
          );
        }
        const next = changed(f.value, {
          compositionPlanId: 'composition_next',
          revision: 2,
          supersedesCompositionPlanId: f.value.compositionPlanId,
        });
        expect(f.media.registerCompositionPlan(next)).toEqual(
          g.repository.registerCompositionPlan(next),
        );
        expect(
          f.media.listCompositionPlansByScript(f.value.scriptId),
        ).toHaveLength(2);
      } finally {
        f.close();
        g.close();
      }
    },
  );
  it('preserves V2 trim/loop policy and requires the mixed production profile', () => {
    const f = fixture(true),
      g = fixture(true),
      h = fixture(false);
    try {
      for (const playbackMode of ['TRIM', 'LOOP']) {
        const value = changed(f.value, {
          segments: f.value.segments.map((s: any, i: number) =>
            i ? { ...s, sourceStartMilliseconds: 3000, playbackMode } : s,
          ),
        });
        expect(outcome(() => f.media.registerCompositionPlan(value))).toEqual(
          outcome(() => g.repository.registerCompositionPlan(value)),
        );
      }
      expect(
        outcome(() => h.media.registerCompositionPlan(f.value)),
      ).toMatchObject({ code: 'PRODUCTION_PROFILE_MISMATCH' });
    } finally {
      f.close();
      g.close();
      h.close();
    }
  });
  it.each([false, true])(
    'revalidates media/voice rights and rolls back after a segment write failure V2=%s',
    (mixed) => {
      const f = fixture(mixed);
      const r = new CompositionPlanRepository(
        f.path,
        { get: (id) => f.repository.getRun(id) },
        { getScript: () => f.script },
      );
      try {
        const get = r.getMediaAsset.bind(r);
        r.getMediaAsset = (id) => ({
          ...get(id)!,
          rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
        });
        expect(outcome(() => r.registerCompositionPlan(f.value))).toMatchObject(
          { code: 'COMMERCIAL_USE_REQUIRED' },
        );
        r.getMediaAsset = get;
        const originalPrepare = r.db.prepare.bind(r.db);
        r.db.prepare = (sql: string) => {
          const statement = originalPrepare(sql);
          if (sql === 'SELECT * FROM voice_tracks WHERE voice_track_id = ?') {
            const getVoice = statement.get.bind(statement);
            statement.get = (...args: any[]) => {
              const row = getVoice(...args)!;
              const voice = JSON.parse(String(row.payload_json));
              voice.rights.commercialUseAllowed = false;
              return {
                ...row,
                commercial_use_allowed: 0,
                payload_json: JSON.stringify(voice),
              };
            };
          }
          return statement;
        };
        expect(outcome(() => r.registerCompositionPlan(f.value))).toMatchObject(
          { code: 'INVALID_PERSISTED_VOICE_TRACK', field: 'voiceTrackId' },
        );
        r.db.prepare = originalPrepare;
        const segmentsTable = mixed
          ? 'composition_plan_v2_segments'
          : 'composition_plan_segments';
        r.db.exec(
          `CREATE TRIGGER reject_plan_segment BEFORE INSERT ON ${segmentsTable} BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END;`,
        );
        expect(() => r.registerCompositionPlan(f.value)).toThrow();
        for (const table of [
          'composition_plans',
          'composition_plan_v2_details',
          'composition_plan_v2_segments',
        ])
          expect(r.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n).toBe(
            0,
          );
        expect(r.getArtifact(f.value.compositionPlanId)).toBeNull();
        expect(r.db.isTransaction).toBe(false);
        r.db.exec('DROP TRIGGER reject_plan_segment;');
        expect(r.registerCompositionPlan(f.value)).toEqual(f.value);
      } finally {
        r.close();
        f.close();
      }
    },
  );
  it.each([false, true])(
    'serializes concurrent replay and conflicting revision V2=%s',
    async (mixed) => {
      const f = fixture(mixed);
      try {
        const run = f.repository.getRun(f.value.pipelineRunId);
        const replays = await raceMedia(
          f.path,
          'registerCompositionPlan',
          [f.value, f.value],
          f.script,
          { run },
        );
        expect(replays).toEqual([{ ok: true }, { ok: true }]);
        const next = changed(f.value, {
          compositionPlanId: 'composition_next',
          revision: 2,
          supersedesCompositionPlanId: f.value.compositionPlanId,
        });
        const results = await raceMedia(
          f.path,
          'registerCompositionPlan',
          [next, changed(next, { compositionPlanId: 'composition_rival' })],
          f.script,
          { run },
        );
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.find((r) => !r.ok)?.code).toMatch(
          /COMPOSITION_PLAN_(REVISION_CONFLICT|ALREADY_SUPERSEDED)/,
        );
        expect(
          f.media.listCompositionPlansByScript(f.value.scriptId),
        ).toHaveLength(2);
      } finally {
        f.close();
      }
    },
  );
  it.each([false, true])(
    'rejects corrupted segments and lineage on reads V2=%s',
    (mixed) => {
      const f = fixture(mixed);
      try {
        f.media.registerCompositionPlan(f.value);
        const r = new CompositionPlanRepository(
          f.path,
          { get: (id) => f.repository.getRun(id) },
          { getScript: () => f.script },
        );
        try {
          const getArtifact = r.getArtifact.bind(r);
          r.getArtifact = (id) =>
            id === f.value.compositionPlanId ? null : getArtifact(id);
          expect(
            outcome(() => r.getCompositionPlan(f.value.compositionPlanId)),
          ).toMatchObject({ code: 'INVALID_PERSISTED_COMPOSITION_PLAN' });
          r.getArtifact = getArtifact;
          const prepare = r.db.prepare.bind(r.db);
          r.db.prepare = (sql: string) => {
            const stmt = prepare(sql);
            if (
              sql.includes(
                `FROM ${mixed ? 'composition_plan_v2_segments' : 'composition_plan_segments'} WHERE`,
              )
            )
              stmt.all = () => [];
            return stmt;
          };
          expect(
            outcome(() => r.getCompositionPlan(f.value.compositionPlanId)),
          ).toMatchObject({ code: 'INVALID_PERSISTED_COMPOSITION_PLAN' });
        } finally {
          r.close();
        }
      } finally {
        f.close();
      }
    },
  );
});
