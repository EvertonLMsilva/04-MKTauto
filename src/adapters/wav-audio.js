import { OpenAIVoiceAdapterError } from "./openai-voice-error.js";

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FORMAT_CHUNK_BYTES = 16;
const STREAMING_SIZE = 0xffffffff;
const PCM_FORMAT = 1;
const CHANNELS = 1;
const SAMPLE_RATE = 24000;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = 2;
const BYTE_RATE = 48000;
const MINIMUM_AUDIO_MILLISECONDS = 100;
const MAX_CHUNKS = 1024;

export function inspectMvpWav(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (bytes.length < RIFF_HEADER_BYTES || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE") {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "arquivo WAV inválido");
  }
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize !== STREAMING_SIZE && riffSize !== bytes.length - 8) throw failure("PROVIDER_INVALID_AUDIO", "audio", "tamanho RIFF divergente");
  const { formatChunk, dataChunk } = readChunks(bytes);
  if (!formatChunk || formatChunk.size < FORMAT_CHUNK_BYTES) throw failure("PROVIDER_UNSUPPORTED_AUDIO", "audio", "estrutura WAV não suportada");
  if (!dataChunk) throw failure("PROVIDER_INVALID_AUDIO", "audio", "dados WAV ausentes");
  const format = bytes.readUInt16LE(formatChunk.offset);
  const channels = bytes.readUInt16LE(formatChunk.offset + 2);
  const sampleRate = bytes.readUInt32LE(formatChunk.offset + 4);
  const byteRate = bytes.readUInt32LE(formatChunk.offset + 8);
  const blockAlign = bytes.readUInt16LE(formatChunk.offset + 12);
  const bitsPerSample = bytes.readUInt16LE(formatChunk.offset + 14);
  if (format !== PCM_FORMAT || channels !== CHANNELS || sampleRate !== SAMPLE_RATE
    || byteRate !== BYTE_RATE || blockAlign !== BLOCK_ALIGN || bitsPerSample !== BITS_PER_SAMPLE) {
    throw failure("PROVIDER_UNSUPPORTED_AUDIO", "audio", "PCM WAV fora do subconjunto MVP");
  }
  if (dataChunk.size < BLOCK_ALIGN || dataChunk.size % BLOCK_ALIGN !== 0) {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "dados WAV inválidos");
  }
  const frames = dataChunk.size / BLOCK_ALIGN;
  const durationMilliseconds = Math.round(frames * 1000 / SAMPLE_RATE);
  if (durationMilliseconds < MINIMUM_AUDIO_MILLISECONDS || !hasAudibleSample(bytes, dataChunk.offset, dataChunk.offset + dataChunk.size)) {
    throw failure("PROVIDER_INVALID_AUDIO", "audio", "conteúdo de áudio insuficiente");
  }
  return Object.freeze({ durationMilliseconds, audioFormat: "wav", sampleRate, channels, bitsPerSample });
}

function readChunks(bytes) {
  let formatChunk = null;
  let dataChunk = null;
  let chunkCount = 0;
  let position = RIFF_HEADER_BYTES;
  while (position < bytes.length) {
    chunkCount += 1;
    if (chunkCount > MAX_CHUNKS) throw failure("PROVIDER_INVALID_AUDIO", "audio", "quantidade de chunks WAV excedida");
    if (position + CHUNK_HEADER_BYTES > bytes.length) throw failure("PROVIDER_INVALID_AUDIO", "audio", "chunk WAV truncado");
    const id = ascii(bytes, position, position + 4);
    if (!/^[\x20-\x7e]{4}$/.test(id)) throw failure("PROVIDER_INVALID_AUDIO", "audio", "identificador de chunk WAV inválido");
    const declaredSize = bytes.readUInt32LE(position + 4);
    const offset = position + CHUNK_HEADER_BYTES;
    const streaming = declaredSize === STREAMING_SIZE;
    if (streaming && id !== "data") throw failure("PROVIDER_INVALID_AUDIO", "audio", "tamanho de streaming inválido");
    const size = streaming ? bytes.length - offset : declaredSize;
    const paddedSize = size + (size % 2);
    if (offset + paddedSize > bytes.length) throw failure("PROVIDER_INVALID_AUDIO", "audio", "chunk WAV truncado");
    const chunk = Object.freeze({ id, offset, size });
    if (id === "fmt ") {
      if (formatChunk) throw failure("PROVIDER_INVALID_AUDIO", "audio", "chunk WAV duplicado");
      formatChunk = chunk;
    } else if (id === "data") {
      if (dataChunk) throw failure("PROVIDER_INVALID_AUDIO", "audio", "chunk WAV duplicado");
      dataChunk = chunk;
    }
    position = offset + paddedSize;
  }
  return { formatChunk, dataChunk };
}

function hasAudibleSample(bytes, offset, end) {
  for (let position = offset; position < end; position += BLOCK_ALIGN) if (bytes.readInt16LE(position) !== 0) return true;
  return false;
}
function ascii(bytes, start, end) { return bytes.toString("ascii", start, end); }
function failure(code, field, message, options) { return new OpenAIVoiceAdapterError(code, field, message, options); }
