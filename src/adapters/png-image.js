import { inflateSync } from "node:zlib";
import { OpenAIImageAdapterError } from "./openai-image-error.js";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MINIMUM_BYTES = 69;
const MAX_CHUNKS = 10000;

export function inspectMvpPng(value, expected = {}) {
  const bytes = Buffer.from(value);
  if (bytes.length < MINIMUM_BYTES || !bytes.subarray(0, 8).equals(SIGNATURE)) invalid();
  let offset = 8;
  let chunks = 0;
  let header = null;
  const compressed = [];
  let ended = false;
  while (offset < bytes.length) {
    if (chunks >= MAX_CHUNKS || offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) invalid();
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) invalid();
    if (chunks === 0 && (type !== "IHDR" || length !== 13)) invalid();
    if (type === "IHDR") {
      if (header !== null || length !== 13) invalid();
      header = parseHeader(data);
    } else if (type === "IDAT") {
      if (!header || ended || length === 0) invalid();
      compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || compressed.length === 0) invalid();
      ended = true;
      offset = end;
      break;
    }
    chunks += 1;
    offset = end;
  }
  if (!ended || offset !== bytes.length || !header) invalid();
  if (expected.widthPixels !== undefined && header.widthPixels !== expected.widthPixels) mismatch();
  if (expected.heightPixels !== undefined && header.heightPixels !== expected.heightPixels) mismatch();
  validatePixels(compressed, header);
  return Object.freeze({ format: "png", widthPixels: header.widthPixels, heightPixels: header.heightPixels, durationMilliseconds: null });
}

function parseHeader(data) {
  const widthPixels = data.readUInt32BE(0);
  const heightPixels = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  if (widthPixels < 1 || heightPixels < 1 || widthPixels > 3840 || heightPixels > 3840) invalid();
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
    throw failure("PROVIDER_UNSUPPORTED_IMAGE", "image", "PNG fora do subconjunto técnico do MVP");
  }
  return { widthPixels, heightPixels, channels: colorType === 2 ? 3 : 4 };
}
function validatePixels(parts, header) {
  const rowBytes = header.widthPixels * header.channels;
  const expectedLength = header.heightPixels * (rowBytes + 1);
  let raw;
  try { raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expectedLength + 1 }); }
  catch (caught) { throw failure("PROVIDER_INVALID_IMAGE", "image", "PNG truncado ou inválido", { cause: caught }); }
  if (raw.length !== expectedLength) invalid();
  for (let offset = 0; offset < raw.length; offset += rowBytes + 1) if (raw[offset] > 4) invalid();
}
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function invalid() { throw failure("PROVIDER_INVALID_IMAGE", "image", "PNG vazio, truncado ou estruturalmente inválido"); }
function mismatch() { throw failure("PROVIDER_IMAGE_DIMENSION_MISMATCH", "image", "dimensões físicas divergem da política"); }
function failure(code, field, message, options) { return new OpenAIImageAdapterError(code, field, message, options); }
