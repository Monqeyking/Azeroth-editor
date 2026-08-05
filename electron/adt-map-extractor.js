const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRID = 128;
const CELLS = 16;
const MAP_IDS = { kalimdor: 1, azeroth: 0, easternkingdoms: 0, outland: 530, northrend: 571 };

function chunkType(buf, offset) {
  const direct = buf.toString('ascii', offset, offset + 4);
  const reverse = direct.split('').reverse().join('');
  return direct === 'MCIN' || direct === 'MCNK' || direct === 'MCVT' || direct === 'MCLQ' || direct === 'MH2O' ? direct : reverse;
}

function topChunks(buf) {
  const result = [];
  for (let offset = 0; offset + 8 <= buf.length;) {
    const size = buf.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buf.length) break;
    result.push({ type: chunkType(buf, offset), offset, size });
    offset = end;
  }
  return result;
}

function firstChunk(chunks, type) { return chunks.find(chunk => chunk.type === type) || null; }
function chunkData(buf, chunk) { return chunk ? buf.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.size) : null; }

function writeAreaSection(areaIds) {
  const area = Buffer.alloc(8);
  area.write('AREA', 0, 4, 'ascii');
  const first = areaIds[0];
  const full = areaIds.some(value => value !== first);
  area.writeUInt16LE(full ? 0 : 1, 4);
  area.writeUInt16LE(full ? 0 : first, 6);
  if (!full) return { buffer: area, full: false };
  const values = Buffer.alloc(CELLS * CELLS * 2);
  areaIds.forEach((value, index) => values.writeUInt16LE(value, index * 2));
  return { buffer: Buffer.concat([area, values]), full: true };
}

function writeHeightSection(v8, v9, minHeight, maxHeight) {
  const header = Buffer.alloc(16);
  header.write('MHGT', 0, 4, 'ascii');
  let flags = 0;
  const difference = maxHeight - minHeight;
  if (difference === 0 || difference < 0.005) flags |= 0x0001;
  let mode = 'float';
  if (!(flags & 0x0001)) {
    if (difference < 2) { flags |= 0x0004; mode = 'uint8'; }
    else if (difference < 2048) { flags |= 0x0002; mode = 'uint16'; }
  }
  header.writeUInt32LE(flags, 4);
  header.writeFloatLE(minHeight, 8);
  header.writeFloatLE(maxHeight, 12);
  if (flags & 0x0001) return { buffer: header, flags, mode };

  const factor = mode === 'uint8' ? 255 / difference : mode === 'uint16' ? 65535 / difference : 0;
  const bytesPerValue = mode === 'uint8' ? 1 : mode === 'uint16' ? 2 : 4;
  const values = Buffer.alloc((129 * 129 + 128 * 128) * bytesPerValue);
  let offset = 0;
  const write = value => {
    if (mode === 'uint8') values.writeUInt8(Math.max(0, Math.min(255, Math.round((value - minHeight) * factor))), offset++);
    else if (mode === 'uint16') { values.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((value - minHeight) * factor))), offset); offset += 2; }
    else { values.writeFloatLE(value, offset); offset += 4; }
  };
  v9.forEach(write);
  v8.forEach(write);
  return { buffer: Buffer.concat([header, values]), flags, mode };
}

function liquidFlagsForSoundBank(soundBank) {
  return soundBank === 1 ? 0x02 : soundBank === 2 ? 0x04 : soundBank === 3 ? 0x08 : 0x01;
}

function writeLiquidSection(buf, chunks, liquidSoundBanks = {}) {
  const mh2o = firstChunk(chunks, 'MH2O');
  if (!mh2o) return { buffer: Buffer.alloc(0), present: false, warnings: [] };
  const data = chunkData(buf, mh2o);
  const entries = new Uint16Array(256);
  const flags = new Uint8Array(256);
  const show = new Uint8Array(128 * 128);
  const heights = new Float32Array(129 * 129);
  const warnings = [];
  for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
    const index = i * CELLS + j;
    const headerOffset = index * 12;
    if (headerOffset + 12 > data.length) continue;
    const instanceOffset = data.readUInt32LE(headerOffset), used = data.readUInt32LE(headerOffset + 4);
    if (!used || !instanceOffset || instanceOffset + 24 > data.length) continue;
    const p = instanceOffset;
    const originalType = data.readUInt16LE(p), format = data.readUInt16LE(p + 2);
    const offsetX = data.readUInt8(p + 12), offsetY = data.readUInt8(p + 13), width = data.readUInt8(p + 14), height = data.readUInt8(p + 15);
    const existsOffset = data.readUInt32LE(p + 16), vertexOffset = data.readUInt32LE(p + 20);
    const liquidType = format === 2 ? 2 : originalType;
    const soundBank = liquidSoundBanks[liquidType] ?? (liquidType === 2 ? 1 : 0);
    entries[index] = liquidType;
    flags[index] = liquidFlagsForSoundBank(soundBank);
    let exists = existsOffset ? data.readBigUInt64LE(existsOffset) : 0xffffffffffffffffn;
    const values = (format === 0 || format === 1) && vertexOffset ? vertexOffset : null;
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      const gx = j * 8 + offsetX + x, gy = i * 8 + offsetY + y;
      if (gx < 0 || gx > 128 || gy < 0 || gy > 128) continue;
      const pos = y * (width + 1) + x;
      const value = values != null && values + pos * 4 + 4 <= data.length ? data.readFloatLE(values + pos * 4) : 0;
      heights[gy * 129 + gx] = value;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const bit = y * width + x;
      if (bit >= 64) { warnings.push(`MH2O exists bitmap exceeds 64 bits in cell ${index}`); continue; }
      if ((exists >> BigInt(bit)) & 1n) {
        const gx = j * 8 + offsetX + x, gy = i * 8 + offsetY + y;
        if (gx >= 0 && gx < 128 && gy >= 0 && gy < 128) show[gy * 128 + gx] = 1;
      }
    }
  }
  let minX = 255, minY = 255, maxX = 0, maxY = 0, minHeight = 20000, maxHeight = -20000, shown = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (show[y * 128 + x]) { shown++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); const h = heights[y * 129 + x]; minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h); }
    else {
      heights[y * 129 + x] = -500;
      minHeight = Math.min(minHeight, -500);
    }
  }
  if (!shown) return { buffer: Buffer.alloc(0), present: false, warnings };
  const firstType = entries[0], firstFlag = flags[0];
  const fullType = entries.some((value, index) => value !== firstType || flags[index] !== firstFlag);
  const width = maxX - minX + 2, height = maxY - minY + 2;
  const header = Buffer.alloc(16);
  header.write('MLIQ', 0, 4, 'ascii');
  let headerFlags = 0;
  if (!fullType) headerFlags |= 0x0001;
  if (maxHeight === minHeight || maxHeight - minHeight < 0.001) headerFlags |= 0x0002;
  header.writeUInt8(headerFlags, 4);
  header.writeUInt8(fullType ? 0 : firstFlag, 5);
  header.writeUInt16LE(fullType ? 0 : firstType, 6);
  header.writeUInt8(minX, 8); header.writeUInt8(minY, 9); header.writeUInt8(width, 10); header.writeUInt8(height, 11);
  header.writeFloatLE(minHeight, 12);
  const parts = [header];
  if (fullType) {
    const typeBuffer = Buffer.alloc(512), flagBuffer = Buffer.from(flags);
    entries.forEach((value, index) => typeBuffer.writeUInt16LE(value, index * 2));
    parts.push(typeBuffer, flagBuffer);
  }
  if (!(headerFlags & 0x0002)) {
    const heightBuffer = Buffer.alloc(width * height * 4);
    let offset = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { heightBuffer.writeFloatLE(heights[(minY + y) * 129 + minX + x], offset); offset += 4; }
    parts.push(heightBuffer);
  }
  return { buffer: Buffer.concat(parts), present: true, warnings, liquidTypes: [...new Set(entries)].filter(Boolean), shown };
}

function extractAdtMapTile({ adtPath, outputRoot, mapName, tileX, tileY, mapId = null, build = 12340 }) {
  if (!fs.existsSync(adtPath)) throw new Error(`ADT file not found: ${adtPath}`);
  const buf = fs.readFileSync(adtPath);
  const chunks = topChunks(buf);
  const mcin = firstChunk(chunks, 'MCIN');
  if (!mcin) throw new Error('ADT does not contain an MCIN chunk.');
  const mcinData = chunkData(buf, mcin);
  const areaIds = new Array(CELLS * CELLS).fill(0);
  const holes = new Array(CELLS * CELLS).fill(0);
  const v9 = new Array(129 * 129).fill(0);
  const v8 = new Array(128 * 128).fill(0);
  const warnings = [];

  for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
    const index = i * CELLS + j;
    const entry = index * 16;
    if (entry + 16 > mcinData.length) { warnings.push(`Missing MCIN entry ${index}`); continue; }
    const mcnkOffset = mcinData.readUInt32LE(entry);
    if (!mcnkOffset || mcnkOffset + 8 > buf.length || chunkType(buf, mcnkOffset) !== 'MCNK') { warnings.push(`Missing MCNK ${index}`); continue; }
    const payload = mcnkOffset + 8;
    const size = buf.readUInt32LE(mcnkOffset + 4);
    if (payload + size > buf.length || payload + 124 > buf.length) { warnings.push(`Invalid MCNK ${index}`); continue; }
    areaIds[index] = buf.readUInt32LE(payload + 52) & 0xffff;
    holes[index] = buf.readUInt16LE(payload + 60);
    const baseZ = buf.readFloatLE(payload + 112);
    const mcvtOffset = buf.readUInt32LE(payload + 20);
    for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) v9[(i * 8 + y) * 129 + j * 8 + x] = baseZ;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) v8[(i * 8 + y) * 128 + j * 8 + x] = baseZ;
    if (!mcvtOffset) continue;
    const mcvt = mcnkOffset + mcvtOffset + 8;
    if (mcvt + 145 * 4 > buf.length) { warnings.push(`Invalid MCVT ${index}`); continue; }
    for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) v9[(i * 8 + y) * 129 + j * 8 + x] += buf.readFloatLE(mcvt + (y * 17 + x) * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) v8[(i * 8 + y) * 128 + j * 8 + x] += buf.readFloatLE(mcvt + (y * 17 + 9 + x) * 4);
  }

  const allHeights = [...v8, ...v9].filter(Number.isFinite);
  const minHeight = Math.min(...allHeights);
  const maxHeight = Math.max(...allHeights);
  const areaSection = writeAreaSection(areaIds);
  const heightSection = writeHeightSection(v8, v9, minHeight, maxHeight);
  const liquidSection = writeLiquidSection(buf, chunks);
  const holesPresent = holes.some(value => value !== 0);
  const areaOffset = 44;
  const heightOffset = areaOffset + areaSection.buffer.length;
  const liquidOffset = liquidSection.present ? heightOffset + heightSection.buffer.length : 0;
  const holesOffset = holesPresent ? (liquidSection.present ? liquidOffset + liquidSection.buffer.length : heightOffset + heightSection.buffer.length) : 0;
  const header = Buffer.alloc(44);
  header.write('MAPS', 0, 4, 'ascii');
  header.writeUInt32LE(9, 4);
  header.writeUInt32LE(build, 8);
  header.writeUInt32LE(areaOffset, 12);
  header.writeUInt32LE(areaSection.buffer.length, 16);
  header.writeUInt32LE(heightOffset, 20);
  header.writeUInt32LE(heightSection.buffer.length, 24);
  header.writeUInt32LE(liquidOffset, 28);
  header.writeUInt32LE(liquidSection.present ? liquidSection.buffer.length : 0, 32);
  header.writeUInt32LE(holesOffset, 36);
  header.writeUInt32LE(holesPresent ? 512 : 0, 40);
  const holeBuffer = Buffer.alloc(512);
  holes.forEach((value, index) => holeBuffer.writeUInt16LE(value, index * 2));
  const explicitMapId = mapId == null || mapId === '' ? null : Number(mapId);
  const outputMapId = Number.isInteger(explicitMapId) ? explicitMapId : MAP_IDS[String(mapName).toLowerCase()];
  if (!Number.isInteger(outputMapId)) throw new Error(`No map ID known for ${mapName}.`);
  const fileName = `${String(outputMapId).padStart(3, '0')}${String(tileY).padStart(2, '0')}${String(tileX).padStart(2, '0')}.map`;
  const outputPath = path.join(outputRoot, 'maps', fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = Buffer.concat([header, areaSection.buffer, heightSection.buffer, liquidSection.present ? liquidSection.buffer : Buffer.alloc(0), holesPresent ? holeBuffer : Buffer.alloc(0)]);
  fs.writeFileSync(outputPath, output);
  return { outputPath, bytes: output.length, sha256: crypto.createHash('sha256').update(output).digest('hex'), mapId: outputMapId, tileX, tileY, minHeight, maxHeight, areaIds: [...new Set(areaIds)], holes: holesPresent, liquid: liquidSection.present, liquidTypes: liquidSection.liquidTypes || [], warnings: [...warnings, ...liquidSection.warnings] };
}

module.exports = { extractAdtMapTile };
