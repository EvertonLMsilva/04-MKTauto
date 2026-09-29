export class OpenAIVoiceAdapterError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "OpenAIVoiceAdapterError";
    this.code = code;
    this.field = field;
  }
}
