import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
export function provisionProductContain(db: DatabaseSync) {
  if (!db.isTransaction) throw Error('SCHEMA_TRANSACTION_REQUIRED');
  const root = new URL('../database/migrations/', import.meta.url);
  const original = readFileSync(
    new URL('028_mixed_media_composition.sql', root),
    'utf8',
  );
  const normalize = (s: string) =>
    s
      .replace(/IF NOT EXISTS /g, '')
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .replace(/;$/, '')
      .trim();
  const expected = original.match(
    /CREATE TABLE IF NOT EXISTS composition_plan_v2_segments \([\s\S]*?\n\);/,
  )![0];
  const expanded = expected.replace(
    "framing_strategy = 'COVER_CROP_9_16'",
    "framing_strategy IN ('COVER_CROP_9_16', 'CONTAIN_9_16')",
  );
  const current = String(
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='composition_plan_v2_segments'",
      )
      .get()?.sql ?? '',
  );
  if (normalize(current) === normalize(expanded)) return;
  if (normalize(current) !== normalize(expected))
    throw Error('PRODUCT_FRAMING_SCHEMA_INCOMPATIBLE');
  const before = JSON.stringify(
    db
      .prepare(
        'SELECT * FROM composition_plan_v2_segments ORDER BY composition_plan_id,position',
      )
      .all(),
  );
  db.exec(
    readFileSync(new URL('product_contain_framing_v1.sql', root), 'utf8'),
  );
  if (
    before !==
    JSON.stringify(
      db
        .prepare(
          'SELECT * FROM composition_plan_v2_segments ORDER BY composition_plan_id,position',
        )
        .all(),
    )
  )
    throw Error('PRODUCT_FRAMING_HISTORY_CHANGED');
}
export function provisionCompositionReframing(db: DatabaseSync) {
  if (!db.isTransaction) throw Error('SCHEMA_TRANSACTION_REQUIRED');
  const root = new URL('../database/migrations/', import.meta.url);
  const original = readFileSync(
    new URL('041_campaign_orchestration.sql', root),
    'utf8',
  );
  const next = readFileSync(
    new URL('composition_reframing_v1.sql', root),
    'utf8',
  );
  const trigger = (s: string) =>
    s
      .match(/CREATE TRIGGER campaign_execution_transition[\s\S]*?END;/)![0]
      .replace(/\s+/g, ' ')
      .replace(/;$/, '')
      .trim();
  const current = String(
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='campaign_execution_transition'",
      )
      .get()?.sql ?? '',
  )
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();
  if (current === trigger(next)) return;
  if (current !== trigger(original))
    throw Error('COMPOSITION_REVISION_SCHEMA_INCOMPATIBLE');
  db.exec(next);
}
