const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { decodeBLP } = require('./blp-codec');
const m2DiskCache = require('./m2-disk-cache');
const { runM2Load } = require('./m2-load-queue');
const {
  parseSkinFile, resolveVisibleGeosets, buildGeosetDebugInfo, buildIndicesFromSkin,
  parseCharHairGeosets, parseFacialHairGeosets, parseCreatureDisplayInfoExtra,
} = require('./m2-geoset');

let m2Deps = {};
function getMpqReader() { return m2Deps.getMpqReader(); }
function runM2AssetWorker(type, payload) { return m2Deps.runM2AssetWorker(type, payload); }

function buildSubmeshIndexRanges(skin, visibleIndices) {
  const ranges = new Map();
  let start = 0;
  for (let i = 0; i < skin.submeshes.length; i++) {
    if (!visibleIndices.has(i)) continue;
    const count = skin.submeshes[i].indexCount;
    ranges.set(i, { start, count });
    start += count;
  }
  return ranges;
}

function modelNeedsCreatureTexture(geo) {
  if (!geo?.textures?.length) return false;
  return geo.textures.some(t => {
    if (t.type >= 11 && t.type <= 13) return true;
    if (t.type === 0 && t.filename && !/PARTICLE|REFLECT|ENVIRON|GLOW|SPARKLE/i.test(t.filename))
      return true;
    return false;
  });
}

function variantHasTexture(result) {
  return !!(result?.textureRgba && result.textureW > 0 && result.textureH > 0);
}

function isCompleteVariant(result, geo) {
  if (!result) return false;
  if (!modelNeedsCreatureTexture(geo)) return true;
  return variantHasTexture(result);
}

function tryLoadM2VariantFromDisk(userData, variantKey, modelPath) {
  const diskVar = m2DiskCache.readDiskVariant(userData, variantKey);
  if (!diskVar || diskVar.modelPath !== modelPath || !diskVar.indices?.length) return null;

  let geo = m2GeometryCache.get(modelPath);
  if (!geo) return null;

  const result = {
    positions: geo.positions,
    normals:   geo.normals,
    uvs:       geo.uvs,
    indices:   new Uint32Array(diskVar.indices),
    textureRgba: diskVar.textureRgba,
    textureW:    diskVar.textureW,
    textureH:    diskVar.textureH,
    modelPath,
    texturePath: null,
  };

  if (!isCompleteVariant(result, geo)) {
    m2DiskCache.deleteDiskVariant(userData, variantKey);
    return null;
  }
  return result;
}

function getM2DataPath() { return m2Deps.getM2DataPath(); }

// DBC helpers
function parseDBC(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'WDBC') return null;
  const numRecords   = buf.readUInt32LE(4);
  const recordSize   = buf.readUInt32LE(12);
  const strBlockSize = buf.readUInt32LE(16);
  const dataStart    = 20;
  const strStart     = dataStart + numRecords * recordSize;
  return { buf, numRecords, recordSize, strBlockSize, dataStart, strStart };
}

function dbcStr(dbc, offset, corr = 1) {
  if (!offset) return '';
  const pos = dbc.strStart + offset - corr;
  if (pos < dbc.strStart || pos >= dbc.buf.length) return '';
  let end = pos;
  while (end < dbc.buf.length && dbc.buf[end] !== 0) end++;
  return dbc.buf.toString('utf8', pos, end);
}

function dbcStrCdi(dbc, offset) {
  if (!offset) return '';
  const a = dbcStr(dbc, offset, 0);
  const b = dbcStr(dbc, offset, 1);
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

// DBC index: Map<id, recordOffset>
function dbcBuildIndex(dbc) {
  const map = new Map();
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    map.set(dbc.buf.readUInt32LE(off), off);
  }
  return map;
}

// Module-level caches
let m2DbcCachePromise = null;
let m2DbcCachePath    = null;
const m2ModelCache     = new Map(); // displayId ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ result|null
const m2VariantCache   = new Map(); // modelPath|texVars ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ result
const m2GeometryCache  = new Map(); // modelPath ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ { positions, normals, uvs, textures, skin }
const m2SkinCache      = new Map(); // modelPath ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ parsed .skin
let blpTextureCache = new Map(); // blpPath (lower) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ { textureRgba, textureW, textureH }
const m2VariantInflight  = new Map(); // variantKey ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ Promise<result|null>
const m2DisplayInflight  = new Map(); // displayId ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ Promise<result|null>

function getBlpTextureCacheStats() {
  let rgbaBytes = 0;
  let pngBase64Chars = 0;
  for (const entry of blpTextureCache.values()) {
    rgbaBytes += entry?.textureRgba?.byteLength || 0;
    pngBase64Chars += entry?.pngBase64?.length || 0;
  }
  return {
    entries: blpTextureCache.size,
    rgbaBytes,
    pngBase64Chars,
    estimatedBytes: rgbaBytes + pngBase64Chars,
  };
}

function getM2DbcData(dataPath) {
  if (m2DbcCachePath === dataPath && m2DbcCachePromise) return m2DbcCachePromise;

  m2DbcCachePath    = dataPath;
  m2DbcCachePromise = (async () => {
    const reader = getMpqReader();
    async function readDbc(name) {
      const buf = await reader.readFileFromMpqs(dataPath, `DBFilesClient\\${name}`);
      return buf ? parseDBC(buf) : null;
    }

    const [cdiDbc, cmdDbc, cdieDbc, hairDbc, facialDbc, charSectionsDbc, chrRacesDbc] = await Promise.all([
      readDbc('CreatureDisplayInfo.dbc'),
      readDbc('CreatureModelData.dbc'),
      readDbc('CreatureDisplayInfoExtra.dbc'),
      readDbc('CharHairGeosets.dbc'),
      readDbc('CharacterFacialHairStyles.dbc'),
      readDbc('CharSections.dbc'),
      readDbc('ChrRaces.dbc'),
    ]);

    const displayInfo = new Map();
    const modelData   = new Map();

    if (cdiDbc) {
      for (const [id, off] of dbcBuildIndex(cdiDbc)) {
        displayInfo.set(id, {
          modelId:  cdiDbc.buf.readUInt32LE(off + 4),
          extendedDisplayInfoId: cdiDbc.buf.readUInt32LE(off + 12),
          creatureGeosetData: cdiDbc.buf.readUInt32LE(off + 60),
          texVar1:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 24)),
          texVar2:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 28)),
          texVar3:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 32)),
        });
      }
    }

    if (cmdDbc) {
      for (const [id, off] of dbcBuildIndex(cmdDbc)) {
        modelData.set(id, {
          modelPath: dbcStr(cmdDbc, cmdDbc.buf.readUInt32LE(off + 8), 0),
        });
      }
    }

    const charModelPaths = new Map();
    if (chrRacesDbc) {
      for (const [raceId, off] of dbcBuildIndex(chrRacesDbc)) {
        const pathForDisplay = (displayId) => {
          const display = displayInfo.get(displayId);
          return display ? modelData.get(display.modelId)?.modelPath || null : null;
        };
        charModelPaths.set(raceId, [
          pathForDisplay(chrRacesDbc.buf.readUInt32LE(off + 16)),
          pathForDisplay(chrRacesDbc.buf.readUInt32LE(off + 20)),
        ]);
      }
    }
    return {
      dataPath, displayInfo, modelData,
      cdieDbc, charModelPaths, charHair: parseCharHairGeosets(hairDbc), facialHair: parseFacialHairGeosets(facialDbc),
      charSections: parseCharSections(charSectionsDbc),
    };
  })();

  return m2DbcCachePromise;
}

function parseM2(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'MD20') return null;

  const nAnimations = buf.readUInt32LE(0x1C);
  const ofsAnimations = buf.readUInt32LE(0x20);
  const nGlobalSequences = buf.readUInt32LE(0x14);
  const ofsGlobalSequences = buf.readUInt32LE(0x18);
  const nBoneLookup = buf.readUInt32LE(0x78);
  const ofsBoneLookup = buf.readUInt32LE(0x7C);
  const nVertices   = buf.readUInt32LE(0x3C);
  const ofsVertices = buf.readUInt32LE(0x40);
  const nTextures   = buf.readUInt32LE(0x50);
  const ofsTextures = buf.readUInt32LE(0x54);
  const nRenderFlags = buf.readUInt32LE(0x70);
  const ofsRenderFlags = buf.readUInt32LE(0x74);
  const nTexLookup  = buf.readUInt32LE(0x80);
  const ofsTexLookup = buf.readUInt32LE(0x84);
  const nTexUnitLookup = buf.length >= 0x90 ? buf.readUInt32LE(0x88) : 0;
  const ofsTexUnitLookup = buf.length >= 0x90 ? buf.readUInt32LE(0x8C) : 0;

  const positions = [], normals = [], uvs = [], uvs2 = [];
  const positionsM2 = [], normalsM2 = [], boneIndices = [], boneWeights = [];

  for (let i = 0; i < nVertices; i++) {
    const v = ofsVertices + i * 48;
    const px = buf.readFloatLE(v),      py = buf.readFloatLE(v + 4),  pz = buf.readFloatLE(v + 8);
    const nx = buf.readFloatLE(v + 20), ny = buf.readFloatLE(v + 24), nz = buf.readFloatLE(v + 28);
    const u  = buf.readFloatLE(v + 32), vv = buf.readFloatLE(v + 36);
    const u2 = buf.readFloatLE(v + 40), vv2 = buf.readFloatLE(v + 44);
    positionsM2.push(px, py, pz);
    normalsM2.push(nx, ny, nz);
    for (let j = 0; j < 4; j++) {
      boneWeights.push(buf[v + 12 + j] / 255);
      boneIndices.push(buf[v + 16 + j]);
    }
 // M2 -> Three.js: match the handedness used by the authored Glue camera.
    positions.push(-py, pz, -px);
    normals.push(-ny, nz, -nx);
    uvs.push(u, vv);
    uvs2.push(u2, vv2);
  }

  const textures = [];
  for (let i = 0; i < nTextures; i++) {
    const t    = ofsTextures + i * 16;
    const type = buf.readUInt32LE(t);
    const nFn  = buf.readUInt32LE(t + 8);
    const oFn  = buf.readUInt32LE(t + 12);
    let filename = '';
    if (nFn > 0 && oFn > 0 && oFn + nFn <= buf.length) {
      let end = oFn;
      while (end < buf.length && buf[end] !== 0) end++;
      filename = buf.toString('ascii', oFn, end).replace(/\//g, '\\');
    }
    textures.push({ type, filename });
  }

  // Glue scenes use the legacy WotLK light-array placement used by these UI models. Keep the
  // standard-layout fallback for other M2s, but only accept a bounded, in-file record table.
  const readTrackFirst = (recordOffset, trackOffset, kind) => {
    const track = recordOffset + trackOffset;
    if (track < 0 || track + 20 > buf.length) return null;
    const sequenceCount = buf.readUInt32LE(track + 12);
    const sequenceOffset = buf.readUInt32LE(track + 16);
    if (!sequenceCount || !sequenceOffset || sequenceOffset + 8 > buf.length) return null;
    const keyCount = buf.readUInt32LE(sequenceOffset);
    const keyOffset = buf.readUInt32LE(sequenceOffset + 4);
    if (!keyCount || !keyOffset || keyOffset >= buf.length) return null;
    if (kind === 'u8') return buf[keyOffset];
    if (kind === 'float') return keyOffset + 4 <= buf.length ? buf.readFloatLE(keyOffset) : null;
    if (kind === 'vec3') {
      return keyOffset + 12 <= buf.length
        ? [buf.readFloatLE(keyOffset), buf.readFloatLE(keyOffset + 4), buf.readFloatLE(keyOffset + 8)]
        : null;
    }
    return null;
  };
  const lightHeaders = [
    { countOffset: 0x118, offsetOffset: 0x11C },
    { countOffset: 0x11C, offsetOffset: 0x120 },
  ];
  const lightHeader = lightHeaders.find(({ countOffset, offsetOffset }) => {
    const count = buf.length >= countOffset + 4 ? buf.readUInt32LE(countOffset) : 0;
    const offset = buf.length >= offsetOffset + 4 ? buf.readUInt32LE(offsetOffset) : 0;
    return count > 0 && count <= 64 && offset > 0 && offset + count * 0xD4 <= buf.length;
  });
  const lights = [];
  if (lightHeader) {
    const count = buf.readUInt32LE(lightHeader.countOffset);
    const offset = buf.readUInt32LE(lightHeader.offsetOffset);
    for (let i = 0; i < count; i++) {
      const record = offset + i * 0xD4;
      const visibility = readTrackFirst(record, 0xB8, 'u8');
      lights.push({
        type: buf.readUInt16LE(record),
        bone: buf.readInt16LE(record + 2),
        position: [buf.readFloatLE(record + 4), buf.readFloatLE(record + 8), buf.readFloatLE(record + 12)],
        ambientColor: readTrackFirst(record, 0x10, 'vec3') || [0, 0, 0],
        ambientIntensity: readTrackFirst(record, 0x2C, 'float') || 0,
        diffuseColor: readTrackFirst(record, 0x48, 'vec3') || [0, 0, 0],
        diffuseIntensity: readTrackFirst(record, 0x64, 'float') || 0,
        attenuationStart: readTrackFirst(record, 0x80, 'float') || 0,
        attenuationEnd: readTrackFirst(record, 0x9C, 'float') || 0,
        visible: visibility !== 0,
      });
    }
  }

  // WotLK M2 particle emitters are fixed-size records in the header's particle block.
  const particleCount = buf.length >= 0x130 ? buf.readUInt32LE(0x128) : 0;
  const particleOffset = buf.length >= 0x130 ? buf.readUInt32LE(0x12C) : 0;
  const particleStride = 476;
  const particleEmitters = [];
  const readParticleScalar = (offset, relativeOffset) => {
    const trackOffset = offset + relativeOffset;
    if (trackOffset < 0 || trackOffset + 20 > buf.length) return 0;
    const readArrayAt = arrayOffset => {
      if (arrayOffset < 0 || arrayOffset + 8 > buf.length) return null;
      return { count: buf.readUInt32LE(arrayOffset), offset: buf.readUInt32LE(arrayOffset + 4) };
    };
    const times = readArrayAt(trackOffset + 4);
    const values = readArrayAt(trackOffset + 12);
    if (!times?.count || !times.offset || !values?.count || !values.offset) return 0;
    const timeSequence = readArrayAt(times.offset);
    const valueSequence = readArrayAt(values.offset);
    if (!timeSequence?.count || !valueSequence?.count || !valueSequence.offset || valueSequence.offset + 4 > buf.length) return 0;
    const value = buf.readFloatLE(valueSequence.offset);
    return Number.isFinite(value) ? value : 0;
  };
  const readParticleArray = (offset, relativeOffset) => {
    const arrayOffset = offset + relativeOffset;
    if (arrayOffset < 0 || arrayOffset + 8 > buf.length) return null;
    const count = buf.readUInt32LE(arrayOffset);
    const dataOffset = buf.readUInt32LE(arrayOffset + 4);
    return count > 0 && count <= 64 && dataOffset > 0 && dataOffset < buf.length
      ? { count, offset: dataOffset }
      : null;
  };
  const readParticleOpacity = (array) => {
    if (!array || array.offset + array.count * 2 > buf.length) return [];
    return Array.from({ length: array.count }, (_, index) => buf.readUInt16LE(array.offset + index * 2) / 32767);
  };
  const readParticleColors = (array) => {
    if (!array || array.offset + array.count * 12 > buf.length) return [];
    return Array.from({ length: array.count }, (_, index) => {
      const valueOffset = array.offset + index * 12;
      return [
        Math.max(0, Math.min(1, buf.readFloatLE(valueOffset) / 255)),
        Math.max(0, Math.min(1, buf.readFloatLE(valueOffset + 4) / 255)),
        Math.max(0, Math.min(1, buf.readFloatLE(valueOffset + 8) / 255)),
      ];
    });
  };
  if (particleCount > 0 && particleOffset > 0 && particleOffset + particleCount * particleStride <= buf.length) {
    for (let i = 0; i < particleCount; i++) {
      const offset = particleOffset + i * particleStride;
      const textureIndex = buf.readUInt16LE(offset + 22);
      const opacityKeys = readParticleOpacity(readParticleArray(offset, 260));
      const colorKeys = readParticleColors(readParticleArray(offset, 268));
      particleEmitters.push({
        index: i,
        id: buf.readInt32LE(offset),
        flags: buf.readUInt32LE(offset + 4),
        position: [buf.readFloatLE(offset + 8), buf.readFloatLE(offset + 12), buf.readFloatLE(offset + 16)],
        bone: buf.readUInt16LE(offset + 20),
        textureIndex,
        texturePath: textures[textureIndex]?.filename || null,
        blend: buf.readUInt8(offset + 40),
        emitterType: buf.readUInt8(offset + 41),
        particleColor: buf.readInt16LE(offset + 42),
        particleType: buf.readUInt8(offset + 44),
        head: buf.readUInt8(offset + 45),
        textureTileRotation: buf.readInt16LE(offset + 46),
        cols: buf.readInt16LE(offset + 48),
        rows: buf.readInt16LE(offset + 50),
        emissionSpeed: readParticleScalar(offset, 52),
        speedVariation: readParticleScalar(offset, 72),
        verticalRange: readParticleScalar(offset, 92),
        horizontalRange: readParticleScalar(offset, 112),
        gravity: readParticleScalar(offset, 132),
        lifespan: readParticleScalar(offset, 152),
        emissionRate: readParticleScalar(offset, 176),
        emissionAreaLength: readParticleScalar(offset, 200),
        emissionAreaWidth: readParticleScalar(offset, 220),
        colorKeys,
        opacityKeys,
      });
    }
  }

  const renderFlags = [];
  for (let i = 0; i < nRenderFlags && ofsRenderFlags + i * 4 + 4 <= buf.length; i++) { const f = ofsRenderFlags + i * 4; renderFlags.push({ flags: buf.readUInt16LE(f), blend: buf.readUInt16LE(f + 2) }); }

  const textureLookup = [];
  for (let i = 0; i < nTexLookup && ofsTexLookup + i * 2 + 2 <= buf.length; i++) textureLookup.push(buf.readUInt16LE(ofsTexLookup + i * 2));
  const textureUnitLookup = [];
  for (let i = 0; i < nTexUnitLookup && ofsTexUnitLookup + i * 2 + 2 <= buf.length; i++) textureUnitLookup.push(buf.readInt16LE(ofsTexUnitLookup + i * 2));
  const readArray = offset => {
    if (offset < 0 || offset + 8 > buf.length) return null;
    return { count: buf.readUInt32LE(offset), offset: buf.readUInt32LE(offset + 4) };
  };
  const readSequenceArray = (table, sequenceIndex) => {
    if (!table?.count || !table.offset) return null;
    const index = Math.min(sequenceIndex, table.count - 1);
    return readArray(table.offset + index * 8);
  };
  const decodeQuat = offset => {
    if (offset < 0 || offset + 8 > buf.length) return null;
    const cv = value => (value < 0 ? value + 32768 : value - 32767) / 32767;
    const q = [cv(buf.readInt16LE(offset)), cv(buf.readInt16LE(offset + 2)), cv(buf.readInt16LE(offset + 4)), cv(buf.readInt16LE(offset + 6))];
    const length = Math.hypot(...q) || 1;
    return q.map(value => value / length);
  };
  const readTrack = (offset, kind) => {
    if (offset < 0 || offset + 20 > buf.length) return null;
    const timestampTable = readArray(offset + 4);
    const valueTable = readArray(offset + 12);
    const sequences = [];
    for (let sequenceIndex = 0; sequenceIndex < nAnimations; sequenceIndex++) {
      const timestampData = readSequenceArray(timestampTable, sequenceIndex);
      const valueData = readSequenceArray(valueTable, sequenceIndex);
      if (!timestampData?.count || !valueData?.count || !timestampData.offset || !valueData.offset) {
        sequences.push(null);
        continue;
      }
      const count = Math.min(timestampData.count, valueData.count);
      const times = [];
      const values = [];
      for (let key = 0; key < count; key++) {
        const timeOffset = timestampData.offset + key * 4;
        if (timeOffset + 4 > buf.length) break;
        times.push(buf.readUInt32LE(timeOffset));
        const valueOffset = valueData.offset + key * (kind === 'quat' ? 8 : 12);
        const value = kind === 'quat' ? decodeQuat(valueOffset) : (
          valueOffset + 12 <= buf.length
            ? [buf.readFloatLE(valueOffset), buf.readFloatLE(valueOffset + 4), buf.readFloatLE(valueOffset + 8)]
            : null
        );
        if (value) values.push(value);
      }
      sequences.push(times.length && values.length ? { times, values } : null);
    }
    return { interpolation: buf.readUInt16LE(offset), globalSequence: buf.readInt16LE(offset + 2), sequences };
  };
  const animations = [];
  for (let i = 0; i < nAnimations && ofsAnimations + (i + 1) * 68 <= buf.length; i++) {
    const offset = ofsAnimations + i * 68;
    animations.push({
      id: buf.readUInt16LE(offset),
      variation: buf.readUInt16LE(offset + 2),
      length: buf.readUInt32LE(offset + 4),
      flags: buf.readUInt32LE(offset + 12),
    });
  }
  const globalSequences = [];
  for (let i = 0; i < nGlobalSequences && ofsGlobalSequences + (i + 1) * 4 <= buf.length; i++) {
    globalSequences.push(buf.readUInt32LE(ofsGlobalSequences + i * 4));
  }
  const boneLookup = [];
  for (let i = 0; i < nBoneLookup && ofsBoneLookup + (i + 1) * 2 <= buf.length; i++) {
    boneLookup.push(buf.readUInt16LE(ofsBoneLookup + i * 2));
  }
  const boneCount = buf.readUInt32LE(0x2C), boneOffset = buf.readUInt32LE(0x30);
  const bones = [];
  for (let i = 0; i < boneCount && boneOffset + (i + 1) * 88 <= buf.length; i++) {
    const offset = boneOffset + i * 88;
    bones.push({
      parent: buf.readInt16LE(offset + 8),
      pivot: [buf.readFloatLE(offset + 76), buf.readFloatLE(offset + 80), buf.readFloatLE(offset + 84)],
      translation: readTrack(offset + 16, 'vec3'),
      rotation: readTrack(offset + 36, 'quat'),
      scale: readTrack(offset + 56, 'vec3'),
    });
  }
  const rotate = (point, q) => { const [x, y, z] = point, [qx, qy, qz, qw] = q; const ix = qw*x + qy*z - qz*y, iy = qw*y + qz*x - qx*z, iz = qw*z + qx*y - qy*x, iw = -qx*x - qy*y - qz*z; return [ix*qw + iw*-qx + iy*-qz - iz*-qy, iy*qw + iw*-qy + iz*-qx - ix*-qz, iz*qw + iw*-qz + ix*-qy - iy*-qx]; };
  const transformByBone = (boneIndex, point, seen = new Set()) => {
    const bone = bones[boneIndex]; if (!bone || seen.has(boneIndex)) return point; seen.add(boneIndex);
    const local = [(point[0] - bone.pivot[0]) * bone.scale[0], (point[1] - bone.pivot[1]) * bone.scale[1], (point[2] - bone.pivot[2]) * bone.scale[2]];
    const rotated = rotate(local, bone.rotation);
    const next = [rotated[0] + bone.pivot[0] + bone.translation[0], rotated[1] + bone.pivot[1] + bone.translation[1], rotated[2] + bone.pivot[2] + bone.translation[2]];
    return bone.parent >= 0 ? transformByBone(bone.parent, next, seen) : next;
  };
  const attachmentCount = buf.readUInt32LE(0xF0);
  const attachmentOffset = buf.readUInt32LE(0xF4);
  const attachments = [];
  for (let i = 0; i < attachmentCount && attachmentOffset + (i + 1) * 40 <= buf.length; i++) {
    const offset = attachmentOffset + i * 40;
    const x = buf.readFloatLE(offset + 8), y = buf.readFloatLE(offset + 12), z = buf.readFloatLE(offset + 16);
    const bone = buf.readUInt32LE(offset + 4);
 // The preview renders character vertices in their unskinned rest pose. Applying an animated bone only to an item would detach it from that pose.
    attachments.push({ id: buf.readUInt32LE(offset), bone, position: [-y, z, -x] });
  }
  const cameraCount = buf.length >= 0x118 ? buf.readUInt32LE(0x110) : 0;
  const cameraOffset = buf.length >= 0x118 ? buf.readUInt32LE(0x114) : 0;
  const cameras = [];
  const cameraDiagnostics = [];
  // WotLK M2CameraHeader is 0x7c bytes. The position and target base
  // vectors follow their 0x14-byte animation tracks at +0x24 and +0x44.
  const cameraStride = 0x7c;
  const readCameraVector = (trackOffset, baseOffset) => {
    const base = [buf.readFloatLE(baseOffset), buf.readFloatLE(baseOffset + 4), buf.readFloatLE(baseOffset + 8)];
    const valueArrayCount = buf.readUInt32LE(trackOffset + 12);
    const valueArrayOffset = buf.readUInt32LE(trackOffset + 16);
    const track = { valueArrayCount, valueArrayOffset, valueCount: 0, valueOffset: 0, firstValue: null };
    if (!valueArrayCount || valueArrayOffset <= 0 || valueArrayOffset + 8 > buf.length) return { base, resolved: base, track };
    const valueCount = buf.readUInt32LE(valueArrayOffset);
    const valueOffset = buf.readUInt32LE(valueArrayOffset + 4);
    track.valueCount = valueCount;
    track.valueOffset = valueOffset;
    if (!valueCount || valueOffset <= 0 || valueOffset + 12 > buf.length) return { base, resolved: base, track };
    const firstValue = [
      buf.readFloatLE(valueOffset),
      buf.readFloatLE(valueOffset + 4),
      buf.readFloatLE(valueOffset + 8),
    ];
    track.firstValue = firstValue;
    return {
      base,
      resolved: [
      base[0] + buf.readFloatLE(valueOffset),
      base[1] + buf.readFloatLE(valueOffset + 4),
      base[2] + buf.readFloatLE(valueOffset + 8),
      ],
      track,
    };
  };
  const readCameraScalar = trackOffset => {
    const valueArrayCount = buf.readUInt32LE(trackOffset + 12);
    const valueArrayOffset = buf.readUInt32LE(trackOffset + 16);
    const track = { valueArrayCount, valueArrayOffset, valueCount: 0, valueOffset: 0, firstValue: null };
    if (!valueArrayCount || valueArrayOffset <= 0 || valueArrayOffset + 8 > buf.length) return { value: 0, track };
    const valueCount = buf.readUInt32LE(valueArrayOffset);
    const valueOffset = buf.readUInt32LE(valueArrayOffset + 4);
    track.valueCount = valueCount;
    track.valueOffset = valueOffset;
    if (!valueCount || valueOffset <= 0 || valueOffset + 4 > buf.length) return { value: 0, track };
    const value = buf.readFloatLE(valueOffset);
    track.firstValue = value;
    return { value: Number.isFinite(value) ? value : 0, track };
  };
  const toThree = ([x, y, z]) => [-y, z, -x];
  if (cameraCount > 0 && cameraOffset > 0) {
    for (let index = 0; index < cameraCount; index++) {
      const offset = cameraOffset + index * cameraStride;
      if (offset + cameraStride > buf.length) break;
      const fovValue = buf.readFloatLE(offset + 4);
      const farClip = buf.readFloatLE(offset + 8);
      const nearClip = buf.readFloatLE(offset + 12);
      const positionInfo = readCameraVector(offset + 16, offset + 36);
      const targetInfo = readCameraVector(offset + 48, offset + 68);
      const rollInfo = readCameraScalar(offset + 80);
      const position = positionInfo.resolved;
      const target = targetInfo.resolved;
      cameras.push({
        index,
        fov: Number.isFinite(fovValue) && fovValue > 0 ? fovValue : 0.5,
        near: Number.isFinite(nearClip) && nearClip > 0 ? nearClip : 0.1,
        far: Number.isFinite(farClip) && farClip > 0 ? farClip : 50000,
        roll: rollInfo.value,
        position: toThree(position),
        target: toThree(target),
      });
      cameraDiagnostics.push({
        index,
        recordOffset: offset,
        stride: cameraStride,
        raw: {
          fov: fovValue,
          near: nearClip,
          far: farClip,
          roll: rollInfo.value,
          position,
          target,
        },
        three: {
          position: toThree(position),
          target: toThree(target),
        },
        track: {
          position: positionInfo.track,
          target: targetInfo.track,
          roll: rollInfo.track,
        },
      });
    }
  }

  return {
    positions,
    normals,
    uvs,
    uvs2,
    textures,
    lights,
    textureLookup,
    textureUnitLookup,
    renderFlags,
    attachments,
    cameras,
    cameraDiagnostics,
    camera: cameras[0] || null,
    particleEmitters,
    animationData: {
      animations,
      globalSequences,
      boneLookup,
      positionsM2,
      normalsM2,
      boneIndices,
      boneWeights,
      bones,
    },
  };
}

function parseSkin(buf) {
  const skin = parseSkinFile(buf);
  if (!skin) return null;
  const indices = [];
  for (const sm of skin.submeshes) {
    for (let i = 0; i < sm.indexCount; i++) {
      const triIdx = skin.indexLookup[sm.indexStart + i];
      indices.push(skin.vertexLookup[triIdx] ?? 0);
    }
  }
  return indices;
}

async function loadSkinData(reader, dataPath, modelPath, source = null) {
  const cacheKey = source?.archivePath ? `${source.archivePath}|${modelPath}` : modelPath;
  if (m2SkinCache.has(cacheKey)) return m2SkinCache.get(cacheKey);
  const stem = modelPath.replace(/\.m2$/i, '');
  for (const skinPath of [`${stem}00.skin`, `${stem}01.skin`, `${stem}00.SKIN`]) {
    const skinBuf = source?.archivePath && reader.readFileFromMpqEntry
      ? await reader.readFileFromMpqEntry(dataPath, source.archivePath, source.skinPath || skinPath)
      : reader.readM2Companion ? await reader.readM2Companion(dataPath, modelPath, skinPath) : await reader.readFileFromMpqs(dataPath, skinPath);
    const skin = skinBuf ? parseSkinFile(skinBuf) : null;
    if (skin?.submeshes?.length) {
      m2SkinCache.set(cacheKey, skin);
      return skin;
    }
  }
  return null;
}

function m2ModelStem(modelPath) {
  const base = modelPath.split('\\').pop() || modelPath.split('/').pop() || '';
  return base.replace(/\.(m2|mdx)$/i, '');
}

// CharSections.dbc: ID(0) RaceID(4) SexID(8) BaseSection(12) Tex1(16) Tex2(20) Tex3(24) Flags(28) VariationIndex(32) ColorIndex(36)
// recordSize = 40
function parseCharSections(dbc) {
  if (!dbc) return [];
  const rows = [];
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    rows.push({
      race:      dbc.buf.readUInt32LE(off + 4),
      sex:       dbc.buf.readUInt32LE(off + 8),
      section:   dbc.buf.readUInt32LE(off + 12),
      tex1:      dbcStr(dbc, dbc.buf.readUInt32LE(off + 16), 0),
      tex2:      dbcStr(dbc, dbc.buf.readUInt32LE(off + 20), 0),
      tex3:      dbcStr(dbc, dbc.buf.readUInt32LE(off + 24), 0),
      flags:     dbc.buf.readUInt32LE(off + 28),
      variation: dbc.buf.readUInt32LE(off + 32),
      color:     dbc.buf.readUInt32LE(off + 36),
    });
  }
  return rows;
}

function charSectionTextureCandidates(charSections, race, sex, skin, face) {
  const out = [];
  if (!charSections?.length) return out;
  const DK_FLAG = 0x04;
  const match = (section, variation, color) =>
    charSections.find(r => r.race === race && r.sex === sex && r.section === section && r.variation === variation && r.color === color && !(r.flags & DK_FLAG));

  const body = match(0, 0, skin);
  if (body?.tex1) out.push(body.tex1);

  const face1 = match(1, face, skin);
  if (face1?.tex1) out.push(face1.tex1);
  if (face1?.tex2) out.push(face1.tex2);

  return out;
}

function inferCharacterBakeCandidates(modelDir, modelPath, extra) {
  if (!extra) return [];
  const stem = m2ModelStem(modelPath);
  const skin = String(extra.skin ?? 0).padStart(2, '0');
  const hairColor = String(extra.hairColor ?? 0).padStart(2, '0');
 // Pattern: VariationIndex=00, ColorIndex=skin (confirmed from CharSections.dbc)
  const patterns = [
    `${stem}Skin00_${skin}`,
    `${stem}Skin${skin}_${hairColor}`,
    `${stem}Skin${skin}_00`,
    `${stem}Skin00_${hairColor}`,
    `${stem}Skin00_00`,
    `${stem}Skin`,
  ];
  return patterns.map(p => `${modelDir}${p}.blp`);
}

function creatureTextureCandidates(modelDir, modelPath, texVars, m2, discovered = []) {
  const stem = m2ModelStem(modelPath);
  const out = [];

  for (const tex of m2.textures) {
    if (tex.type >= 11 && tex.type <= 13) {
      const v = texVars[tex.type - 11];
      if (v) out.push(modelDir + v + '.blp');
    }
  }
  for (const v of texVars) {
    if (v) out.push(modelDir + v + '.blp');
  }
  if (!/skin$/i.test(stem)) out.push(modelDir + stem + 'Skin.blp');
  for (const p of discovered) out.push(p);
  for (const tex of m2.textures) {
    if (tex.type === 0 && tex.filename && !/PARTICLE|REFLECT|ENVIRON|GLOW|SPARKLE/i.test(tex.filename))
      out.push(tex.filename);
  }
  out.push(modelDir + stem + '.blp');
  return [...new Set(out)];
}

function blpCacheKey(p) {
  return p.replace(/\//g, '\\').toLowerCase();
}

function m2VariantKey(displayId) {
  return `display:${displayId}`;
}

async function getOrLoadM2Geometry(reader, dataPath, modelPath, log, source = null) {
 // WotLK DBCs commonly retain .mdx names although the client archives store .m2 files.
  modelPath = modelPath.replace(/\.mdx$/i, '.m2');
  const cacheKey = source?.archivePath ? `${source.archivePath}|${modelPath}` : modelPath;
  if (m2GeometryCache.has(cacheKey)) {
    log('geometrie cache hit:', modelPath);
    return m2GeometryCache.get(cacheKey);
  }

  const m2Buf = source?.archivePath && reader.readFileFromMpqEntry
    ? await reader.readFileFromMpqEntry(dataPath, source.archivePath, modelPath)
    : reader.readM2FromMpqs ? await reader.readM2FromMpqs(dataPath, modelPath) : await reader.readFileFromMpqs(dataPath, modelPath);
  if (!m2Buf) return null;

  const m2 = parseM2(m2Buf);
  if (!m2) return null;

  const skin = await loadSkinData(reader, dataPath, modelPath, source);
  if (!skin) return null;

  const geo = {
    positions: new Float32Array(m2.positions),
    normals:   new Float32Array(m2.normals),
    uvs:       new Float32Array(m2.uvs),
    uvs2:      new Float32Array(m2.uvs2 || m2.uvs),
    textures:  m2.textures,
    textureLookup: m2.textureLookup || [],
    textureUnitLookup: m2.textureUnitLookup || [],
    renderFlags: m2.renderFlags || [],
    attachments: m2.attachments || [],
    lights: m2.lights || [],
    cameras: m2.cameras || [],
    cameraDiagnostics: m2.cameraDiagnostics || [],
    camera: m2.camera || null,
    particleEmitters: m2.particleEmitters || [],
    animationData: m2.animationData ? {
      ...m2.animationData,
      positionsM2: new Float32Array(m2.animationData.positionsM2),
      normalsM2: new Float32Array(m2.animationData.normalsM2),
      boneIndices: new Uint8Array(m2.animationData.boneIndices),
      boneWeights: new Float32Array(m2.animationData.boneWeights),
    } : null,
    skin,
  };
  m2GeometryCache.set(cacheKey, geo);
  log('geometrie gecached:', modelPath);
  return geo;
}

async function loadFirstCreatureBlp(reader, dataPath, candidates, log) {
  for (const p of candidates) {
    const cached = blpTextureCache.get(blpCacheKey(p));
    if (cached) return cached;
  }
  const decoded = await runM2AssetWorker('decodeFirstBlp', { dataPath, paths: candidates });
  if (decoded?.data && decoded.blpPath) {
    const entry = {
      textureRgba: new Uint8Array(decoded.data),
      textureW: decoded.w,
      textureH: decoded.h,
      blpPath: decoded.blpPath,
    };
    blpTextureCache.set(blpCacheKey(decoded.blpPath), entry);
    return entry;
  }
  return null;

  for (const p of candidates) {
    const key = blpCacheKey(p);
    if (blpTextureCache.has(key)) {
      log('textuur cache hit:', p);
      return blpTextureCache.get(key);
    }

    const buf = await reader.readFileFromMpqs(dataPath, p);
    if (!buf) continue;
    if (buf.length < 4) continue;
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'BLP2') continue;

    try {
      const decoded = decodeBLP(buf);
      const entry = {
        textureRgba: new Uint8Array(decoded.rgba),
        textureW: decoded.w,
        textureH: decoded.h,
        blpPath: p,
      };
      blpTextureCache.set(key, entry);
      log(`textuur gecached: ${p} (${decoded.w}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â${decoded.h})`);
      return entry;
    } catch (e) {
      log('BLP decode fout:', p, e.message);
    }
  }
  return null;
}

async function loadM2ModelForDisplay(displayId, dataPath, log) {
  const { displayInfo, modelData, cdieDbc, charHair, facialHair, charSections } = await getM2DbcData(dataPath);

  const cdi = displayInfo.get(displayId);
  if (!cdi) { log('displayId niet in DBC'); return null; }

  const cmd = modelData.get(cdi.modelId);
  if (!cmd?.modelPath) { log(`modelData ${cdi.modelId} niet gevonden`); return null; }

  const modelPath = cmd.modelPath.replace(/\//g, '\\').replace(/\.mdx$/i, '.m2');
  const texVars   = [cdi.texVar1, cdi.texVar2, cdi.texVar3];
  const variantKey = m2VariantKey(displayId);
  const extra = parseCreatureDisplayInfoExtra(cdieDbc, cdi.extendedDisplayInfoId);

  const userData = app.getPath('userData');

  if (m2VariantCache.has(variantKey)) {
    const cached = m2VariantCache.get(variantKey);
    const geo = m2GeometryCache.get(modelPath);
    if (isCompleteVariant(cached, geo)) {
      log('variant cache hit:', variantKey);
      return cached;
    }
    m2VariantCache.delete(variantKey);
    log('variant cache onvolledig, opnieuw laden:', variantKey);
  }

  const diskVariant = tryLoadM2VariantFromDisk(userData, variantKey, modelPath);
  if (diskVariant) {
    log('variant disk cache hit:', variantKey);
    m2VariantCache.set(variantKey, diskVariant);
    return diskVariant;
  }

  if (m2VariantInflight.has(variantKey)) {
    log('variant wacht op lopende load');
    return m2VariantInflight.get(variantKey);
  }

  const loadWork = (async () => {
  const reader = getMpqReader();
  const geo = await getOrLoadM2Geometry(reader, dataPath, modelPath, log);
  if (!geo?.skin) return null;

  const visible = resolveVisibleGeosets(geo.skin.submeshes, cdi, extra, charHair, facialHair);
  const geosetDebug = buildGeosetDebugInfo(geo.skin.submeshes, visible, cdi, extra, charHair, facialHair);
  const indexList = buildIndicesFromSkin(geo.skin, visible);
  const indexRanges = buildSubmeshIndexRanges(geo.skin, visible);
  if (!indexList.length) return null;

  const modelDir = modelPath.includes('\\') ? modelPath.substring(0, modelPath.lastIndexOf('\\') + 1) : '';
  const stem     = m2ModelStem(modelPath);
  let discovered = [];
  if (reader.discoverCreatureBlps) {
    discovered = await reader.discoverCreatureBlps(dataPath, modelDir, stem);
  }

  const candidates = [];
  if (extra?.bakeName) {
    const bake = extra.bakeName.replace(/\.blp$/i, '').replace(/\//g, '\\');
    candidates.push(bake.includes('\\') ? (bake + '.blp') : (modelDir + bake + '.blp'));
  }
  if (extra) {
    candidates.push(...charSectionTextureCandidates(charSections, extra.race, extra.sex, extra.skin, extra.face));
    candidates.push(...inferCharacterBakeCandidates(modelDir, modelPath, extra));
  }
  const m2Stub = { textures: geo.textures };
  candidates.push(...creatureTextureCandidates(modelDir, modelPath, texVars, m2Stub, discovered));
  const tex = await loadFirstCreatureBlp(reader, dataPath, candidates, log);
  const rawPasses = (geo.skin.textureUnits || []).map((unit, index) => {
    const textureIndex = geo.textureLookup?.[unit.textureId];
    const texture = Number.isInteger(textureIndex) ? geo.textures?.[textureIndex] : null;
    const flag = geo.renderFlags?.[unit.flagsIndex] || { flags: 0, blend: 0 };
    const range = indexRanges.get(unit.submeshIndex);
    return { index, submeshIndex: unit.submeshIndex, textureIndex, texturePath: texture?.type === 0 ? texture.filename : tex?.blpPath, blend: flag.blend, renderFlags: flag.flags, uvSet: geo.textureUnitLookup?.[unit.texUnit] ?? 0, order: unit.order, noDepthWrite: !!(flag.flags & 16), indexStart: range?.start ?? 0, indexCount: range?.count ?? 0 };
  }).filter(pass => geo.skin.submeshes[pass.submeshIndex] && indexRanges.has(pass.submeshIndex));
  const passPaths = [...new Set(rawPasses.map(pass => pass.texturePath).filter(Boolean))];
  const decodedPassTextures = passPaths.length ? await runM2AssetWorker('decodeBlps', { dataPath, entries: passPaths.map((path, textureIdx) => ({ textureIdx, path })) }) : [];
  const passTextureByPath = new Map(decodedPassTextures.filter(row => row.data).map(row => [passPaths[row.textureIdx].toLowerCase(), { rgba: new Uint8Array(row.data), w: row.w, h: row.h, path: passPaths[row.textureIdx] }]));

  const debugInfo = {
    ...geosetDebug,
    modelPath,
    texVar: texVars.filter(Boolean),
    triangleCount: Math.floor(indexList.length / 3),
    textureLoaded: !!tex?.blpPath,
    texturePath: tex?.blpPath ?? null,
    textureSize: tex ? `${tex.textureW}x${tex.textureH}` : null,
    textureCandidates: candidates.slice(0, 20),
    appearance: extra ? { race: extra.race, gender: extra.sex, skin: extra.skin, face: extra.face, hairStyle: extra.hairStyle, hairColor: extra.hairColor, facialHair: extra.facialHair } : null,
  };
  log('geoset:', JSON.stringify(debugInfo));
  if (!tex?.blpPath) log('texture MISS ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â first candidates:', candidates.slice(0, 8));

  const result = {
    positions: geo.positions,
    normals:   geo.normals,
    uvs:       geo.uvs,
    uvs2:      geo.uvs2,
    indices:   new Uint32Array(indexList),
    textureRgba: tex?.textureRgba ?? null,
    textureW:    tex?.textureW ?? 0,
    textureH:    tex?.textureH ?? 0,
    modelPath,
    texturePath: tex?.blpPath ?? null,
    displayId,
    submeshes: geo.skin.submeshes,
    renderPasses: rawPasses,
    passTextures: rawPasses.map(pass => pass.texturePath ? { passIndex: pass.index, ...(passTextureByPath.get(pass.texturePath.toLowerCase()) || {}) } : { passIndex: pass.index }),
    skinData: { vertexLookup: geo.skin.vertexLookup, indexLookup: geo.skin.indexLookup, submeshes: geo.skin.submeshes },
    texturePaths: geo.textures.map(texture => texture.filename).filter(Boolean),
    debug: debugInfo,
  };

  if (isCompleteVariant(result, geo)) {
    m2VariantCache.set(variantKey, result);
    m2DiskCache.writeDiskVariant(userData, variantKey, modelPath, result);
  } else {
    log('variant zonder textuur niet gecached:', variantKey, 'candidates:', candidates.slice(0, 8));
  }
  return result;
  })();

  m2VariantInflight.set(variantKey, loadWork);
  try {
    return await loadWork;
  } finally {
    m2VariantInflight.delete(variantKey);
  }
}

async function handleM2LoadModel({ displayId } = {}) {
  const log = () => {};
  try {
    if (!displayId) return { success: false, error: 'Geen displayId' };

    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad' };

    if (m2ModelCache.has(displayId)) {
      const cached = m2ModelCache.get(displayId);
      if (cached === null) return { success: false, error: 'Model niet beschikbaar (cache)' };
      if (variantHasTexture(cached)) return { success: true, data: cached };
      m2ModelCache.delete(displayId);
      log('display cache zonder textuur gewist, opnieuw laden');
    }

    const result = await loadM2ForDisplay(displayId, dataPath, log);
    if (!result) {
      m2ModelCache.set(displayId, null);
      return { success: false, error: 'Model laden mislukt' };
    }
    if (variantHasTexture(result)) m2ModelCache.set(displayId, result);
    return { success: true, data: result };
  } catch (e) {
    console.error(`[m2:${displayId}] EXCEPTION:`, e);
    return { success: false, error: e.message };
  }
}

function loadM2ForDisplay(displayId, dataPath, log) {
  if (m2DisplayInflight.has(displayId)) return m2DisplayInflight.get(displayId);
  const work = runM2Load(() => loadM2ModelForDisplay(displayId, dataPath, log))
    .finally(() => m2DisplayInflight.delete(displayId));
  m2DisplayInflight.set(displayId, work);
  return work;
}

async function handleM2Prefetch({ displayIds } = {}) {
  try {
    const dataPath = getM2DataPath();
    if (!dataPath || !Array.isArray(displayIds)) return { success: false };

    const log = () => {};
    const unique = [...new Set(displayIds.filter(Boolean))].slice(0, 48);

    for (const displayId of unique) {
      if (m2ModelCache.has(displayId) || m2DisplayInflight.has(displayId)) continue;
      loadM2ForDisplay(displayId, dataPath, log)
        .then(result => { m2ModelCache.set(displayId, result ?? null); })
        .catch(() => { m2ModelCache.set(displayId, null); });
    }

    return { success: true, queued: unique.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Character model paths per race/gender in WotLK MPQ
const CHAR_M2_PATHS = {
  1:  ['Character\\Human\\Male\\HumanMale.m2',        'Character\\Human\\Female\\HumanFemale.m2'],
  2:  ['Character\\Orc\\Male\\OrcMale.m2',            'Character\\Orc\\Female\\OrcFemale.m2'],
  3:  ['Character\\Dwarf\\Male\\DwarfMale.m2',        'Character\\Dwarf\\Female\\DwarfFemale.m2'],
  4:  ['Character\\NightElf\\Male\\NightElfMale.m2',  'Character\\NightElf\\Female\\NightElfFemale.m2'],
  5:  ['Character\\Scourge\\Male\\ScourgeMale.m2',    'Character\\Scourge\\Female\\ScourgeFemale.m2'],
  6:  ['Character\\Tauren\\Male\\TaurenMale.m2',      'Character\\Tauren\\Female\\TaurenFemale.m2'],
  7:  ['Character\\Gnome\\Male\\GnomeMale.m2',        'Character\\Gnome\\Female\\GnomeFemale.m2'],
  8:  ['Character\\Troll\\Male\\TrollMale.m2',        'Character\\Troll\\Female\\TrollFemale.m2'],
  10: ['Character\\BloodElf\\Male\\BloodElfMale.m2',  'Character\\BloodElf\\Female\\BloodElfFemale.m2'],
  11: ['Character\\Draenei\\Male\\DraeneiMale.m2',    'Character\\Draenei\\Female\\DraeneiFemale.m2'],
  12: ['Character\\Worgen\\Male\\WorgenMale.m2',      'Character\\Worgen\\Female\\WorgenFemale.m2'],
};

const WORGEN_MODEL_PROFILES = [
  {
    id: 'worgen-alpha', label: 'Alpha', race: 12,
    match: signature => signature.submeshCount === 57 && signature.ids[41] === 0 && signature.ids[48] === 0,
    hiddenSubmeshes: [
      { index: 41, id: 0 }, { index: 48, id: 0 },
      { index: 42, id: 401 }, { index: 52, id: 401 },
    ],
    excludeCharSectionFlags: 0x04,
    excludeCharSectionColorIndices: [8],
  },
  {
    id: 'worgen-release', label: 'Release', race: 12,
    match: signature => (signature.submeshCount === 86 && signature.ids[3] === 0 && signature.ids[4] === 0) || signature.submeshCount === 76,
    hiddenSubmeshes: [{ index: 3, id: 0 }, { index: 4, id: 0 }, { index: 73, id: 401 }, { index: 82, id: 401 }],
    excludeCharSectionFlags: 0,
  },
];

const WORGEN_HIDDEN_SUBMESHES = [{ index: 3, id: 0 }, { index: 4, id: 0 }, { index: 73, id: 401 }, { index: 82, id: 401 }];

function skinSignature(skin) {
  return {
    submeshCount: skin?.submeshes?.length || 0,
    ids: (skin?.submeshes || []).map(submesh => submesh.id),
  };
}

function profileForSkin(race, skin) {
  if (race !== 12) return null;
  const signature = skinSignature(skin);
  return WORGEN_MODEL_PROFILES.find(profile => profile.match(signature)) || null;
}

function publicModelProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    label: profile.label,
    excludeCharSectionFlags: profile.excludeCharSectionFlags,
    excludeCharSectionColorIndices: profile.excludeCharSectionColorIndices || [],
  };
}

async function findCharacterModelVariants(dataPath, modelPath, race) {
  const reader = getMpqReader();
  if (!reader?.findMpqFiles || !reader.readFileFromMpqEntry) return [];
  const stem = modelPath.replace(/\.m2$/i, '');
  const variants = [];
  for (const archivePath of reader.findMpqFiles(dataPath)) {
    const m2Buf = await reader.readFileFromMpqEntry(dataPath, archivePath, modelPath);
    if (!m2Buf) continue;
    let source = null;
    for (const skinPath of [`${stem}00.skin`, `${stem}01.skin`, `${stem}00.SKIN`]) {
      const skinBuf = await reader.readFileFromMpqEntry(dataPath, archivePath, skinPath);
      const skin = skinBuf ? parseSkinFile(skinBuf) : null;
      if (!skin?.submeshes?.length) continue;
      const profile = profileForSkin(race, skin);
      if (!profile) continue;
      source = { archivePath, skinPath, profile, signature: skinSignature(skin) };
      break;
    }
    if (!source || variants.some(variant => variant.id === source.profile.id)) continue;
    variants.push({
      id: source.profile.id,
      label: source.profile.label,
      profile: publicModelProfile(source.profile),
      signature: source.signature,
      source,
    });
  }
  return variants;
}

function applyCharacterSubmeshOverrides(race, submeshes, visible, profile = null) {
  if (race !== 12) return visible;
  const hidden = profile?.hiddenSubmeshes || WORGEN_HIDDEN_SUBMESHES;
  const hiddenKeys = new Set(hidden.map(item => `${item.index}:${item.id}`));
  return new Set([...visible].filter(index => !hiddenKeys.has(`${index}:${submeshes[index]?.id}`)));
}

function candidateModelTextures(modelPath, geo, discovered = []) {
  const dir = modelPath.includes('\\') ? modelPath.slice(0, modelPath.lastIndexOf('\\') + 1) : '';
  return creatureTextureCandidates(dir, modelPath, [], geo, discovered);
}

async function loadM2ByPath(dataPath, modelPath, log, textureOverride = '', options = {}) {
  const reader = getMpqReader();
  const debugSteps = [];
  const pushStep = (stage, detail) => {
    const line = detail ? (stage + ': ' + detail) : stage;
    debugSteps.push(line);
    log(line);
  };

  pushStep('start', modelPath);
  pushStep('geometry-load:start');
  const geo = await getOrLoadM2Geometry(reader, dataPath, modelPath, log);
  pushStep('geometry-load:done', geo ? 'ok' : 'null');
  if (!geo?.skin) {
    pushStep('abort', 'no skin');
    return { success: false, error: `Missing M2 or companion SKIN data: ${modelPath}` };
  }
  const bounds = (() => {
    const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < geo.positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      const value = geo.positions[i + axis]; out.min[axis] = Math.min(out.min[axis], value); out.max[axis] = Math.max(out.max[axis], value);
    }
    return { min: out.min.map(value => Number(value.toFixed(3))), max: out.max.map(value => Number(value.toFixed(3))) };
  })();
  const rawM2Bounds = (() => {
    const source = geo.animationData?.positionsM2;
    if (!source?.length) return null;
    const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < source.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      const value = source[i + axis]; out.min[axis] = Math.min(out.min[axis], value); out.max[axis] = Math.max(out.max[axis], value);
    }
    return { min: out.min.map(value => Number(value.toFixed(3))), max: out.max.map(value => Number(value.toFixed(3))) };
  })();
  pushStep('geometry', 'positions=' + geo.positions.length + ' textures=' + geo.textures.length + ' submeshes=' + geo.skin.submeshes.length + ' rawM2Bounds=' + JSON.stringify(rawM2Bounds) + ' threeBounds=' + JSON.stringify(bounds));

  const renderProfile = options.renderProfile === 'glue' ? 'glue' : 'creature';
  const isGlueProfile = renderProfile === 'glue';
  const renderAllSubmeshes = options.renderAllSubmeshes ?? isGlueProfile;
  const loadParticles = options.loadParticles !== false;
  const cameraIndex = Number.isInteger(options.cameraIndex) ? options.cameraIndex : 0;
  const sequence = Number.isInteger(options.sequence) ? options.sequence : 0;
  const selectedCamera = geo.cameras?.[cameraIndex] || geo.camera || null;
  const selectedCameraDiagnostic = geo.cameraDiagnostics?.[cameraIndex] || geo.cameraDiagnostics?.[0] || null;
  pushStep('camera', selectedCameraDiagnostic
    ? `index=${cameraIndex} record=0x${selectedCameraDiagnostic.recordOffset.toString(16)} raw=${JSON.stringify(selectedCameraDiagnostic.raw)} three=${JSON.stringify(selectedCameraDiagnostic.three)}`
    : `index=${cameraIndex} unavailable cameras=${geo.cameras?.length || 0}`);
  const visible = renderAllSubmeshes
    ? new Set(geo.skin.submeshes.map((_, idx) => idx))
    : resolveVisibleGeosets(geo.skin.submeshes, null, null, null, null);
  const indexList = buildIndicesFromSkin(geo.skin, visible);
  const indexRanges = buildSubmeshIndexRanges(geo.skin, visible);
  pushStep('indices', 'visible=' + visible.size + ' final=' + indexList.length + (renderAllSubmeshes ? ' (all submeshes)' : ''));
  if (!indexList.length) {
    pushStep('abort', 'no indices');
    return { success: false, error: `Unsupported M2 asset data (no usable submesh indices): ${modelPath}` };
  }

  const renderPasses = (geo.skin.textureUnits || []).map((unit, index) => {
    const textureIndex = geo.textureLookup?.[unit.textureId];
    const texture = Number.isInteger(textureIndex) ? geo.textures?.[textureIndex] : null;
    const renderFlag = geo.renderFlags?.[unit.flagsIndex] || { flags: 0, blend: 0 };
    const range = indexRanges.get(unit.submeshIndex);
    return { index, submeshIndex: unit.submeshIndex, textureIndex, texturePath: texture?.type === 0 ? texture.filename : null, blend: renderFlag.blend, renderFlags: renderFlag.flags, uvSet: geo.textureUnitLookup?.[unit.texUnit] ?? 0, order: unit.order, noDepthWrite: !!(renderFlag.flags & 16), indexStart: range?.start ?? 0, indexCount: range?.count ?? 0 };
  }).filter(pass => geo.skin.submeshes[pass.submeshIndex] && indexRanges.has(pass.submeshIndex));
  const modelDir = modelPath.includes('\\') ? modelPath.slice(0, modelPath.lastIndexOf('\\') + 1) : '';
  const discovered = isGlueProfile
    ? []
    : (reader.discoverCreatureBlps ? await reader.discoverCreatureBlps(dataPath, modelDir, m2ModelStem(modelPath)) : []);
  const candidates = isGlueProfile
    ? []
    : [...new Set([textureOverride, ...candidateModelTextures(modelPath, geo, discovered)].filter(Boolean))];
  pushStep('textures', 'candidates=' + candidates.length + ' passes=' + renderPasses.length);
  const tex = isGlueProfile ? null : await loadFirstCreatureBlp(reader, dataPath, candidates, log);
  const passPaths = [...new Set(renderPasses.map(pass => pass.texturePath).filter(Boolean))];
  pushStep('pass-textures:start', 'count=' + passPaths.length);
  const decodedPassTextures = passPaths.length
    ? await runM2AssetWorker('decodeBlps', { dataPath, entries: passPaths.map((path, textureIdx) => ({ textureIdx, path })) })
    : [];
  const passTextureBytes = decodedPassTextures.reduce((total, row) => total + (row.data?.byteLength || 0), 0);
  pushStep('pass-textures:done', 'decoded=' + decodedPassTextures.filter(row => row.data).length + '/' + passPaths.length + ' bytes=' + passTextureBytes);
  const passTextureByPath = new Map(decodedPassTextures.filter(row => row.data).map(row => [passPaths[row.textureIdx].toLowerCase(), { rgba: new Uint8Array(row.data), w: row.w, h: row.h, path: passPaths[row.textureIdx] }]));
  const particlePaths = loadParticles ? [...new Set((geo.particleEmitters || []).map(emitter => emitter.texturePath).filter(Boolean))] : [];
  const decodedParticleTextures = particlePaths.length
    ? await runM2AssetWorker('decodeBlps', { dataPath, entries: particlePaths.map((path, textureIdx) => ({ textureIdx, path })) })
    : [];
  const particleTextureByPath = new Map(decodedParticleTextures.filter(row => row.data).map(row => [particlePaths[row.textureIdx].toLowerCase(), { rgba: new Uint8Array(row.data), w: row.w, h: row.h, path: particlePaths[row.textureIdx] }]));
  const particleTextures = loadParticles ? (geo.particleEmitters || []).map(emitter => ({
    emitterIndex: emitter.index,
    textureIndex: emitter.textureIndex,
    texturePath: emitter.texturePath,
    ...(emitter.texturePath ? (particleTextureByPath.get(emitter.texturePath.toLowerCase()) || {}) : {}),
  })) : [];
  pushStep('particle-load', loadParticles
    ? `${geo.particleEmitters?.length || 0} emitters / ${particleTextures.filter(texture => texture.rgba).length} textures`
    : `disabled (${geo.particleEmitters?.length || 0} emitters)`);
  pushStep('texture-load', tex?.blpPath ? ('hit ' + tex.blpPath) : 'miss');

  return {
    success: true,
    data: {
      positions: geo.positions,
      normals: geo.normals,
      uvs: geo.uvs,
      uvs2: geo.uvs2,
      indices: new Uint32Array(indexList),
      submeshes: geo.skin.submeshes,
      renderPasses,
      passTextures: renderPasses.map(pass => pass.texturePath ? { passIndex: pass.index, ...(passTextureByPath.get(pass.texturePath.toLowerCase()) || {}) } : { passIndex: pass.index }),
      particleEmitters: loadParticles ? (geo.particleEmitters || []) : [],
      particleTextures,
      skinData: { vertexLookup: geo.skin.vertexLookup, indexLookup: geo.skin.indexLookup, submeshes: geo.skin.submeshes },
      animationData: geo.animationData || null,
      lights: geo.lights || [],
      cameras: geo.cameras || [],
      cameraDiagnostics: geo.cameraDiagnostics || [],
      camera: selectedCamera,
      texturePaths: geo.textures.map(t => t.filename).filter(Boolean),
      textureRgba: tex?.textureRgba ?? null,
      textureW: tex?.textureW ?? 0,
      textureH: tex?.textureH ?? 0,
      modelPath,
      renderProfile,
      renderAllSubmeshes,
      loadParticles,
      texturePath: tex?.blpPath ?? null,
      rawM2Bounds,
      geometryBounds: bounds,
      debug: {
        modelPath,
        renderProfile,
        renderAllSubmeshes,
        loadParticles,
        textureLoaded: !!tex?.blpPath,
        textureCandidates: candidates.slice(0, 20),
        vertexCount: geo.positions.length / 3,
        indexCount: indexList.length,
        rawM2Bounds,
        bounds,
        cameraIndex,
        sequence,
        cameraCount: geo.cameras?.length || 0,
        camera: selectedCameraDiagnostic,
        debugSteps,
      },
    },
  };
}

async function handleM2LoadModelByPath({
  modelPath,
  texturePath = '',
  cameraIndex = 0,
  sequence = 0,
  renderProfile = 'creature',
  renderAllSubmeshes,
  loadParticles = true,
} = {}) {
  try {
    if (!modelPath) return { success: false, error: 'Geen modelPath' };
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad ingesteld' };
 // WotLK CreatureModelData frequently stores legacy .mdx names while the MPQ holds .m2.
    const resolvedModelPath = modelPath.replace(/\.mdx$/i, '.m2');
    const result = await loadM2ByPath(dataPath, resolvedModelPath, () => {}, texturePath, {
      cameraIndex,
      sequence,
      renderProfile,
      renderAllSubmeshes,
      loadParticles,
    });
    return result || { success: false, error: 'Client model asset ontbreekt: ' + resolvedModelPath };
  } catch (e) {
    console.error('[m2:loadModelByPath]', e);
    return { success: false, error: e.message };
  }
}


async function handleM2ListCharModelVariants({ race, gender } = {}) {
  try {
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad ingesteld' };
    const m2Path = CHAR_M2_PATHS[race]?.[gender];
    if (!m2Path) return { success: false, error: `Onbekende race/gender: ${race}/${gender}` };
    const variants = await findCharacterModelVariants(dataPath, m2Path, race);
    return { success: true, data: variants.map(({ source, ...variant }) => ({ ...variant, archivePath: source.archivePath })) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleM2LoadCharModel({ race, gender, skinBlp, appearance = {}, enabledSubmeshIndices = null, modelVariantId = '' } = {}) {
  const log = () => {};
  try {
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad ingesteld' };

    const dbcData = await getM2DbcData(dataPath);
    const m2Path = CHAR_M2_PATHS[race]?.[gender];
    if (!m2Path) return { success: false, error: `Onbekende race/gender: ${race}/${gender}` };

    const reader = getMpqReader();
    const variants = race === 12 ? await findCharacterModelVariants(dataPath, m2Path, race) : [];
    const selectedVariant = variants.find(variant => variant.id === modelVariantId) || variants[0] || null;
    const profile = selectedVariant?.source?.profile || null;
    const geo = await getOrLoadM2Geometry(reader, dataPath, m2Path, log, selectedVariant?.source || null);
    if (!geo?.skin) return { success: false, error: `Model niet gevonden: ${m2Path}` };
    const extra = { race, sex: gender, skin: Number(appearance.skin) || 0, face: Number(appearance.face) || 0, hairStyle: Number(appearance.hairStyle) || 0, hairColor: Number(appearance.hairColor) || 0, facialHair: Number(appearance.facialHair) || 0 };
    const visible = applyCharacterSubmeshOverrides(
      race,
      geo.skin.submeshes,
      resolveVisibleGeosets(geo.skin.submeshes, null, extra, dbcData.charHair, dbcData.facialHair),
      profile,
    );
    for (const [groupText, variant] of Object.entries(appearance.itemGeosets || {})) {
      const group = Number(groupText), targetId = group * 100 + 1 + Number(variant || 0);
      for (let index = 0; index < geo.skin.submeshes.length; index++) if (Math.floor(geo.skin.submeshes[index].id / 100) === group) visible.delete(index);
      const target = geo.skin.submeshes.findIndex(submesh => submesh.id === targetId);
      if (target >= 0) visible.add(target);
    }
    const defaultSubmeshIndices = [...visible].sort((a, b) => a - b);
    const hairSubmeshIndices = [...new Set((geo.skin.textureUnits || []).filter(unit => { const textureIndex = geo.textureLookup?.[unit.textureId]; return Number.isInteger(textureIndex) && geo.textures?.[textureIndex]?.type === 6; }).map(unit => unit.submeshIndex).filter(index => defaultSubmeshIndices.includes(index)))];
    const hairSubmeshIds = new Set(hairSubmeshIndices.map(index => geo.skin.submeshes[index]?.id));
    const suppressedAtlasSubmeshIndices = [...new Set((geo.skin.textureUnits || [])
      .filter(unit => {
        const textureIndex = geo.textureLookup?.[unit.textureId];
        return defaultSubmeshIndices.includes(unit.submeshIndex) && geo.textures?.[textureIndex]?.type !== 6 && hairSubmeshIds.has(geo.skin.submeshes[unit.submeshIndex]?.id);
      })
      .map(unit => unit.submeshIndex))];
    const renderPasses = (geo.skin.textureUnits || [])
      .filter(unit => defaultSubmeshIndices.includes(unit.submeshIndex))
      .map((unit, index) => {
        const textureIndex = geo.textureLookup?.[unit.textureId];
        const texture = Number.isInteger(textureIndex) ? geo.textures?.[textureIndex] : null;
        const renderFlag = geo.renderFlags?.[unit.flagsIndex] || { flags: 0, blend: 0 };
        return { index, submeshIndex: unit.submeshIndex, textureType: texture?.type ?? -1, textureIndex, blend: renderFlag.blend, renderFlags: renderFlag.flags, twoSided: !!(renderFlag.flags & 4), noDepthWrite: !!(renderFlag.flags & 16), order: unit.order, shading: unit.shading, mode: unit.mode, transId: unit.transId };
      });
    const activeSubmeshIndices = Array.isArray(enabledSubmeshIndices) ? enabledSubmeshIndices : defaultSubmeshIndices;
    const indexList = [];
    for (const index of activeSubmeshIndices) {
      const submesh = geo.skin.submeshes[index];
      if (!submesh) continue;
      for (let i = 0; i < submesh.indexCount; i++) {
        const triIndex = geo.skin.indexLookup[submesh.indexStart + i];
        indexList.push(geo.skin.vertexLookup[triIndex] ?? 0);
      }
    }
    if (!indexList.length) return { success: false, error: 'Geen zichtbare submeshes' };
    const submeshes = geo.skin.submeshes.map((submesh, index) => ({
      index, id: submesh.id, triangles: Math.floor(submesh.indexCount / 3),
      defaultVisible: defaultSubmeshIndices.includes(index),
    }));

 // Skin texture laden
    let textureRgba = null, textureW = 0, textureH = 0, texturePath = null;
    if (skinBlp) {
      const key = blpCacheKey(skinBlp);
      let entry = blpTextureCache.get(key);
      if (!entry) {
        const direct = path.join(dataPath, skinBlp.replace(/\\/g, path.sep));
        let buf = null;
        if (fs.existsSync(direct)) {
          buf = fs.readFileSync(direct);
        }
        if (!buf) buf = await reader.readFileFromMpqs(dataPath, skinBlp);
        if (buf?.length >= 4 && buf.toString('ascii', 0, 4) === 'BLP2') {
          try {
            const decoded = decodeBLP(buf);
            entry = { textureRgba: new Uint8Array(decoded.rgba), textureW: decoded.w, textureH: decoded.h, blpPath: skinBlp };
            blpTextureCache.set(key, entry);
          } catch (e) { log('BLP decode fout:', e.message); }
        } else if (buf) {
          log('BLP niet gevonden of geen BLP2 magic:', skinBlp);
        }
      }
      if (entry) { textureRgba = entry.textureRgba; textureW = entry.textureW; textureH = entry.textureH; texturePath = entry.blpPath; }
    }

    return {
      success: true,
      data: {
        positions:    geo.positions,
        normals:      geo.normals,
        uvs:          geo.uvs,
        indices:      new Uint32Array(indexList),
        textureRgba,
        textureW,
        textureH,
        modelPath:    m2Path,
        modelVariantId: selectedVariant?.id || null,
        modelVariant: publicModelProfile(profile),
        texturePath,
        submeshes,
        activeSubmeshIndices,
        hairSubmeshIndices,
        renderPasses,
        suppressedAtlasSubmeshIndices,
        attachmentPoints: geo.attachments || [],
        skinData: {
          vertexLookup: geo.skin.vertexLookup,
          indexLookup: geo.skin.indexLookup,
          submeshes: geo.skin.submeshes,
        },        debug: {
          race, gender, skinBlp, appearance: extra,
          modelVariantId: selectedVariant?.id || null,
          triangleCount: Math.floor(indexList.length / 3),
          textureLoaded: !!textureRgba,
          visibleSubmeshIndices: [...visible].sort((a, b) => a - b),
          visibleGeosetIds: [...new Set(defaultSubmeshIndices.map(i => geo.skin.submeshes[i]?.id).filter(Boolean))].sort((a, b) => a - b),
        },
      },
    };
  } catch (e) {
    console.error('[m2:loadCharModel]', e);
    return { success: false, error: e.message };
  }
}


async function handleM2PickModelPath() {
  const dataPath = getM2DataPath();
  if (!dataPath) return { success: false, error: 'Set a valid client Data path in Settings first.' };
  const picked = await dialog.showOpenDialog(m2Deps.getMainWindow?.() || null, {
    title: 'Open WoW M2 asset', defaultPath: dataPath, properties: ['openFile'],
    filters: [{ name: 'WoW M2 models', extensions: ['m2', 'mdx'] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return { success: true, canceled: true };
  const root = path.resolve(dataPath);
  const selected = path.resolve(picked.filePaths[0]);
  const relative = path.relative(root, selected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { success: false, error: 'Choose an M2 inside the configured client Data folder.' };
  return { success: true, modelPath: relative.replace(/[\\/]/g, '\\').replace(/\.mdx$/i, '.m2') };
}

async function handleM2SearchAssets({ query = '', limit = 80 } = {}) {
  try {
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Set a valid client Data path in Settings first.' };
    const term = String(query).trim().toLowerCase();
    if (!term) return { success: true, data: [] };
    const paths = await getMpqReader().collectListfilePaths(dataPath);
    const data = paths.filter(p => /\.(m2|mdx)$/i.test(p) && p.toLowerCase().includes(term))
      .sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, Math.max(1, Math.min(Number(limit) || 80, 200)));
    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
}

async function handleM2FindDisplaysByModelPath({ modelPath } = {}) {
  try {
    const dataPath = getM2DataPath();
    if (!dataPath || !modelPath) return { success: false, error: 'Client Data path and model path are required.' };
    const target = modelPath.replace(/\//g, '\\').replace(/\.mdx$/i, '.m2').toLowerCase();
    const { displayInfo, modelData, cdieDbc } = await getM2DbcData(dataPath);
    const data = [];
    for (const [id, display] of displayInfo) {
      const model = modelData.get(display.modelId);
      if (!model?.modelPath) continue;
      const candidate = model.modelPath.replace(/\//g, '\\').replace(/\.mdx$/i, '.m2').toLowerCase();
      if (candidate === target) {
        const extra = parseCreatureDisplayInfoExtra(cdieDbc, display.extendedDisplayInfoId);
        data.push({ id, modelId: display.modelId, textures: [display.texVar1, display.texVar2, display.texVar3].filter(Boolean), appearance: extra ? { race: extra.race, gender: extra.sex, skin: extra.skin, face: extra.face, hairStyle: extra.hairStyle, hairColor: extra.hairColor, facialHair: extra.facialHair } : null });
      }
    }
    return { success: true, data: data.sort((a, b) => a.id - b.id).slice(0, 100) };
  } catch (e) { return { success: false, error: e.message }; }
}


function invalidateM2DbcCache() {
  m2DbcCachePromise = null;
  m2DbcCachePath = null;
  m2ModelCache.clear();
  m2VariantCache.clear();
  m2DisplayInflight.clear();
}

function registerM2Ipc(ipcMain, deps = {}) {
  m2Deps = deps;
  if (deps.blpTextureCache) blpTextureCache = deps.blpTextureCache;
  ipcMain.handle('m2:loadModel', (_, payload) => handleM2LoadModel(payload));
  ipcMain.handle('m2:prefetch', (_, payload) => handleM2Prefetch(payload));
  ipcMain.handle('m2:loadModelByPath', (_, payload) => handleM2LoadModelByPath(payload));
  ipcMain.handle('m2:listCharModelVariants', (_, payload) => handleM2ListCharModelVariants(payload));
  ipcMain.handle('m2:loadCharModel', (_, payload) => handleM2LoadCharModel(payload));
  ipcMain.handle('m2:pickModelPath', (_, payload) => handleM2PickModelPath(payload));
  ipcMain.handle('m2:searchAssets', (_, payload) => handleM2SearchAssets(payload));
  ipcMain.handle('m2:findDisplaysByModelPath', (_, payload) => handleM2FindDisplaysByModelPath(payload));
  return { getM2DbcData, invalidateM2DbcCache };
}

module.exports = { registerM2Ipc };
