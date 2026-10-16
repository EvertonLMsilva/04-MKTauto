import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CsvDiscoveryConfig } from '../../src/affiliate/infrastructure/csv-discovery-source.js';

// Captured from passing JS/TS CSV and historical-row comparisons. These are
// data fixtures, not replacements for enumeration, persistence or ranking.
export const historicalDiscovery = JSON.parse(
  readFileSync(
    new URL('./frozen-discovery-persistence.json', import.meta.url),
    'utf8',
  ),
);

// The scope wire format includes the temporary absolute filename. Assemble the
// expected protocol fields independently; never call the implementation tested.
export function csvScope(c: CsvDiscoveryConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: c.provider,
        sourcePath: c.sourcePath,
        columns: Object.entries(c.columns).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
        delimiter: c.delimiter,
        maxRecordChars: c.maxRecordChars,
        sourceUpdatedAt: c.sourceUpdatedAt ?? null,
        discovery: c.discovery,
      }),
    )
    .digest('hex');
}
export function configuredScope(
  feeds: { feedId: string; scope: string }[],
): string {
  // The historical hash spreads its input into an object, including array
  // indices. Preserve that wire identity rather than changing the contract.
  const indexed = Object.fromEntries(
    feeds.map((f, index) => [
      String(index),
      {
        feedId: f.feedId,
        scope: f.scope,
      },
    ]),
  );
  return createHash('sha256').update(JSON.stringify(indexed)).digest('hex');
}
