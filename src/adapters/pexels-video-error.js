export class PexelsVideoAdapterError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "PexelsVideoAdapterError";
    this.code = code;
    this.field = field;
  }
}
