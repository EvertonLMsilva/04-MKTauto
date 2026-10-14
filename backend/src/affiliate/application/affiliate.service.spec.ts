import { AffiliateService } from './affiliate.service.js';
import {
  affiliateFixture,
  campaign,
  product,
} from '../../../test/support/affiliate-fixture.js';
import { SqliteAffiliateRepository } from '../infrastructure/sqlite-affiliate.repository.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';

describe('Affiliate application', () => {
  it('uses public Project reader; exact replay does not re-read Project', async () => {
    const fixture = affiliateFixture();
    const get = vi.fn(async (id: string) => fixture.base.get(id));
    const service = new AffiliateService(
      {
        open: (readOnly = false) =>
          new SqliteAffiliateRepository(fixture.database, { readOnly }),
      },
      { get } as ProjectSnapshotReader,
    );
    try {
      await service.registerProduct({
        idempotencyKey: 'product_one',
        product: product(),
      });
      const command = { idempotencyKey: 'campaign_one', campaign: campaign() };
      const first = await service.registerCampaign(command);
      expect(get).toHaveBeenCalledExactlyOnceWith('project_001');
      get.mockRejectedValueOnce(new Error('private operational failure'));
      expect(await service.registerCampaign(command)).toEqual(first);
      expect(get).toHaveBeenCalledTimes(1);
      await expect(service.getCampaign('camp_001', 1)).rejects.toThrow(
        'private operational failure',
      );
    } finally {
      fixture.cleanup();
    }
  });
  it('rejects command envelopes before opening persistence', async () => {
    const open = vi.fn();
    const service = new AffiliateService({ open }, { get: vi.fn() });
    await expect(
      service.registerProduct({
        product: product(),
        idempotencyKey: 'key',
        unexpected: true,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_AFFILIATE_INPUT',
      field: 'input',
    });
    await expect(
      service.registerProduct({ product: product(), idempotencyKey: '../bad' }),
    ).rejects.toMatchObject({
      code: 'INVALID_AFFILIATE_IDENTIFIER',
      path: 'idempotencyKey',
    });
    expect(open).not.toHaveBeenCalled();
  });
});
