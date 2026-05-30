const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC_GEO = Buffer.from('M2G1');
const MAGIC_VAR = Buffer.from('M2V2');

let cacheRootPath = null;

function getCacheRoot(userData) {
  if (!cacheRootPath) cacheRootPath = path.join(userData, 'm2-cache', 'v7');
  return cacheRootPath;
}

function hashKey(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
}

function geoFile(userData, modelPath) {
  return path.join(getCacheRoot(userData), 'geo', `${hashKey(modelPath.toLowerCase())}.bin`);
}

function varFile(userData, variantKey) {
  return path.join(getCacheRoot(userData), 'var', `${hashKey(variantKey)}.bin`);
}

function readDiskGeometry(userData, modelPath) {
  try {
    const fp = geoFile(userData, modelPath);
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    if (buf.length < 16 || !buf.subarray(0, 4).equals(MAGIC_GEO)) return null;

    const nVerts = buf.readUInt32LE(4);
    const nIdx   = buf.readUInt32LE(8);
    const texLen = buf.readUInt32LE(12);
    let off = 16;

    const posLen = nVerts * 3 * 4;
    const nrmLen = nVerts * 3 * 4;
    const uvLen  = nVerts * 2 * 4;
    const idxLen = nIdx * 4;
    if (off + posLen + nrmLen + uvLen + idxLen + texLen > buf.length) return null;

    const positions = new Float32Array(buf.buffer, buf.byteOffset + off, nVerts * 3);
    off += posLen;
    const normals = new Float32Array(buf.buffer, buf.byteOffset + off, nVerts * 3);
    off += nrmLen;
    const uvs = new Float32Array(buf.buffer, buf.byteOffset + off, nVerts * 2);
    off += uvLen;
    const indices = new Uint32Array(buf.buffer, buf.byteOffset + off, nIdx);
    off += idxLen;

    const textures = texLen > 0
      ? JSON.parse(buf.toString('utf8', off, off + texLen))
      : [];

    return {
      positions: new Float32Array(positions),
      normals:   new Float32Array(normals),
      uvs:       new Float32Array(uvs),
      indices:   new Uint32Array(indices),
      textures,
    };
  } catch {
    return null;
  }
}

function writeDiskGeometry(userData, modelPath, geo) {
  try {
    const texJson = Buffer.from(JSON.stringify(geo.textures ?? []), 'utf8');
    const nVerts = geo.positions.length / 3;
    const nIdx   = geo.indices.length;
    const header = Buffer.alloc(16);
    MAGIC_GEO.copy(header, 0);
    header.writeUInt32LE(nVerts, 4);
    header.writeUInt32LE(nIdx, 8);
    header.writeUInt32LE(texJson.length, 12);

    const body = Buffer.concat([
      Buffer.from(geo.positions.buffer, geo.positions.byteOffset, geo.positions.byteLength),
      Buffer.from(geo.normals.buffer, geo.normals.byteOffset, geo.normals.byteLength),
      Buffer.from(geo.uvs.buffer, geo.uvs.byteOffset, geo.uvs.byteLength),
      Buffer.from(geo.indices.buffer, geo.indices.byteOffset, geo.indices.byteLength),
      texJson,
    ]);

    const fp = geoFile(userData, modelPath);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.promises.writeFile(fp, Buffer.concat([header, body])).catch(() => {});
  } catch { /* cache write is best-effort */ }
}

function readDiskVariant(userData, variantKey) {
  try {
    const fp = varFile(userData, variantKey);
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    if (buf.length < 20) return null;
    const magic = buf.subarray(0, 4);
    const hasIndices = magic.equals(MAGIC_VAR);
    if (!magic.equals(MAGIC_VAR) && !magic.equals(Buffer.from('M2V1'))) return null;

    let off = 4;
    const pathLen = buf.readUInt32LE(off); off += 4;
    if (off + pathLen > buf.length) return null;
    const modelPath = buf.toString('utf8', off, off + pathLen);
    off += pathLen;

    const textureW = buf.readUInt32LE(off); off += 4;
    const textureH = buf.readUInt32LE(off); off += 4;
    const rgbaLen  = buf.readUInt32LE(off); off += 4;

    let textureRgba = null;
    if (rgbaLen > 0) {
      if (off + rgbaLen > buf.length) return null;
      textureRgba = new Uint8Array(buf.subarray(off, off + rgbaLen));
      off += rgbaLen;
    }

    let indices = null;
    if (hasIndices && off + 4 <= buf.length) {
      const idxLen = buf.readUInt32LE(off); off += 4;
      if (idxLen > 0 && off + idxLen * 4 <= buf.length) {
        indices = new Uint32Array(buf.buffer, buf.byteOffset + off, idxLen);
      }
    }

    return { modelPath, textureRgba, textureW, textureH, indices };
  } catch {
    return null;
  }
}

function writeDiskVariant(userData, variantKey, modelPath, result) {
  try {
    const pathBuf = Buffer.from(modelPath, 'utf8');
    const rgba = result.textureRgba;
    const rgbaLen = rgba?.byteLength ?? 0;
    const idx = result.indices;
    const idxLen = idx?.length ?? 0;
    const header = Buffer.alloc(16 + pathBuf.length);
    MAGIC_VAR.copy(header, 0);
    let off = 4;
    header.writeUInt32LE(pathBuf.length, off); off += 4;
    pathBuf.copy(header, off); off += pathBuf.length;
    header.writeUInt32LE(result.textureW ?? 0, off); off += 4;
    header.writeUInt32LE(result.textureH ?? 0, off); off += 4;
    header.writeUInt32LE(rgbaLen, off);

    const chunks = [header];
    if (rgbaLen > 0) {
      chunks.push(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    }
    const idxHeader = Buffer.alloc(4);
    idxHeader.writeUInt32LE(idxLen, 0);
    chunks.push(idxHeader);
    if (idxLen > 0) {
      chunks.push(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
    }

    const fp = varFile(userData, variantKey);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.promises.writeFile(fp, Buffer.concat(chunks)).catch(() => {});
  } catch { /* best-effort */ }
}

function deleteDiskVariant(userData, variantKey) {
  try {
    const fp = varFile(userData, variantKey);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* ignore */ }
}

module.exports = {
  readDiskGeometry,
  writeDiskGeometry,
  readDiskVariant,
  writeDiskVariant,
  deleteDiskVariant,
};
