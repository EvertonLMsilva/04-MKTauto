import type { Io } from '../affiliate-io.js';
import type { ExecutionContext } from '../../domain/affiliate-run-context.js';
// Read-only projections over the shared legacy schema. No lifecycle mutations.
export interface PipelineContextReader<A extends boolean = false> {
  getRun(id: string): Io<A, ExecutionContext | null>;
}
export interface ScriptGenerationActivityReader<A extends boolean = false> {
  hasStarted(id: string): Io<A, boolean>;
}
