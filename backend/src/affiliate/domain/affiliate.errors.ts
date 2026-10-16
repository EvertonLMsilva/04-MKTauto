export class ContractValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    message: string,
  ) {
    super(`${code} em ${path}: ${message}`);
    this.name = 'ContractValidationError';
  }
}
export class AffiliateRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${field}`, options);
    this.name = 'AffiliateRepositoryError';
  }
}
