import { validateAffiliateCampaignSource } from '../../src/modules/affiliate/domain/affiliate-campaign-source.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { provisionSchema } from '../../src/infrastructure/administration/schema-provisioner.js';
import { SqliteProjectRepository } from '../../src/modules/project/infrastructure/sqlite-project.repository.js';
const examples = await import(
  new URL('../affiliate-fixtures.js', import.meta.url).href
);
export const product = examples.product as (
  overrides?: Record<string, unknown>,
) => any;
export const campaign = examples.campaign as (
  overrides?: Record<string, unknown>,
) => any;
export const project = examples.project as () => any;
export const at = '2026-10-11T12:00:00.000Z';
export function sqliteAffiliateFixture() {
  const parent = realpathSync(tmpdir()),
    directory = mkdtempSync(join(parent, 'mktauto-pg-affiliate-')),
    path = join(directory, 'affiliate.sqlite');
  const provision = new DatabaseSync(path);
  try {
    provisionSchema(provision, 43);
  } finally {
    provision.close();
  }
  const catalog = new SqliteProjectRepository(path);
  try {
    catalog.create(project(), { createdAt: at });
  } finally {
    catalog.close();
  }
  return {
    path,
    cleanup() {
      const resolved = realpathSync(directory);
      if (
        dirname(resolved) !== parent ||
        !basename(resolved).startsWith('mktauto-pg-affiliate-')
      )
        throw new Error('Unsafe SQLite fixture boundary');
      rmSync(resolved, { recursive: true, force: false });
    },
  };
}
export async function failure(operation: () => unknown) {
  try {
    await operation();
    throw new Error('Expected failure');
  } catch (error: any) {
    if (!error.code) throw error;
    return {
      name: error.name,
      code: error.code,
      field: error.field,
      message: error.message,
    };
  }
}
export function source(
  p = product(),
  c = campaign({ affiliateUrl: 'https://s.shopee.com.br/fixture_001' }),
) {
  return validateAffiliateCampaignSource({
    schemaVersion: 'affiliate-campaign-source/1.0.0',
    sourceId: 'source_001',
    revision: 1,
    source: 'SHOPEE_AFFILIATE_API',
    offer: {
      offerId: 'offer_11',
      productId: '11',
      shopId: '7',
      provenance: {
        source: 'FAKE',
        fixtureVersion: 'affiliate-pg-fixture/1',
        observedAt: null,
      },
    },
    productId: p.productId,
    productRevision: p.revision,
    campaignId: c.campaignId,
    campaignRevision: c.revision,
    briefingId: null,
    affiliateUrl: c.affiliateUrl,
  });
}
