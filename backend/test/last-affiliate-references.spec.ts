import { readFileSync } from 'node:fs';

it('keeps the publishing E2E independent from the retired Affiliate runtime', () => {
  const source = readFileSync(
    new URL('./publishing.e2e-spec.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toContain('../../src/affiliate-repository.js');
});
