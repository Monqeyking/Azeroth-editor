const { parentPort, workerData } = require('worker_threads');
const { decodeBLP } = require('./blp-codec');
const mpqReader = require('./mpq-reader');

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

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const ASSET_IO_CONCURRENCY = Number.isInteger(workerData?.assetIoConcurrency)
  ? Math.max(1, workerData.assetIoConcurrency)
  : 6;

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
      const scale = type === 'm2' ? buf.readUInt16LE(p + 32) / 1024 : buf.readUInt16LE(p + 62) / 1024;
      out.push({
        type, path, uniqueId: buf.readUInt32LE(p + 4),
        position: [buf.readFloatLE(p + 8), buf.readFloatLE(p + 12), buf.readFloatLE(p + 16)],
        rotation: [buf.readFloatLE(p + 20), buf.readFloatLE(p + 24), buf.readFloatLE(p + 28)],
        scale: type === 'wmo' && (!Number.isFinite(scale) || scale <= 0) ? 1 : scale,
        ...(type === 'wmo' ? {
          flags: buf.readUInt16LE(p + 56),
          doodadSet: buf.readUInt16LE(p + 58),
          nameSet: buf.readUInt16LE(p + 60),
        } : {}),
      });
    }
    return out;
  };
  return { m2: read('FDDM', 36, m2Names, 'm2'), wmo: read('FDOM', 64, wmoNames, 'wmo') };
}

function findChunk(buf, id) {
  const ids = [id, id.split('').reverse().join('')];
  let off = 0;
  while (off + 8 <= buf.length) {
    const positions = ids.map(candidate => buf.indexOf(candidate, off, 'ascii')).filter(position => position >= 0);
    const at = positions.length ? Math.min(...positions) : -1;
    if (at < 0 || at + 8 > buf.length) return null;
    const size = buf.readUInt32LE(at + 4);
    if (at + 8 + size <= buf.length) return { data: at + 8, size };
    off = at + 4;
  }
  return null;
}

function parseWmoMaterials(root) {
  const motx = findChunk(root, 'MOTX');
  const momt = findChunk(root, 'MOMT');
  if (!momt) return [];
  const materials = [];
  for (let off = 0; off + 64 <= momt.size; off += 64) {
    const base = momt.data + off;
    const flags = root.readUInt32LE(base);
    const shader = root.readUInt32LE(base + 4);
    const blendMode = root.readUInt32LE(base + 8);
    const texturePath = motx ? stringAt(root, motx.data, motx.size, root.readUInt32LE(base + 12)) : null;
    const storedTexturePath2 = motx ? stringAt(root, motx.data, motx.size, root.readUInt32LE(base + 24)) : null;
    const texturePath2 = storedTexturePath2 || (shader === 8 && texturePath
      ? texturePath.replace(/(\.[^\\.]+)$/i, '_s$1')
      : null);
    const texturePath3 = motx ? stringAt(root, motx.data, motx.size, root.readUInt32LE(base + 36)) : null;
    materials.push({
      flags,
      shader,
      blendMode,
      texturePath: texturePath || null,
      texturePath2: texturePath2 || null,
      texturePath3: texturePath3 || null,
    });
  }
  return materials;
}

const WMO_SHADER_TEXTURE_COUNTS = new Map([
  [3, 2], [5, 2], [6, 2], [7, 3], [8, 2], [9, 2],
  [11, 3], [12, 3], [13, 2], [15, 2], [17, 3],
]);

function wmoShaderTextureCount(shader) {
  return WMO_SHADER_TEXTURE_COUNTS.get(Number(shader)) || 1;
}

function parseWmoDoodadData(root) {
  const names = findChunk(root, 'MODN');
  const doodads = findChunk(root, 'MODD');
  if (!names || !doodads) return { doodads: [], doodadSets: [] };

  const rows = [];
  for (let off = 0; off + 40 <= doodads.size; off += 40) {
    const base = doodads.data + off;
    const packedName = root.readUInt32LE(base);
    const path = stringAt(root, names.data, names.size, packedName & 0x00ffffff);
    rows.push(path ? {
      path,
      uniqueId: off / 40,
      position: [root.readFloatLE(base + 4), root.readFloatLE(base + 8), root.readFloatLE(base + 12)],
      rotation: [root.readFloatLE(base + 16), root.readFloatLE(base + 20), root.readFloatLE(base + 24), root.readFloatLE(base + 28)],
      scale: root.readFloatLE(base + 32),
      flags: packedName >>> 24,
    } : null);
  }

  const setsChunk = findChunk(root, 'MODS');
  const doodadSets = [];
  for (let off = 0; setsChunk && off + 32 <= setsChunk.size; off += 32) {
    const base = setsChunk.data + off;
    doodadSets.push({
      name: stringAt(root, setsChunk.data, setsChunk.size, off),
      start: root.readUInt32LE(base + 20),
      count: root.readUInt32LE(base + 24),
    });
  }
  return { doodads: rows, doodadSets };
}

function parseWmoSkybox(root) {
  const chunk = findChunk(root, 'MOSB');
  if (!chunk || chunk.size < 2 || root[chunk.data] === 0) return null;
  return stringAt(root, chunk.data, chunk.size, 0)?.replace(/\.mdx$/i, '.m2') || null;
}

function parseWmoPortals(root) {
  const verticesChunk = findChunk(root, 'MOPV');
  const portalsChunk = findChunk(root, 'MOPT');
  const refsChunk = findChunk(root, 'MOPR');
  if (!verticesChunk || !portalsChunk || !refsChunk || verticesChunk.size < 12 || portalsChunk.size < 20 || refsChunk.size < 8) return null;
  const vertices = [];
  for (let offset = 0; offset + 12 <= verticesChunk.size; offset += 12) {
    vertices.push([
      root.readFloatLE(verticesChunk.data + offset),
      root.readFloatLE(verticesChunk.data + offset + 4),
      root.readFloatLE(verticesChunk.data + offset + 8),
    ]);
  }
  const portals = [];
  for (let offset = 0; offset + 20 <= portalsChunk.size; offset += 20) {
    const base = portalsChunk.data + offset;
    portals.push({
      baseIndex: root.readUInt16LE(base),
      indexCount: root.readUInt16LE(base + 2),
      plane: [
        root.readFloatLE(base + 4),
        root.readFloatLE(base + 8),
        root.readFloatLE(base + 12),
        root.readFloatLE(base + 16),
      ],
    });
  }
  const refs = [];
  for (let offset = 0; offset + 8 <= refsChunk.size; offset += 8) {
    const base = refsChunk.data + offset;
    refs.push({
      portalIndex: root.readUInt16LE(base),
      groupIndex: root.readUInt16LE(base + 2),
      side: root.readInt16LE(base + 4),
    });
  }
  if (!portals.length || !refs.length) return null;
  return { vertices, portals, refs };
}

function parseWmoLiquid(buf) {
  const chunk = findChunk(buf, 'MLIQ');
  if (!chunk || chunk.size < 30) return null;
  const base = chunk.data;
  const xverts = buf.readUInt32LE(base);
  const yverts = buf.readUInt32LE(base + 4);
  const xtiles = buf.readUInt32LE(base + 8);
  const ytiles = buf.readUInt32LE(base + 12);
  const vertexCount = xverts * yverts;
  const tileCount = xtiles * ytiles;
  if (!Number.isInteger(vertexCount) || !Number.isInteger(tileCount) || xverts < 2 || yverts < 2 || xtiles !== xverts - 1 || ytiles !== yverts - 1) return null;
  const vertexStart = base + 30;
  const vertexEnd = vertexStart + vertexCount * 8;
  const tileEnd = vertexEnd + tileCount;
  if (vertexEnd > chunk.data + chunk.size || tileEnd > chunk.data + chunk.size) return null;
  const heights = new Float32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) heights[index] = buf.readFloatLE(vertexStart + index * 8 + 4);
  return {
    xverts,
    yverts,
    xtiles,
    ytiles,
    base: [buf.readFloatLE(base + 16), buf.readFloatLE(base + 20), buf.readFloatLE(base + 24)],
    materialId: buf.readUInt16LE(base + 28),
    heights,
    tileFlags: new Uint8Array(buf.subarray(vertexEnd, tileEnd)),
  };
}

function readWmoGroupBounds(buf) {
  const mogp = findChunk(buf, 'MOGP');
  if (!mogp || mogp.size < 36) return null;
  const read = offset => buf.readFloatLE(mogp.data + offset);
  const values = [12, 16, 20, 24, 28, 32].map(read);
  if (!values.every(Number.isFinite)) return null;
  const [minX, minY, minZ, maxX, maxY, maxZ] = values;
  return {
    min: [minY, minZ, minX],
    max: [maxY, maxZ, maxX],
  };
}

function parseWmoGroup(buf, materials, groupIndex = -1) {
  const movt = findChunk(buf, 'MOVT');
  const movi = findChunk(buf, 'MOVI');
  if (!movt || !movi) return [];
  const mogp = findChunk(buf, 'MOGP');
  const bounds = readWmoGroupBounds(buf);
  const monr = findChunk(buf, 'MONR');
  const motv = findChunk(buf, 'MOTV');
  const mocv = findChunk(buf, 'MOCV');
  const mopy = findChunk(buf, 'MOPY');
  const modr = findChunk(buf, 'MODR');
  const doodadRefs = modr
    ? Array.from({ length: Math.floor(modr.size / 2) }, (_, index) => buf.readUInt16LE(modr.data + index * 2))
    : [];
  const groupFlags = mogp && mogp.size >= 12 ? buf.readUInt32LE(mogp.data + 8) : 0;
  const portalRefStart = mogp && mogp.size >= 0x28 ? buf.readUInt16LE(mogp.data + 0x24) : 0;
  const portalRefCount = mogp && mogp.size >= 0x28 ? buf.readUInt16LE(mogp.data + 0x26) : 0;
  const liquid = parseWmoLiquid(buf);
  const vertexCount = Math.floor(movt.size / 12);
  const triangleCount = Math.floor(movi.size / 6);
  const uvStride = motv && Math.floor(motv.size / 8) >= vertexCount * 2 ? 16 : 8;
  const hasVertexColors = !!mocv && mocv.size >= vertexCount * 4;
  const buckets = new Map();
  const vertex = index => {
    if (index < 0 || index >= vertexCount) return null;
    const base = movt.data + index * 12;
    const normalBase = monr && monr.data + index * 12;
    const uvBase = motv && motv.data + index * uvStride;
    const uv2Base = uvBase && uvStride === 16 ? uvBase + 8 : uvBase;
    const colorBase = hasVertexColors ? mocv.data + index * 4 : null;
    return {
      position: [buf.readFloatLE(base + 4), buf.readFloatLE(base + 8), buf.readFloatLE(base)],
      normal: normalBase ? [buf.readFloatLE(normalBase + 4), buf.readFloatLE(normalBase + 8), buf.readFloatLE(normalBase)] : [0, 1, 0],
      uv: uvBase ? [buf.readFloatLE(uvBase), buf.readFloatLE(uvBase + 4)] : [0, 0],
      uv2: uv2Base ? [buf.readFloatLE(uv2Base), buf.readFloatLE(uv2Base + 4)] : [0, 0],
      color: colorBase ? [
        buf[colorBase + 2] / 255,
        buf[colorBase + 1] / 255,
        buf[colorBase] / 255,
        buf[colorBase + 3] / 255,
      ] : null,
    };
  };
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const flag = mopy && mopy.data + triangle * 2 < mopy.data + mopy.size ? buf.readUInt8(mopy.data + triangle * 2) : 0x20;
    const materialIndex = mopy && mopy.data + triangle * 2 + 1 < mopy.data + mopy.size ? buf.readUInt8(mopy.data + triangle * 2 + 1) : 0;
    // 0x04 marks detail geometry; it is still rendered by the client when
    // the render flag is present. Only collision-only and non-render faces
    // should be omitted from the viewport mesh.
    if (materialIndex === 0xff || !(flag & 0x20)) continue;
    const group = buckets.get(materialIndex) || { materialIndex, positions: [], normals: [], uvs: [], uvs2: [], colors: hasVertexColors ? [] : null, indices: [], lookup: new Map() };
    const indices = [0, 1, 2].map(i => buf.readUInt16LE(movi.data + triangle * 6 + i * 2));
    if (indices.some(index => index >= vertexCount)) continue;
    for (const sourceIndex of indices) {
      let targetIndex = group.lookup.get(sourceIndex);
      if (targetIndex == null) {
        targetIndex = group.positions.length / 3;
        group.lookup.set(sourceIndex, targetIndex);
        const data = vertex(sourceIndex);
        group.positions.push(...data.position);
        group.normals.push(...data.normal);
        group.uvs.push(...data.uv);
        group.uvs2.push(...data.uv2);
        if (group.colors) group.colors.push(...data.color);
      }
      group.indices.push(targetIndex);
    }
    group.flags = flag;
    buckets.set(materialIndex, group);
  }
  return [...buckets.values()].map(({ lookup, ...group }) => ({
    positions: new Float32Array(group.positions),
    normals: new Float32Array(group.normals),
    uvs: new Float32Array(group.uvs),
    uvs2: new Float32Array(group.uvs2),
    ...(group.colors ? { colors: new Float32Array(group.colors), hasVertexColors: true } : {}),
    indices: new Uint32Array(group.indices),
    materialIndex: materials[group.materialIndex] ? group.materialIndex : 0,
    flags: group.flags,
    groupIndex,
    bounds,
    groupFlags,
    portalRefStart,
    portalRefCount,
    doodadRefs,
    ...(liquid ? { liquid } : {}),
  }));
}

async function readWmoAsset(dataPath, modelPath, includeTextures = true) {
  const normalizedPath = String(modelPath || '').replace(/\//g, '\\');
  const rootBuffer = await mpqReader.readFileFromMpqs(dataPath, normalizedPath);
  if (!rootBuffer) return null;
  const root = Buffer.from(rootBuffer);
  const materials = parseWmoMaterials(root);
  const doodadData = parseWmoDoodadData(root);
  const skyboxPath = parseWmoSkybox(root);
  const portalData = parseWmoPortals(root);
  const mohd = findChunk(root, 'MOHD');
  const groupCountFromHeader = mohd && mohd.size >= 8 ? root.readUInt32LE(mohd.data + 4) : 0;
  let groupPaths = groupCountFromHeader > 0
    ? Array.from({ length: groupCountFromHeader }, (_, index) => normalizedPath.replace(/\.wmo$/i, `_${String(index).padStart(3, '0')}.wmo`))
    : [];
  if (!groupPaths.length) {
    const listfilePaths = await mpqReader.collectListfilePaths?.(dataPath) || [];
    const groupPrefix = normalizedPath.replace(/\.wmo$/i, '_').toLowerCase();
    groupPaths = listfilePaths
      .map(candidate => String(candidate || '').replace(/\//g, '\\'))
      .filter(candidate => {
        const lower = candidate.toLowerCase();
        if (!lower.startsWith(groupPrefix) || !lower.endsWith('.wmo')) return false;
        return /^\d{3}\.wmo$/i.test(lower.slice(groupPrefix.length));
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const groupMeshes = await mapConcurrent(groupPaths, ASSET_IO_CONCURRENCY, async (groupPath, groupIndex) => {
    const groupBuffer = await mpqReader.readFileFromMpqs(dataPath, groupPath);
    if (!groupBuffer) return [];
    return parseWmoGroup(Buffer.from(groupBuffer), materials, groupIndex);
  });
  const rawMeshes = groupMeshes.flat();
  if (!rawMeshes.length) rawMeshes.push(...parseWmoGroup(root, materials, -1));
  const groupDoodadRefs = {};
  const groupLiquids = {};
  const groups = {};
  for (const mesh of rawMeshes) {
    if (mesh.groupIndex < 0) continue;
    if (!groupDoodadRefs[mesh.groupIndex] && mesh.doodadRefs?.length) groupDoodadRefs[mesh.groupIndex] = mesh.doodadRefs;
    if (!groupLiquids[mesh.groupIndex] && mesh.liquid) groupLiquids[mesh.groupIndex] = mesh.liquid;
    if (!groups[mesh.groupIndex]) groups[mesh.groupIndex] = {
      groupIndex: mesh.groupIndex,
      flags: mesh.groupFlags || 0,
      portalRefStart: mesh.portalRefStart || 0,
      portalRefCount: mesh.portalRefCount || 0,
    };
  }
  const meshes = rawMeshes.map(({ doodadRefs, liquid, ...mesh }) => mesh);

  const texturePaths = includeTextures
    ? [...new Set(meshes
      .flatMap(mesh => {
        const material = materials[mesh.materialIndex];
        const textureCount = wmoShaderTextureCount(material?.shader);
        return [material?.texturePath, material?.texturePath2, material?.texturePath3].slice(0, textureCount);
      })
      .filter(Boolean))]
    : [];
  const decoded = new Map();
  const decodedTextures = await mapConcurrent(texturePaths, ASSET_IO_CONCURRENCY, async texturePath => {
    try {
      const buffer = await mpqReader.readBlpFromMpqs(dataPath, texturePath);
      if (!buffer) return null;
      const { rgba, w, h } = decodeBLP(Buffer.from(buffer));
      return [texturePath.toLowerCase(), { textureRgba: new Uint8Array(rgba), textureW: w, textureH: h }];
    } catch (_) { return null; }
  });
  for (const entry of decodedTextures) if (entry) decoded.set(entry[0], entry[1]);
  const result = {
    modelPath: normalizedPath,
    skyboxPath,
    portalData: portalData ? { ...portalData, groups } : null,
    groupDoodadRefs,
    groupLiquids,
    ...doodadData,
    materials: materials.map(material => ({
      flags: material.flags,
      shader: material.shader,
      blendMode: material.blendMode,
      texturePath: material.texturePath,
      texturePath2: material.texturePath2,
      texturePath3: material.texturePath3,
      ...(material.texturePath ? (decoded.get(material.texturePath.toLowerCase()) || {}) : {}),
      ...(material.texturePath2 ? Object.fromEntries(Object.entries(decoded.get(material.texturePath2.toLowerCase()) || {}).map(([key, value]) => [key.replace(/^texture/, 'texture2'), value])) : {}),
      ...(material.texturePath3 ? Object.fromEntries(Object.entries(decoded.get(material.texturePath3.toLowerCase()) || {}).map(([key, value]) => [key.replace(/^texture/, 'texture3'), value])) : {}),
    })),
    meshes,
  };
  return result;
}

parentPort.on('message', async ({ id, type, payload }) => {
  try {
    if (type === 'decodeBlps') {
      const { dataPath, entries } = payload;
      const ioConcurrency = Math.max(1, Math.min(8, Number(payload?.ioConcurrency) || ASSET_IO_CONCURRENCY));
      const decoded = await mapConcurrent(entries || [], ioConcurrency, async ({ textureIdx, path }) => {
        try {
          const buffer = await mpqReader.readBlpFromMpqs(dataPath, path);
          if (!buffer) return { textureIdx, missing: true };
          const { rgba, w, h } = decodeBLP(Buffer.from(buffer));
          return { textureIdx, data: new Uint8Array(rgba), w, h };
        } catch (_) {
          return { textureIdx, missing: true };
        }
      });
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
      const rows = await mapConcurrent(tiles || [], ASSET_IO_CONCURRENCY, async ({ tileX, tileY }) => {
        const buffer = await mpqReader.readAdtBuffer(dataPath, mapName, tileY, tileX);
        return buffer ? { tileX, tileY, ...parseAdtPlacements(Buffer.from(buffer)) } : null;
      });
      const result = rows.filter(Boolean);
      parentPort.postMessage({ id, result });
      return;
    }

    if (type === 'readWmoAsset') {
      const result = await readWmoAsset(payload.dataPath, payload.modelPath, payload.includeTextures !== false);
      const transfer = [];
      const transferred = new Set();
      const addTransfer = value => {
        const buffer = value?.buffer;
        if (!buffer || transferred.has(buffer)) return;
        transferred.add(buffer);
        transfer.push(buffer);
      };
      for (const mesh of result?.meshes || []) {
        for (const key of ['positions', 'normals', 'uvs', 'uvs2', 'colors', 'indices']) addTransfer(mesh[key]);
      }
      for (const material of result?.materials || []) {
        for (const key of ['textureRgba', 'texture2Rgba', 'texture3Rgba']) addTransfer(material[key]);
      }
      for (const liquid of Object.values(result?.groupLiquids || {})) {
        addTransfer(liquid?.heights);
        addTransfer(liquid?.tileFlags);
      }
      parentPort.postMessage({ id, result }, transfer);
      return;
    }

    throw new Error(`Unknown asset task: ${type}`);
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
