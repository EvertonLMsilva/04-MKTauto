import { OperationsService } from './operations.service.js';

test('a review cannot attach another script from the same run to an execution', () => {
  const context = {
    execution: { run_id: 'run_001' },
    completed: {
      EDITORIAL: {
        script: { scriptId: 'script_001', contentHash: 'a'.repeat(64) },
      },
    },
  };
  const campaigns = { finalizationContext: () => context };
  const media = {
    get: () => ({
      pipelineRunId: 'run_001',
      scriptId: 'script_other',
      scriptContentHash: 'b'.repeat(64),
    }),
    prepareTemporalReview: vi.fn(),
  };
  const service = new OperationsService(
    campaigns as any,
    media as any,
    {} as any,
  );
  expect(() => service.reviewContext('execution_001', 'media_other')).toThrow(
    'CAMPAIGN_SCENE_MEDIA_MISMATCH',
  );
  expect(media.prepareTemporalReview).not.toHaveBeenCalled();
});
