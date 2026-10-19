import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { NarrationPlanRepository } from '../media/infrastructure/narration-plan.repository.js';
import { ttsRiskFixture } from '../../test/support/tts-risk-fixture.js';
import { provisionTtsReadiness } from './tts-readiness.js';

it('does not create an empty database when an operational path is wrong', async () => {
  const f = ttsRiskFixture();
  try {
    const absent = join(dirname(f.database), 'wrong-database.sqlite');
    await expect(
      provisionTtsReadiness(
        absent,
        join(dirname(f.database), 'wrong-backup.sqlite'),
        'camp_001',
      ),
    ).rejects.toThrow();
    expect(existsSync(absent)).toBe(false);
    const other = join(dirname(f.database), 'wrong-preparation.sqlite');
    expect(() =>
      new NarrationPlanRepository(other).prepare({} as any, true),
    ).toThrow();
    expect(existsSync(other)).toBe(false);
  } finally {
    f.close();
  }
});

it('backs up the complete SQLite and idempotently provisions TTS without changing Finance or history', async () => {
  const f = ttsRiskFixture();
  try {
    f.db.exec('DROP TABLE tts_risk_dispatches_v2');
    const before = f.db.prepare('SELECT * FROM cost_events').all(),
      version = f.db.prepare('PRAGMA user_version').get();
    const first = await provisionTtsReadiness(
      f.database,
      join(dirname(f.database), 'before.sqlite'),
      'camp_001',
    );
    const backupDb = new DatabaseSync(first.backupPath, { readOnly: true });
    try {
      expect(
        backupDb
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='tts_risk_dispatches_v2'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        backupDb.prepare('PRAGMA integrity_check').get()?.integrity_check,
      ).toBe('ok');
    } finally {
      backupDb.close();
    }
    const count = f.db
      .prepare("SELECT count(*) n FROM p4_artifacts WHERE kind='audio_config'")
      .get()?.n;
    const second = await provisionTtsReadiness(
      f.database,
      join(dirname(f.database), 'replay.sqlite'),
      'camp_001',
    );
    expect(second.audioConfigurationId).toBe(first.audioConfigurationId);
    expect(
      f.db
        .prepare(
          "SELECT count(*) n FROM p4_artifacts WHERE kind='audio_config'",
        )
        .get()?.n,
    ).toBe(count);
    expect(f.db.prepare('SELECT * FROM cost_events').all()).toEqual(before);
    expect(f.db.prepare('PRAGMA user_version').get()).toEqual(version);
    await expect(
      provisionTtsReadiness(f.database, first.backupPath, 'camp_001'),
    ).rejects.toThrow('TTS_BACKUP_PATH_INVALID');
  } finally {
    f.close();
  }
});
