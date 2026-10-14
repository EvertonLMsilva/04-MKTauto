export class ArtifactLineageRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'ArtifactLineageRepositoryError';
    this.code = code;
    this.field = field;
  }
}
