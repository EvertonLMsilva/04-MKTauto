import { CONTROLLED_FAKE_RUN_PREFIX } from '../domain/fake-execution-policy.js';

/** Public classification for consumers that must suppress outbound side effects.
 * It grants no execution authority and never assigns FAKE to legacy run IDs. */
export function isControlledFakeRun(runId: string): boolean {
  return runId.startsWith(CONTROLLED_FAKE_RUN_PREFIX);
}
