export class VoiceProvider {
  async synthesize(_input, _options = {}) {
    throw new Error("VoiceProvider.synthesize não implementado");
  }
}
