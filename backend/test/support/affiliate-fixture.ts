import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Legacy code is an oracle/provisioner in tests only; runtime never imports it.
export const legacyDomain = await import(
  new URL('../../../src/domain/affiliate-contracts.js', import.meta.url).href
);
const { PipelineRunRepository } = await import(
  new URL('../../../src/pipeline-run-repository.js', import.meta.url).href
);
const { AffiliateRepository } = await import(
  new URL('../../../src/affiliate-repository.js', import.meta.url).href
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
