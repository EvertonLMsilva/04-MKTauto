import type { AffiliateBriefing } from '../../domain/affiliate-contracts.js';
import type {
  BindRunInput,
  GenerationIdentity,
  RunBriefingBinding,
  ScriptGenerationContext,
} from '../../domain/affiliate-run-context.js';
import type { AffiliateRepository } from './affiliate-repository.port.js';
import type {
  PipelineContextReader,
  ScriptGenerationActivityReader,
} from './pipeline-context.port.js';
export const AFFILIATE_RUN_CONTEXT_FACTORY = Symbol(
  'AFFILIATE_RUN_CONTEXT_FACTORY',
);
export const AFFILIATE_RUN_CONTEXT = Symbol('AFFILIATE_RUN_CONTEXT');
// All participants use the session's connection; callbacks must stay synchronous.
export interface AffiliateRunContextSession {
  readonly catalog: Pick<AffiliateRepository, 'getBriefing' | 'getCampaign'>;
  readonly executions: PipelineContextReader;
  readonly activity: ScriptGenerationActivityReader;
  close(): void;
  transaction<T>(operation: () => T): T;
  bindingCommand(
    input: BindRunInput,
    key: string,
    operation: () => RunBriefingBinding,
  ): RunBriefingBinding;
  getRunBinding(id: string): RunBriefingBinding | null;
  insertRunBinding(binding: RunBriefingBinding): void;
  hasScriptContexts(id: string): boolean;
  getScriptContext(id: string): ScriptGenerationContext | null;
  insertScriptContext(context: ScriptGenerationContext): void;
}
export interface AffiliateRunContextFactory {
  open(readOnly?: boolean): AffiliateRunContextSession;
}
export interface AffiliateRunContext {
  bindRun(input: unknown, key: string): RunBriefingBinding;
  getRunBinding(id: string): RunBriefingBinding | null;
  resolveRunBriefing(
    id: string,
    expectedBriefingId?: string,
  ): AffiliateBriefing | null;
  prepareScriptGeneration(
    request: GenerationIdentity,
    id: string,
    expectedBriefingId?: string,
  ): AffiliateBriefing | null;
  verifyScriptGenerationContext(
    request: GenerationIdentity,
    id: string,
    briefing: AffiliateBriefing | null,
  ): void;
}
