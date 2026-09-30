export class FfmpegVideoAdapterError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "FfmpegVideoAdapterError";
    this.code = code;
    this.field = field;
  }
}

export function ffmpegFailure(code, field, message, options) {
  return new FfmpegVideoAdapterError(code, field, message, options);
}
