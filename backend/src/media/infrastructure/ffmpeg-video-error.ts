export class FfmpegVideoAdapterError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'FfmpegVideoAdapterError';
  }
}
export function ffmpegFailure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
) {
  return new FfmpegVideoAdapterError(code, field, message, options);
}
