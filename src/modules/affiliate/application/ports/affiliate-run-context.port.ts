import type { Io } from '../affiliate-io.js';
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
// Callbacks join the owning session: synchronous by default, awaited in PG mode.
export interface AffiliateRunContextSession<A extends boolean = false> {
  readonly catalog: Pick<AffiliateRepository<A>, 'getBriefing' | 'getCampaign'>;
  readonly executions: PipelineContextReader<A>;
  readonly activity: ScriptGenerationActivityReader<A>;
  close(): Io<A, void>;
  transaction<T>(operation: () => Io<A, T>): Io<A, T>;
  bindingCommand(
    input: BindRunInput,
    key: string,
    operation: () => Io<A, RunBriefingBinding>,
  ): Io<A, RunBriefingBinding>;
  getRunBinding(id: string): Io<A, RunBriefingBinding | null>;
  insertRunBinding(binding: RunBriefingBinding): Io<A, void>;
  hasScriptContexts(id: string): Io<A, boolean>;
  getScriptContext(id: string): Io<A, ScriptGenerationContext | null>;
  insertScriptContext(context: ScriptGenerationContext): Io<A, void>;
}
export interface AffiliateRunContextFactory<A extends boolean = false> {
  open(readOnly?: boolean): Io<A, AffiliateRunContextSession<A>>;
}
export interface AffiliateRunContext<A extends boolean = false> {
  bindRun(input: unknown, key: string): Io<A, RunBriefingBinding>;
  getRunBinding(id: string): Io<A, RunBriefingBinding | null>;
  resolveRunBriefing(
    id: string,
    expectedBriefingId?: string,
  ): Io<A, AffiliateBriefing | null>;
  prepareScriptGeneration(
    request: GenerationIdentity,
    id: string,
    expectedBriefingId?: string,
  ): Io<A, AffiliateBriefing | null>;
  verifyScriptGenerationContext(
    request: GenerationIdentity,
    id: string,
    briefing: AffiliateBriefing | null,
  ): Io<A, void>;
}
