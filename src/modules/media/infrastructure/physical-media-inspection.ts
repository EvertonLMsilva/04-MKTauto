import { inflateSync } from 'node:zlib';
import { ffmpegFailure } from './ffmpeg-video-error.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MINIMUM_BYTES = 69;
const MAX_CHUNKS = 10000;

export function inspectMvpPng(value: any, expected: any = {}): any {
  const bytes = Buffer.from(value);
  if (bytes.length < MINIMUM_BYTES || !bytes.subarray(0, 8).equals(SIGNATURE))
    invalid();
  let offset = 8;
  let chunks = 0;
  let header: any = null;
  const compressed: any = [];
  let ended = false;
  while (offset < bytes.length) {
    if (chunks >= MAX_CHUNKS || offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) invalid();
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) invalid();
    if (chunks === 0 && (type !== 'IHDR' || length !== 13)) invalid();
    if (type === 'IHDR') {
      if (header !== null || length !== 13) invalid();
      header = parseHeader(data);
    } else if (type === 'IDAT') {
      if (!header || ended || length === 0) invalid();
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || compressed.length === 0) invalid();
      ended = true;
      offset = end;
      break;
    }
    chunks += 1;
    offset = end;
  }
  if (!ended || offset !== bytes.length || !header) invalid();
  if (
    expected.widthPixels !== undefined &&
    header.widthPixels !== expected.widthPixels
  )
    mismatch();
  if (
    expected.heightPixels !== undefined &&
    header.heightPixels !== expected.heightPixels
  )
    mismatch();
  validatePixels(compressed, header);
  return Object.freeze({
    format: 'png',
    widthPixels: header.widthPixels,
    heightPixels: header.heightPixels,
    durationMilliseconds: null,
  });
}

function parseHeader(data: any): any {
  const widthPixels = data.readUInt32BE(0);
  const heightPixels = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  if (
    widthPixels < 1 ||
    heightPixels < 1 ||
    widthPixels > 3840 ||
    heightPixels > 3840
  )
    invalid();
  if (
    bitDepth !== 8 ||
    ![2, 6].includes(colorType) ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    data[12] !== 0
  ) {
    throw failure(
      'PROVIDER_UNSUPPORTED_IMAGE',
      'image',
      'PNG fora do subconjunto técnico do MVP',
    );
  }
  return { widthPixels, heightPixels, channels: colorType === 2 ? 3 : 4 };
}
function validatePixels(parts: any, header: any): any {
  const rowBytes = header.widthPixels * header.channels;
  const expectedLength = header.heightPixels * (rowBytes + 1);
  let raw;
  try {
    raw = inflateSync(Buffer.concat(parts), {
      maxOutputLength: expectedLength + 1,
    });
  } catch (caught: any) {
    throw failure(
      'PROVIDER_INVALID_IMAGE',
      'image',
      'PNG truncado ou inválido',
      { cause: caught },
    );
  }
  if (raw.length !== expectedLength) invalid();
  for (let offset = 0; offset < raw.length; offset += rowBytes + 1)
    if (raw[offset] > 4) invalid();
}
function crc32(bytes: any): any {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(): any {
  throw failure(
    'PROVIDER_INVALID_IMAGE',
    'image',
    'PNG vazio, truncado ou estruturalmente inválido',
  );
}
function mismatch(): any {
  throw failure(
    'PROVIDER_IMAGE_DIMENSION_MISMATCH',
    'image',
    'dimensões físicas divergem da política',
  );
}
function failure(code: any, field: any, message: any, options?: any): any {
  return ffmpegFailure(code, field, message, options);
}

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
const WAV_MAX_CHUNKS = 1024;

export function inspectMvpWav(value: any): any {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (
    bytes.length < RIFF_HEADER_BYTES ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 12) !== 'WAVE'
  ) {
    throw wavFailure('PROVIDER_INVALID_AUDIO', 'audio', 'arquivo WAV inválido');
  }
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize !== STREAMING_SIZE && riffSize !== bytes.length - 8)
    throw wavFailure(
      'PROVIDER_INVALID_AUDIO',
      'audio',
      'tamanho RIFF divergente',
    );
  const { formatChunk, dataChunk } = readChunks(bytes);
  if (!formatChunk || formatChunk.size < FORMAT_CHUNK_BYTES)
    throw wavFailure(
      'PROVIDER_UNSUPPORTED_AUDIO',
      'audio',
      'estrutura WAV não suportada',
    );
  if (!dataChunk)
    throw wavFailure('PROVIDER_INVALID_AUDIO', 'audio', 'dados WAV ausentes');
  const format = bytes.readUInt16LE(formatChunk.offset);
  const channels = bytes.readUInt16LE(formatChunk.offset + 2);
  const sampleRate = bytes.readUInt32LE(formatChunk.offset + 4);
  const byteRate = bytes.readUInt32LE(formatChunk.offset + 8);
  const blockAlign = bytes.readUInt16LE(formatChunk.offset + 12);
  const bitsPerSample = bytes.readUInt16LE(formatChunk.offset + 14);
  if (
    format !== PCM_FORMAT ||
    channels !== CHANNELS ||
    sampleRate !== SAMPLE_RATE ||
    byteRate !== BYTE_RATE ||
    blockAlign !== BLOCK_ALIGN ||
    bitsPerSample !== BITS_PER_SAMPLE
  ) {
    throw wavFailure(
      'PROVIDER_UNSUPPORTED_AUDIO',
      'audio',
      'PCM WAV fora do subconjunto MVP',
    );
  }
  if (dataChunk.size < BLOCK_ALIGN || dataChunk.size % BLOCK_ALIGN !== 0) {
    throw wavFailure('PROVIDER_INVALID_AUDIO', 'audio', 'dados WAV inválidos');
  }
  const frames = dataChunk.size / BLOCK_ALIGN;
  const durationMilliseconds = Math.round((frames * 1000) / SAMPLE_RATE);
  if (
    durationMilliseconds < MINIMUM_AUDIO_MILLISECONDS ||
    !hasAudibleSample(
      bytes,
      dataChunk.offset,
      dataChunk.offset + dataChunk.size,
    )
  ) {
    throw wavFailure(
      'PROVIDER_INVALID_AUDIO',
      'audio',
      'conteúdo de áudio insuficiente',
    );
  }
  return Object.freeze({
    durationMilliseconds,
    audioFormat: 'wav',
    sampleRate,
    channels,
    bitsPerSample,
  });
}

function readChunks(bytes: any): any {
  let formatChunk: any = null;
  let dataChunk: any = null;
  let chunkCount = 0;
  let position = RIFF_HEADER_BYTES;
  while (position < bytes.length) {
    chunkCount += 1;
    if (chunkCount > WAV_MAX_CHUNKS)
      throw wavFailure(
        'PROVIDER_INVALID_AUDIO',
        'audio',
        'quantidade de chunks WAV excedida',
      );
    if (position + CHUNK_HEADER_BYTES > bytes.length)
      throw wavFailure('PROVIDER_INVALID_AUDIO', 'audio', 'chunk WAV truncado');
    const id = ascii(bytes, position, position + 4);
    if (!/^[\x20-\x7e]{4}$/.test(id))
      throw wavFailure(
        'PROVIDER_INVALID_AUDIO',
        'audio',
        'identificador de chunk WAV inválido',
      );
    const declaredSize = bytes.readUInt32LE(position + 4);
    const offset = position + CHUNK_HEADER_BYTES;
    const streaming = declaredSize === STREAMING_SIZE;
    if (streaming && id !== 'data')
      throw wavFailure(
        'PROVIDER_INVALID_AUDIO',
        'audio',
        'tamanho de streaming inválido',
      );
    const size = streaming ? bytes.length - offset : declaredSize;
    const paddedSize = size + (size % 2);
    if (offset + paddedSize > bytes.length)
      throw wavFailure('PROVIDER_INVALID_AUDIO', 'audio', 'chunk WAV truncado');
    const chunk = Object.freeze({ id, offset, size });
    if (id === 'fmt ') {
      if (formatChunk)
        throw wavFailure(
          'PROVIDER_INVALID_AUDIO',
          'audio',
          'chunk WAV duplicado',
        );
      formatChunk = chunk;
    } else if (id === 'data') {
      if (dataChunk)
        throw wavFailure(
          'PROVIDER_INVALID_AUDIO',
          'audio',
          'chunk WAV duplicado',
        );
      dataChunk = chunk;
    }
    position = offset + paddedSize;
  }
  return { formatChunk, dataChunk };
}

function hasAudibleSample(bytes: any, offset: any, end: any): any {
  for (let position = offset; position < end; position += BLOCK_ALIGN)
    if (bytes.readInt16LE(position) !== 0) return true;
  return false;
}
function ascii(bytes: any, start: any, end: any): any {
  return bytes.toString('ascii', start, end);
}
function wavFailure(code: any, field: any, message: any, options?: any): any {
  return ffmpegFailure(code, field, message, options);
}
