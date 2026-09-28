export class OpenAIAdapterError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "OpenAIAdapterError";
    this.code = code;
    this.field = field;
    this.telemetry = options?.telemetry ?? null;
  }
}
