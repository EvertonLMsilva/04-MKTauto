import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function wav({ durationMilliseconds = 1000, sampleRate = 24000 } = {}) {
  const frames = Math.round(sampleRate * durationMilliseconds / 1000);
  const dataSize = frames * 2;
  const value = Buffer.alloc(44 + dataSize);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4); value.write("WAVE", 8);
  value.write("fmt ", 12); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20);
  value.writeUInt16LE(1, 22); value.writeUInt32LE(sampleRate, 24);
  value.writeUInt32LE(sampleRate * 2, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write("data", 36); value.writeUInt32LE(dataSize, 40);
  for (let offset = 44; offset < value.length; offset += 2) value.writeInt16LE((offset % 400) - 200, offset);
  return value;
}

export function png({ width = 90, height = 160, color = 64 } = {}) {
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const start = row * (rowBytes + 1); raw[start] = 0; raw.fill(color, start + 1, start + rowBytes + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type); const value = Buffer.alloc(12 + data.length);
  value.writeUInt32BE(data.length, 0); name.copy(value, 4); data.copy(value, 8);
  value.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return value;
}
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
