import { AffiliateRunContextController } from './affiliate-run-context.controller.js';
import { AffiliateRunContextService } from './application/affiliate-run-context.service.js';
import {
  AffiliateRepositoryError,
  ContractValidationError,
} from './domain/affiliate.errors.js';

describe('Affiliate run context HTTP error boundary', () => {
  for (const asynchronous of [false, true]) {
    for (const [code, status] of [
      ['AFFILIATE_RUN_BINDING_CONFLICT', 409],
      ['PIPELINE_RUN_NOT_FOUND', 404],
      ['INVALID_AFFILIATE_INPUT', 400],
      ['AFFILIATE_HASH_MISMATCH', 500],
    ] as const) {
      it(`${asynchronous ? 'Promise' : 'sync'} ${code} retains HTTP ${status}`, async () => {
        const service = Object.create(
          AffiliateRunContextService.prototype,
        ) as AffiliateRunContextService;
        vi.spyOn(service, 'inspectRun').mockImplementation(() => {
          const error = new AffiliateRepositoryError(code, 'pipelineRunId');
          if (asynchronous) return Promise.reject(error) as never;
          throw error;
        });
        const controller = new AffiliateRunContextController(service);
        try {
          await controller.getRun('run_001');
          throw new Error('Expected rejection');
        } catch (error: any) {
          expect(error.getStatus()).toBe(status);
          expect(error.getResponse()).toEqual({ code, field: 'pipelineRunId' });
        }
      });
    }
    it(`${asynchronous ? 'Promise' : 'sync'} validation and successful response`, async () => {
      const service = Object.create(
        AffiliateRunContextService.prototype,
      ) as AffiliateRunContextService;
      const spy = vi.spyOn(service, 'inspectRun').mockImplementation(() => {
        const error = new ContractValidationError(
          'INVALID_IDENTIFIER',
          'pipelineRunId',
          'invalid',
        );
        if (asynchronous) return Promise.reject(error) as never;
        throw error;
      });
      const controller = new AffiliateRunContextController(service);
      await expect(controller.getRun('bad')).rejects.toMatchObject({
        status: 400,
      });
      const response = { binding: null, briefing: null };
      spy.mockImplementation(
        () => (asynchronous ? Promise.resolve(response) : response) as never,
      );
      expect(await controller.getRun('run_001')).toEqual(response);
    });
  }
});
