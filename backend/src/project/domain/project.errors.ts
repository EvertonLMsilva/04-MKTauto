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
export class ProjectRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ProjectRepositoryError';
  }
}
