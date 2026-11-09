import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { provisionNarrationAudio } from '../media/infrastructure/narration-plan.repository.js';

const digest = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, v) =>
        typeof v === 'bigint' ? String(v) : v,
      ),
    )
    .digest('hex');
function snapshot(db: DatabaseSync, includeRisk: boolean) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='p4_artifacts' ORDER BY name",
      )
      .all()
      .filter((row) => includeRisk || row.name !== 'tts_risk_dispatches_v2')
      .map((row) => {
        const name = String(row.name);
        return [
          name,
          digest(
            db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
          ),
        ];
      }),
  );
}
// Explicit administrative action only. No Nest startup migration or provider calls.
export async function provisionTtsReadiness(
  path: string,
  backupPath: string,
  campaignId: string,
) {
  if (
    !isAbsolute(path) ||
    !existsSync(path) ||
    !isAbsolute(backupPath) ||
    path === backupPath ||
    existsSync(backupPath)
  )
    throw Error('TTS_BACKUP_PATH_INVALID');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    if (
      ![40, 41, 42, 43, 44].includes(
        Number(db.prepare('PRAGMA user_version').get()?.user_version),
      )
    )
      throw Error('TTS_SCHEMA_VERSION_UNSUPPORTED');
    if (
      !db
        .prepare(
          'SELECT 1 FROM video_generation_campaign_budgets WHERE campaign_id=?',
        )
        .get(campaignId)
    )
      throw Error('TTS_CAMPAIGN_BUDGET_REQUIRED');
    await backup(db, backupPath);
    const saved = new DatabaseSync(backupPath, { readOnly: true });
    let before: Record<string, string>,
      p4: unknown[],
      riskExisted = false;
    try {
      if (
        saved.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok'
      )
        throw Error('TTS_BACKUP_INVALID');
      riskExisted = !!saved
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='tts_risk_dispatches_v2'",
        )
        .get();
      before = snapshot(saved, riskExisted);
      p4 = saved.prepare('SELECT * FROM p4_artifacts').all();
    } finally {
      saved.close();
    }
    db.exec('BEGIN IMMEDIATE');
    if (digest(snapshot(db, riskExisted)) !== digest(before))
      throw Error('TTS_BACKUP_SNAPSHOT_STALE');
    const sql = readFileSync(
      new URL(
        '../../../src/db/migrations/tts_risk_policy_v2.sql',
        import.meta.url,
      ),
      'utf8',
    );
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='tts_risk_dispatches_v2'",
        )
        .get()
    )
      db.exec(sql);
    const expected = new DatabaseSync(':memory:');
    try {
      expected.exec(sql);
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      for (const row of expected
        .prepare('SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL')
        .all()) {
        const actual = db
          .prepare('SELECT sql FROM sqlite_master WHERE name=?')
          .get(String(row.name));
        if (
          !actual ||
          normalize(String(actual.sql)) !== normalize(String(row.sql))
        )
          throw Error('TTS_RISK_SCHEMA_INCOMPATIBLE');
      }
    } finally {
      expected.close();
    }
    const config = provisionNarrationAudio(db, campaignId);
    if (digest(snapshot(db, riskExisted)) !== digest(before))
      throw Error('TTS_OPERATIONAL_DATA_CHANGED');
    const afterP4 = new Set(
      db
        .prepare('SELECT * FROM p4_artifacts')
        .all()
        .map((row) => digest(row)),
    );
    if (!p4.every((row) => afterP4.has(digest(row))))
      throw Error('TTS_AUDIO_HISTORY_CHANGED');
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw Error('TTS_DATABASE_INTEGRITY_FAILED');
    db.exec('COMMIT');
    return {
      backupPath,
      backupSha256: createHash('sha256')
        .update(readFileSync(backupPath))
        .digest('hex'),
      audioConfigurationId: config.id,
      protectedTablesUnchanged: true,
    };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
