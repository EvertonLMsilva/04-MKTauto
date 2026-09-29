import { OpenAIVoiceAdapterError } from "./openai-voice-error.js";

const HEADER_BYTES = 44;
const FORMAT_CHUNK_BYTES = 16;
const PCM_FORMAT = 1;
const CHANNELS = 1;
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = 2;
const BYTE_RATE = 48000;
const MINIMUM_AUDIO_MILLISECONDS = 100;

export function inspectMvpWav(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (bytes.length < HEADER_BYTES || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE") {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "arquivo WAV inválido");
  }
  if (bytes.readUInt32LE(4) !== bytes.length - 8) throw failure("PROVIDER_INVALID_AUDIO", "audio", "tamanho RIFF divergente");
  if (ascii(bytes, 12, 16) !== "fmt " || bytes.readUInt32LE(16) !== FORMAT_CHUNK_BYTES) {
    throw failure("PROVIDER_UNSUPPORTED_AUDIO", "audio", "estrutura WAV não suportada");
  }
  const format = bytes.readUInt16LE(20);
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const byteRate = bytes.readUInt32LE(28);
  const blockAlign = bytes.readUInt16LE(32);
  const bitsPerSample = bytes.readUInt16LE(34);
  if (format !== PCM_FORMAT || channels !== CHANNELS || sampleRate !== SAMPLE_RATE
    || byteRate !== BYTE_RATE || blockAlign !== BLOCK_ALIGN || bitsPerSample !== BITS_PER_SAMPLE) {
    throw failure("PROVIDER_UNSUPPORTED_AUDIO", "audio", "PCM WAV fora do subconjunto MVP");
  }
  if (ascii(bytes, 36, 40) !== "data") throw failure("PROVIDER_UNSUPPORTED_AUDIO", "audio", "chunks WAV não suportados");
  const dataSize = bytes.readUInt32LE(40);
  if (dataSize < BLOCK_ALIGN || dataSize % BLOCK_ALIGN !== 0 || HEADER_BYTES + dataSize !== bytes.length) {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "dados WAV inválidos");
  }
  const frames = dataSize / BLOCK_ALIGN;
  const durationMilliseconds = Math.round(frames * 1000 / SAMPLE_RATE);
  if (durationMilliseconds < MINIMUM_AUDIO_MILLISECONDS || !hasAudibleSample(bytes, HEADER_BYTES)) {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "conteúdo de áudio insuficiente");
  }
  return Object.freeze({ durationMilliseconds, audioFormat: "wav", sampleRate, channels, bitsPerSample });
}

function hasAudibleSample(bytes, offset) {
  for (let position = offset; position < bytes.length; position += BLOCK_ALIGN) if (bytes.readInt16LE(position) !== 0) return true;
  return false;
}
function ascii(bytes, start, end) { return bytes.toString("ascii", start, end); }
function failure(code, field, message, options) { return new OpenAIVoiceAdapterError(code, field, message, options); }
