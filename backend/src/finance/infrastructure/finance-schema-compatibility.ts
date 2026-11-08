// Explicit versions only. Adjustments were introduced in 40; 39 remains readable.
export const FINANCE_SCHEMA_VERSIONS: readonly number[] = [39, 40, 41, 42, 43];
export function supportsFinancialAdjustments(version: number): boolean {
  return version >= 40 && FINANCE_SCHEMA_VERSIONS.includes(version);
}
