import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppModule } from '../../app.module.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { AffiliateProviderService } from '../affiliate/application/affiliate-provider.service.js';
import {
  AFFILIATE_PROVIDER_ADAPTERS,
  type AffiliateProviderAdapter,
} from '../affiliate/application/ports/affiliate-provider.port.js';
import { SHOPEE_AFFILIATE } from '../affiliate/application/ports/shopee-affiliate.port.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import { ShopeeAffiliateAdapter } from '../affiliate/infrastructure/shopee-affiliate.adapter.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-app-di-'));
  const database = join(directory, 'fixture.sqlite');
  const db = new DatabaseSync(database);
  try {
    provisionSchema(db, 44);
  } finally {
    db.close();
  }
  for (const [key, value] of Object.entries({
    PROJECT_API_DATABASE: database,
    SOCIAL_HISTORY_DATABASE: database,
    SHOPEE_AFFILIATE_MODE: 'fake',
    FAL_GENERATION_MODE: 'fake',
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_PUBLICATION_MODE: '',
    FACEBOOK_PUBLICATION_MODE: '',
    OPENAI_TTS_LIVE_ENABLED: 'false',
    DISCORD_NOTIFICATIONS_ENABLED: 'false',
    OPERATIONAL_NOTIFICATIONS_ENABLED: 'false',
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('REAL_NETWORK_FORBIDDEN');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('mktauto-affiliate-app-di-')
  )
    throw new Error('TEST_CLEANUP_BOUNDARY_INVALID');
  rmSync(directory, { recursive: true });
});

it('resolves the generic service and Shopee adapter in the actual AppModule without changing FAKE evidence semantics', async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  try {
    const service = module.get(AffiliateProviderService);
    const adapters = module.get<readonly AffiliateProviderAdapter[]>(
      AFFILIATE_PROVIDER_ADAPTERS,
    );
    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toBeInstanceOf(ShopeeAffiliateAdapter);
    expect(module.get(SHOPEE_AFFILIATE)).toBeInstanceOf(FakeShopeeAffiliate);

    const externalProductId = '9007199254740993';
    const [offer] = await service.lookupProduct('shopee', externalProductId);
    expect(offer.product.externalProductId).toBe(externalProductId);
    expect(offer.provenance.mode).toBe('FAKE');
    expect(offer.availability).toBe('UNKNOWN');
    expect(offer.linkAssociationStatus).toBe('NOT_VERIFIED');
    expect(service.mediaReferences('shopee', offer)[0].rightsStatus).toBe(
      'NOT_EVALUATED',
    );
    const link = await service.generateLink('shopee', {
      externalProductId,
      offerReference: offer.offerReference,
      originUrl: `https://shopee.com.br/product/${offer.store.externalStoreId}/${externalProductId}`,
    });
    expect(link.provenance.mode).toBe('FAKE');
    expect(link.associationVerified).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

it('exports the same generic service and adapter token to a module importing AffiliateModule', async () => {
  const consumer = Symbol('AFFILIATE_DI_CONSUMER');
  const module = await Test.createTestingModule({
    imports: [AffiliateModule],
    providers: [
      {
        provide: consumer,
        inject: [AffiliateProviderService, AFFILIATE_PROVIDER_ADAPTERS],
        useFactory: (
          service: AffiliateProviderService,
          adapters: readonly AffiliateProviderAdapter[],
        ) => ({ service, adapters }),
      },
    ],
  }).compile();
  try {
    const injected = module.get<{
      service: AffiliateProviderService;
      adapters: readonly AffiliateProviderAdapter[];
    }>(consumer);
    expect(injected.service).toBe(module.get(AffiliateProviderService));
    expect(injected.adapters).toBe(module.get(AFFILIATE_PROVIDER_ADAPTERS));
    expect(injected.service.capabilities('shopee')).toMatchObject({
      offerLookup: true,
      linkGeneration: true,
      mediaReferences: true,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});
