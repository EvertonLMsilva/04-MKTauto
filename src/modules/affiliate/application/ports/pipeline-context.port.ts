import type { ExecutionContext } from '../../domain/affiliate-run-context.js';
// Read-only projections over the shared legacy schema. No lifecycle mutations.
export interface PipelineContextReader {
  getRun(id: string): ExecutionContext | null;
}
export interface ScriptGenerationActivityReader {
  hasStarted(id: string): boolean;
}
