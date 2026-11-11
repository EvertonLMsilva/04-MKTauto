import { DatabaseSync } from 'node:sqlite';
import { SqlitePipelineContextReader } from './sqlite-pipeline-context.reader.js';
describe('read-only Content activity projection', () => {
  it('detects a persisted script, restricts telemetry to script_generation, and scopes run identity', () => {
    // Minimal query fixture; full-schema transaction behavior is tested separately.
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        'CREATE TABLE scripts(pipeline_run_id TEXT); CREATE TABLE ai_call_telemetry(pipeline_run_id TEXT, task_type TEXT);',
      );
      const reader = new SqlitePipelineContextReader(db);
      expect(reader.hasStarted('run_001')).toBe(false);
      db.prepare('INSERT INTO scripts VALUES (?)').run('run_other');
      db.prepare('INSERT INTO ai_call_telemetry VALUES (?,?)').run(
        'run_001',
        'voice_generation',
      );
      expect(reader.hasStarted('run_001')).toBe(false);
      db.prepare('INSERT INTO ai_call_telemetry VALUES (?,?)').run(
        'run_001',
        'script_generation',
      );
      expect(reader.hasStarted('run_001')).toBe(true);
      expect(reader.hasStarted('run_other')).toBe(true);
    } finally {
      db.close();
    }
  });
});
