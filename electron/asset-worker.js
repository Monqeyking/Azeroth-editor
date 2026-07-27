const { parentPort, workerData } = require('worker_threads');
const mpqReader = require('./mpq-reader');

// Decoder comes from main.js so worker and main always use identical BLP rules.
eval(workerData.decoderSource);

function chunkMap(buf) {
  const chunks = new Map();
  for (let off = 0; off + 8 <= buf.length;) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const data = off + 8;
    if (data + size > buf.length) break;
    chunks.set(id, { data, size });
    off = data + size;
  }
  return chunks;
}

function stringAt(buf, start, size, offset) {
  if (offset < 0 || offset >= size) return null;
  const from = start + offset;
  const end = buf.indexOf(0, from);
  return buf.toString('utf8', from, end < 0 ? start + size : end).replace(/\//g, '\\');
}

function parseAdtPlacements(buf) {
  const chunks = chunkMap(buf);
  const names = (listId, idsId) => {
    const list = chunks.get(listId), ids = chunks.get(idsId);
    if (!list || !ids) return [];
    const out = [];
    for (let off = 0; off + 4 <= ids.size; off += 4) out.push(stringAt(buf, list.data, list.size, buf.readUInt32LE(ids.data + off)));
    return out;
  };
  const m2Names = names('XDMM', 'DIMM');
  const wmoNames = names('OMWM', 'DIWM');
  const read = (chunkId, stride, paths, type) => {
    const chunk = chunks.get(chunkId);
    if (!chunk) return [];
    const out = [];
    for (let off = 0; off + stride <= chunk.size; off += stride) {
      const p = chunk.data + off, nameId = buf.readUInt32LE(p);
      const path = paths[nameId];
      if (!path) continue;
      out.push({
        type, path, uniqueId: buf.readUInt32LE(p + 4),
        position: [buf.readFloatLE(p + 8), buf.readFloatLE(p + 12), buf.readFloatLE(p + 16)],
        rotation: [buf.readFloatLE(p + 20), buf.readFloatLE(p + 24), buf.readFloatLE(p + 28)],
        scale: type === 'm2' ? buf.readUInt16LE(p + 32) / 1024 : buf.readUInt16LE(p + 62) / 1024,
      });
    }
    return out;
  };
  return { m2: read('FDDM', 36, m2Names, 'm2'), wmo: read('FDOM', 64, wmoNames, 'wmo') };
}

parentPort.on('message', async ({ id, type, payload }) => {
  try {
    if (type === 'decodeBlps') {
      const { dataPath, entries } = payload;
      const decoded = await Promise.all(entries.map(async ({ textureIdx, path }) => {
        try {
          const buffer = await mpqReader.readBlpFromMpqs(dataPath, path);
          if (!buffer) return { textureIdx, missing: true };
          const { rgba, w, h } = decodeBLP(Buffer.from(buffer));
          return { textureIdx, data: new Uint8Array(rgba), w, h };
        } catch (_) {
          return { textureIdx, missing: true };
        }
      }));
      parentPort.postMessage({ id, result: decoded }, decoded.filter(row => row.data).map(row => row.data.buffer));
      return;
    }

    if (type === 'decodeFirstBlp') {
      const { dataPath, paths } = payload;
      for (const blpPath of paths) {
        try {
          const buffer = await mpqReader.readBlpFromMpqs(dataPath, blpPath);
          if (!buffer || buffer.toString('ascii', 0, 4) !== 'BLP2') continue;
          const { rgba, w, h } = decodeBLP(Buffer.from(buffer));
          const data = new Uint8Array(rgba);
          parentPort.postMessage({ id, result: { data, w, h, blpPath } }, [data.buffer]);
          return;
        } catch (_) { /* Try the next candidate. */ }
      }
      parentPort.postMessage({ id, result: null });
      return;
    }

    if (type === 'readPlacements') {
      const { dataPath, mapName, tiles } = payload;
      const result = [];
      for (const { tileX, tileY } of tiles) {
        const buffer = await mpqReader.readAdtBuffer(dataPath, mapName, tileY, tileX);
        if (buffer) result.push({ tileX, tileY, ...parseAdtPlacements(Buffer.from(buffer)) });
      }
      parentPort.postMessage({ id, result });
      return;
    }

    throw new Error(`Unknown asset task: ${type}`);
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
