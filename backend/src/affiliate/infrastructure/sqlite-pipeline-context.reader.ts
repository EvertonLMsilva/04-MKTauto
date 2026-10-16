import type { DatabaseSync } from 'node:sqlite';
import type {
  PipelineContextReader,
  ScriptGenerationActivityReader,
} from '../application/ports/pipeline-context.port.js';
import { validateExecutionProjection } from '../domain/affiliate-run-context.js';
import type { ExecutionContext } from '../domain/affiliate-run-context.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import { immutable } from '../domain/affiliate-contracts.js';

export class SqlitePipelineContextReader
  implements PipelineContextReader, ScriptGenerationActivityReader
{
  constructor(private readonly db: DatabaseSync) {}
  getRun(id: string): ExecutionContext | null {
    const row = this.db
      .prepare(
        'SELECT pipeline_run_id, schema_version, project_id, project_version, state, project_snapshot_json FROM pipeline_runs WHERE pipeline_run_id=?',
      )
      .get(id);
    if (!row) return null;
    try {
      if (row.schema_version !== 'pipeline-run/1.0.0')
        throw new Error('unsupported execution projection');
      return immutable(
        validateExecutionProjection(
          {
            pipelineRunId: row.pipeline_run_id as string,
            projectId: row.project_id as string,
            projectVersion: row.project_version as number,
            state: row.state as ExecutionContext['state'],
          },
          JSON.parse(row.project_snapshot_json as string),
        ),
      );
    } catch (cause) {
      throw new AffiliateRepositoryError(
        'INVALID_PERSISTED_PIPELINE_RUN',
        'pipelineRunId',
        { cause },
      );
    }
  }
  hasStarted(id: string) {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM scripts WHERE pipeline_run_id=?
      UNION ALL SELECT 1 FROM ai_call_telemetry WHERE pipeline_run_id=? AND task_type='script_generation' LIMIT 1`,
        )
        .get(id, id),
    );
  }
}
