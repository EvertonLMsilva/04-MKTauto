import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { OperationsService } from './operations.service.js';
import { OperationsController } from './operations.controller.js';
import { LocalQcGuard } from '../publishing/application/local-qc.guard.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';

test('dynamic configuration route requires the existing authenticated/CSRF Operations guard', () => {
  expect(
    Reflect.getMetadata(
      GUARDS_METADATA,
      OperationsController.prototype.startDynamicCatalog,
    ),
  ).toContain(LocalQcGuard);
  expect(
    Reflect.getMetadata(
      GUARDS_METADATA,
      Object.getOwnPropertyDescriptor(
        OperationsController.prototype,
        'reviewShopeeLiveAuthorization',
      )!.value,
    ),
  ).toContain(LocalQcGuard);
});

test('only authenticated Operations can preview or confirm a LIVE grant', async () => {
  const campaigns = {
    reviewLiveAuthorization: vi.fn(async () => ({ scopeHash: 'reviewed' })),
  };
  const service = new OperationsService(campaigns as any, {} as any, {} as any);
  await expect(
    service.reviewShopeeLiveAuthorization({ confirmed: true }, undefined),
  ).rejects.toThrow();
  expect(campaigns.reviewLiveAuthorization).not.toHaveBeenCalled();
  const active = vi
    .spyOn(operationalQcIdentity, 'assertActive')
    .mockReturnValue({ id: 'operator_001' } as any);
  try {
    await service.reviewShopeeLiveAuthorization({ confirmed: false }, {});
    expect(campaigns.reviewLiveAuthorization).toHaveBeenCalledExactlyOnceWith(
      { confirmed: false },
      'operator_001',
    );
  } finally {
    active.mockRestore();
  }
});
test('unauthenticated callers cannot configure or run acquisition; authenticated requests delegate once', async () => {
  const campaigns = {
    startDynamicCatalog: vi.fn(async () => ({ ready: true })),
  };
  const service = new OperationsService(campaigns as any, {} as any, {} as any);
  await expect(
    service.startDynamicCatalog({ request: {}, configuration: {} }, undefined),
  ).rejects.toThrow();
  expect(campaigns.startDynamicCatalog).not.toHaveBeenCalled();
  const active = vi
    .spyOn(operationalQcIdentity, 'assertActive')
    .mockReturnValue({ id: 'operator_001' } as any);
  try {
    await expect(
      service.startDynamicCatalog(
        { request: {}, configuration: {}, credentials: 'forbidden' },
        {},
      ),
    ).rejects.toThrow('SHOPEE_DYNAMIC_INPUT_INVALID');
    await service.startDynamicCatalog(
      {
        request: { campaignId: 'camp_001' },
        configuration: { projectId: 'project_001' },
      },
      {},
    );
    expect(campaigns.startDynamicCatalog).toHaveBeenCalledExactlyOnceWith(
      { campaignId: 'camp_001' },
      { projectId: 'project_001' },
      'operator_001',
    );
  } finally {
    active.mockRestore();
  }
});
