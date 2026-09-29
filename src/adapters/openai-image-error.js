export class OpenAIImageAdapterError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "OpenAIImageAdapterError";
    this.code = code;
    this.field = field;
  }
}
