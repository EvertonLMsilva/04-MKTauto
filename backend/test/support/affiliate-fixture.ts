import { historicalResidualPersistence } from './historical-residual-persistence.js';
import { historicalResidualContracts } from './historical-residual-contracts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fixed historical observations seed test data; no retired JS runtime is loaded.
export const legacyDomain = historicalResidualContracts('affiliate-contracts');
const { PipelineRunRepository } = historicalResidualPersistence(
  'pipeline-run-repository',
);
const { AffiliateRepository } = historicalResidualPersistence(
  'affiliate-repository',
);
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
export const product = fixtures.product as (
  overrides?: Record<string, unknown>,
) => Record<string, unknown>;
export const campaign = fixtures.campaign as (
  overrides?: Record<string, unknown>,
) => Record<string, unknown>;
export function affiliateFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-ts-'));
  const database = join(directory, 'catalog.sqlite');
  const base = new PipelineRunRepository(database);
  base.create(fixtures.project());
  const catalog = new AffiliateRepository(base);
  return {
    database,
    base,
    catalog,
    cleanup() {
      base.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
