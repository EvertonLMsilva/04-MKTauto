import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from './schema-provisioner.js';
import { provisionProductContain } from './composition-reframing.js';
test('contain extension preserves historical rows, constraints and immutability', () => {
  const db = new DatabaseSync(':memory:');
  provisionSchema(db, 40);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    const insert = (id: string, framing: string) =>
      db
        .prepare(
          'INSERT INTO composition_plan_v2_segments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          1,
          1,
          'media_fixture',
          'a'.repeat(64),
          'VIDEO',
          0,
          1000,
          0,
          'TRIM',
          1,
          framing,
          'composition-transition/1.0.0',
          'CUT',
          0,
        );
    insert('plan_old', 'COVER_CROP_9_16');
    const before = db
      .prepare('SELECT * FROM composition_plan_v2_segments')
      .all();
    for (let i = 0; i < 2; i++) {
      db.exec('BEGIN IMMEDIATE');
      provisionProductContain(db);
      db.exec('COMMIT');
    }
    expect(
      db.prepare('SELECT * FROM composition_plan_v2_segments').all(),
    ).toEqual(before);
    insert('plan_contain', 'CONTAIN_9_16');
    expect(() => insert('plan_invalid', 'STRETCH')).toThrow();
    expect(() => db.exec('DELETE FROM composition_plan_v2_segments')).toThrow(
      'IMMUTABLE_COMPOSITION_PLAN_V2_SEGMENT',
    );
    expect(() =>
      db.exec('UPDATE composition_plan_v2_segments SET original_audio_muted=0'),
    ).toThrow('IMMUTABLE_COMPOSITION_PLAN_V2_SEGMENT');
  } finally {
    db.close();
  }
});
