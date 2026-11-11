import { runAffiliateIo } from '../application/affiliate-io.js';
import type { AffiliateSession } from './affiliate-sql.js';
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
  constructor(
    path: string | AffiliateSession,
    options: {
      readOnly?: boolean;
    } = {},
  ) {
    super(path, options);
    this.executions = (this.session?.executions ??
      new SqlitePipelineContextReader(this.db)) as SqlitePipelineContextReader;
    this.activity = (this.session?.activity ??
      this.executions) as SqlitePipelineContextReader;
  }
  bindingCommand(
    input: BindRunInput,
    key: string,
    operation: () => RunBriefingBinding,
  ) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.command('BIND_RUN', input, key, operation);
      }.call(this),
    );
  }
  getRunBinding(id: string): RunBriefingBinding | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield this.sql
          .prepare(
            'SELECT * FROM affiliate_run_bindings WHERE pipeline_run_id=?',
          )
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
      }.call(this),
    );
  }
  insertRunBinding(binding: RunBriefingBinding) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.sql
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
      }.call(this),
    );
  }
  hasScriptContexts(id: string) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        return Boolean(
          yield this.sql
            .prepare(
              'SELECT 1 FROM affiliate_script_contexts WHERE pipeline_run_id=? LIMIT 1',
            )
            .get(id),
        );
      }.call(this),
    );
  }
  getScriptContext(id: string): ScriptGenerationContext | null {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield this.sql
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
      }.call(this),
    );
  }
  insertScriptContext(context: ScriptGenerationContext) {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.sql
          .prepare('INSERT INTO affiliate_script_contexts VALUES (?,?,?,?)')
          .run(
            context.generationRequestId,
            context.requestHash,
            context.pipelineRunId,
            context.briefingHash,
          );
      }.call(this),
    );
  }
}
