import {
  assertNewBindingAllowed,
  validateGenerationIdentity,
  validateExecutionProjection,
} from './affiliate-run-context.js';
describe('Affiliate run/context rules', () => {
  const run = {
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    state: 'RUNNING' as const,
  };
  it.each(['RUNNING', 'SUCCEEDED', 'FAILED'] as const)(
    'allows only a new RUNNING binding without prior activity: %s',
    (state) => {
      if (state === 'RUNNING')
        expect(() =>
          assertNewBindingAllowed({ ...run, state }, false),
        ).not.toThrow();
      else
        expect(() => assertNewBindingAllowed({ ...run, state }, false)).toThrow(
          'AFFILIATE_RUN_BINDING_TOO_LATE',
        );
      expect(() => assertNewBindingAllowed({ ...run, state }, true)).toThrow(
        'AFFILIATE_RUN_BINDING_TOO_LATE',
      );
    },
  );
  it('validates project version/identity without comparing against latest Project version', () => {
    expect(
      validateExecutionProjection(run, {
        project: { id: run.projectId, version: 1 },
      }),
    ).toEqual(run);
    for (const project of [
      { id: 'project_other', version: 1 },
      { id: run.projectId, version: 2 },
    ])
      expect(() => validateExecutionProjection(run, { project })).toThrow(
        'INVALID_PERSISTED_PIPELINE_RUN',
      );
  });
  it('accepts Content request identity with colon, rejects malformed identity/hash', () => {
    expect(() =>
      validateGenerationIdentity({
        generationRequestId: 'generation:001',
        contentHash: 'a'.repeat(64),
      }),
    ).not.toThrow();
    expect(() =>
      validateGenerationIdentity({
        generationRequestId: '../bad',
        contentHash: 'a'.repeat(64),
      }),
    ).toThrow('INVALID_IDENTIFIER');
    expect(() =>
      validateGenerationIdentity({
        generationRequestId: 'generation:001',
        contentHash: 'wrong',
      }),
    ).toThrow('INVALID_HASH');
  });
});
