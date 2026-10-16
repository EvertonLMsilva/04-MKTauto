import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import { SqlitePipelineContextReader } from './sqlite-pipeline-context.reader.js';
import { immutable } from '../domain/affiliate-contracts.js';
import type {
  BindRunInput,
  RunBriefingBinding,
  ScriptGenerationContext,
} from '../domain/affiliate-run-context.js';
import type { AffiliateRunContextSession } from '../application/ports/affiliate-run-context.port.js';

export class SqliteAffiliateRunContextRepository
  extends SqliteAffiliateRepository
  implements AffiliateRunContextSession
{
  readonly catalog = this;
  readonly executions: SqlitePipelineContextReader;
  readonly activity: SqlitePipelineContextReader;
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    super(path, options);
    this.executions = new SqlitePipelineContextReader(this.db);
    this.activity = this.executions;
  }
  bindingCommand(
    input: BindRunInput,
    key: string,
    operation: () => RunBriefingBinding,
  ) {
    return this.command('BIND_RUN', input, key, operation);
  }
  getRunBinding(id: string): RunBriefingBinding | null {
    const row = this.db
      .prepare('SELECT * FROM affiliate_run_bindings WHERE pipeline_run_id=?')
      .get(id);
    return row
      ? immutable({
          pipelineRunId: id,
          briefingId: row.briefing_id as string,
          briefingHash: row.briefing_hash as string,
          campaignId: row.campaign_id as string,
          campaignRevision: row.campaign_revision as number,
          productId: row.product_id as string,
          productRevision: row.product_revision as number,
        })
      : null;
  }
  insertRunBinding(binding: RunBriefingBinding) {
    this.db
      .prepare('INSERT INTO affiliate_run_bindings VALUES (?,?,?,?,?,?,?)')
      .run(
        binding.pipelineRunId,
        binding.briefingId,
        binding.briefingHash,
        binding.campaignId,
        binding.campaignRevision,
        binding.productId,
        binding.productRevision,
      );
  }
  hasScriptContexts(id: string) {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM affiliate_script_contexts WHERE pipeline_run_id=? LIMIT 1',
        )
        .get(id),
    );
  }
  getScriptContext(id: string): ScriptGenerationContext | null {
    const row = this.db
      .prepare(
        'SELECT * FROM affiliate_script_contexts WHERE generation_request_id=?',
      )
      .get(id);
    return row
      ? immutable({
          generationRequestId: id,
          requestHash: row.request_hash as string,
          pipelineRunId: row.pipeline_run_id as string,
          briefingHash: row.briefing_hash as string | null,
        })
      : null;
  }
  insertScriptContext(context: ScriptGenerationContext) {
    this.db
      .prepare('INSERT INTO affiliate_script_contexts VALUES (?,?,?,?)')
      .run(
        context.generationRequestId,
        context.requestHash,
        context.pipelineRunId,
        context.briefingHash,
      );
  }
}
