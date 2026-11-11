import type {
  PipelineContextReader,
  ScriptGenerationActivityReader,
} from '../application/ports/pipeline-context.port.js';
/** Internal SQL boundary, interpreted only by shared repository algorithms. */
export interface AffiliateSql {
  prepare(sql: string): {
    get(...values: any[]): any;
    all(...values: any[]): any;
    run(...values: any[]): any;
  };
}
export interface AffiliateSession {
  readonly sql: AffiliateSql;
  readonly executions: PipelineContextReader | PipelineContextReader<true>;
  readonly activity:
    ScriptGenerationActivityReader | ScriptGenerationActivityReader<true>;
  transaction<T>(work: () => T): any;
  close(): void;
}
