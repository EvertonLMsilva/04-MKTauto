import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  AffiliateBriefing,
  AffiliateCampaign,
} from '../../affiliate/domain/affiliate-contracts.js';
// Wire rows are validated against the historical contracts before use. Every
// reader is synchronous and bound to the Finance session's SQLite connection.
export interface FinancialDatabase {
  exec(sql: string): void;
  close(): void;
  readonly isTransaction: boolean;
  prepare(sql: string): {
    get(...values: SQLInputValue[]): any;
    all(...values: SQLInputValue[]): any[];
    run(
      ...values: SQLInputValue[]
    ): ReturnType<ReturnType<DatabaseSync['prepare']>['run']>;
  };
}
export interface VideoFinancialCommitmentsReader {
  hasActive(): boolean;
  listActive(campaignId?: string): { generation_request_id: string }[];
  getOperation(id: string): any;
}
export interface TtsFinancialCommitmentsReader {
  exists(): boolean;
  hasOperations(): boolean;
  list(campaignId?: string): { operation_id: string }[];
  getTts(id: string): any;
}
export interface TtsFinancialSourceReader {
  audioConfiguration(id: string): unknown;
  videoSource(
    id: string,
  ): { state: string; requestHash: string; request: any; result: any } | null;
}
export interface FinancialAttributionReader {
  costEvents(
    provider: string,
    inputHash: string,
    occurredAt: string | null,
  ): { cost_event_id: string }[];
}
export interface CampaignReferenceReader {
  resolveRunBriefing(id: string): AffiliateBriefing | null;
  getCampaign(id: string, revision: number): AffiliateCampaign | null;
  listRuns(id: string): { pipeline_run_id: string }[];
}
