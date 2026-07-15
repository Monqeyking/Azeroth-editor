function readSkinArray(buf, headerOff) {
  return { count: buf.readUInt32LE(headerOff), offset: buf.readUInt32LE(headerOff + 4) };
}

function parseSkinFile(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'SKIN') return null;

  const vertices = readSkinArray(buf, 4);
  const indices = readSkinArray(buf, 12);
  const subArr = readSkinArray(buf, 28);
  const texArr = readSkinArray(buf, 36);

  const vertexLookup = [];
  for (let i = 0; i < vertices.count; i++)
    vertexLookup.push(buf.readUInt16LE(vertices.offset + i * 2));

  const indexLookup = [];
  for (let i = 0; i < indices.count; i++)
    indexLookup.push(buf.readUInt16LE(indices.offset + i * 2));

  const submeshes = [];
  for (let i = 0; i < subArr.count; i++) {
    const s = subArr.offset + i * 0x30;
    submeshes.push({
      id: buf.readUInt16LE(s),
      indexStart: buf.readUInt16LE(s + 8),
      indexCount: buf.readUInt16LE(s + 10),
    });
  }

  const textureUnits = [];
  for (let i = 0; i < texArr.count; i++) {
    const t = texArr.offset + i * 24;
    if (t + 24 > buf.length) break;
    textureUnits.push({ order: buf.readUInt16LE(t + 2), submeshIndex: buf.readUInt16LE(t + 4), shading: buf.readUInt16LE(t + 2), colorIndex: buf.readInt16LE(t + 8), flagsIndex: buf.readUInt16LE(t + 10), texUnit: buf.readUInt16LE(t + 12), mode: buf.readUInt16LE(t + 14), textureId: buf.readUInt16LE(t + 16), transId: buf.readUInt16LE(t + 20), texAnimId: buf.readUInt16LE(t + 22) });
  }

  return { vertexLookup, indexLookup, submeshes, textureUnits };
}

function geosetGroup(meshId) {
  if (meshId === 0) return -1;
  if (meshId < 100) return 0;
  return Math.floor(meshId / 100);
}

function groupSubmeshIds(submeshes) {
  const groups = new Map();
  for (const sm of submeshes) {
    const g = geosetGroup(sm.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(sm.id);
  }
  return groups;
}

function defaultVisibleGeosets(submeshes) {
  const visible = new Set();
  const groups = groupSubmeshIds(submeshes);
  for (const [g, ids] of groups) {
    if (g === -1) {
      for (const id of ids) visible.add(id);
      continue;
    }
    if (g === 12 || g === 17 || g === 18) continue;
    const candidate = ids.find(id => id % 100 === 1);
    if (candidate != null) visible.add(candidate);
  }
  return visible;
}

function geosetsFromBitmask(creatureGeosetData) {
  const visible = new Set();
  if (!creatureGeosetData) return visible;
  for (let g = 0; g < 8; g++) {
    const v = (creatureGeosetData >> (g * 4)) & 0xF;
    if (v > 0) visible.add(g * 100 + v);
  }
  return visible;
}

function findCharHairGeoset(rows, race, sex, variation) {
  if (variation == null) return null;
  const row = rows.find(r => r.race === race && r.sex === sex && r.variation === variation);
  return row?.geosetId ?? null;
}

function setGroupGeoset(visible, groups, geosetId) {
  if (geosetId == null) return;
  const g = geosetGroup(geosetId);
  if (g === -1) {
    visible.add(geosetId);
    return;
  }
  for (const id of groups.get(g) || []) visible.delete(id);
  visible.add(geosetId);
}

function clearGroup(visible, groups, group) {
  for (const id of groups.get(group) || []) visible.delete(id);
}

function filterSubmeshesByVisible(submeshes, visible, allowDefaultForUnsetGroups, skipFallbackGroups = new Set()) {
  const allIds = submeshes.map(s => s.id);
  const filtered = new Set();
  for (let i = 0; i < submeshes.length; i++) {
    const sm = submeshes[i];
    const g = geosetGroup(sm.id);
    if (g === -1) {
      if (visible.has(sm.id)) filtered.add(i);
      continue;
    }
    const groupIds = allIds.filter(id => geosetGroup(id) === g);
    const picked = groupIds.filter(id => visible.has(id));
    if (picked.length > 0) {
      if (picked.includes(sm.id)) filtered.add(i);
    } else if (allowDefaultForUnsetGroups && !skipFallbackGroups.has(g) && g !== 12 && g !== 17 && g !== 18) {
      const fallback = groupIds.find(id => id % 100 === 1);
      if (fallback != null && sm.id === fallback) filtered.add(i);
    }
  }
  return filtered;
}

function resolveCharacterNpcGeosets(submeshes, cdi, extra, charHairRows, facialHairRows) {
  const groups = groupSubmeshIds(submeshes);
  const visible = defaultVisibleGeosets(submeshes);
  const skipFallbackGroups = new Set();

  for (const id of geosetsFromBitmask(cdi?.creatureGeosetData)) {
    setGroupGeoset(visible, groups, id);
  }

  const hairGeoset = findCharHairGeoset(charHairRows, extra.race, extra.sex, extra.hairStyle);
  if (hairGeoset != null) {
    if (hairGeoset === 0) {
      clearGroup(visible, groups, 0);
      skipFallbackGroups.add(0);
    } else {
      setGroupGeoset(visible, groups, hairGeoset);
    }
  }

  const facialRow = findFacialHairRow(facialHairRows, extra.race, extra.sex, extra.facialHair);
  if (facialRow) {
    if (facialRow.geosets[0] > 0) setGroupGeoset(visible, groups, 100 + facialRow.geosets[0]);
    if (facialRow.geosets[1] > 0) setGroupGeoset(visible, groups, 300 + facialRow.geosets[1]);
    if (facialRow.geosets[2] > 0) setGroupGeoset(visible, groups, 200 + facialRow.geosets[2]);
  }

  return filterSubmeshesByVisible(submeshes, visible, true, skipFallbackGroups);
}

function findFacialHairRow(rows, race, sex, variation) {
  if (variation == null) return null;
  return rows.find(r => r.race === race && r.sex === sex && r.variation === variation) || null;
}

function resolveVisibleGeosets(submeshes, cdi, extra, charHairRows, facialHairRows) {
  if (extra) {
    return resolveCharacterNpcGeosets(submeshes, cdi, extra, charHairRows, facialHairRows);
  }

  const bitmask = geosetsFromBitmask(cdi?.creatureGeosetData);
  const visible = bitmask.size > 0 ? bitmask : defaultVisibleGeosets(submeshes);
  return filterSubmeshesByVisible(submeshes, visible, true);
}

function buildGeosetDebugInfo(submeshes, visible, cdi, extra, charHairRows, facialHairRows) {
  const allIds = submeshes.map(s => s.id).sort((a, b) => a - b);
  const visibleIds = [...new Set([...visible].map(i => submeshes[i]?.id).filter(Boolean))].sort((a, b) => a - b);
  const hairGeoset = extra
    ? findCharHairGeoset(charHairRows, extra.race, extra.sex, extra.hairStyle)
    : null;
  const facialRow = extra
    ? findFacialHairRow(facialHairRows, extra.race, extra.sex, extra.facialHair)
    : null;

  const visibleIdSet = new Set(visibleIds);
  return {
    mode: extra ? 'character-npc' : 'creature',
    creatureGeosetData: cdi?.creatureGeosetData ?? 0,
    creatureGeosetDataHex: `0x${(cdi?.creatureGeosetData ?? 0).toString(16).padStart(8, '0')}`,
    extendedDisplayInfoId: cdi?.extendedDisplayInfoId ?? 0,
    extra: extra ? {
      race: extra.race,
      sex: extra.sex,
      skin: extra.skin,
      face: extra.face,
      hairStyle: extra.hairStyle,
      hairColor: extra.hairColor,
      facialHair: extra.facialHair,
      bakeName: extra.bakeName || null,
    } : null,
    resolvedFaceGeoset: extra && facialRow ? 100 + facialRow.geosets[0] : null,
    resolvedHairGeoset: hairGeoset,
    resolvedFacialRow: facialRow?.geosets || null,
    allSubmeshIds: allIds,
    visibleGeosetIds: visibleIds,
    hiddenGeosetIds: allIds.filter(id => !visibleIdSet.has(id)),
  };
}

function buildIndicesFromSkin(skin, visibleIndices) {
  const { vertexLookup, indexLookup, submeshes } = skin;
  const out = [];
  for (let i = 0; i < submeshes.length; i++) {
    if (!visibleIndices.has(i)) continue;
    const sm = submeshes[i];
    for (let j = 0; j < sm.indexCount; j++) {
      const triIdx = indexLookup[sm.indexStart + j];
      out.push(vertexLookup[triIdx] ?? 0);
    }
  }
  return out;
}

function parseCharHairGeosets(dbc) {
  const rows = [];
  if (!dbc) return rows;
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    rows.push({
      race: dbc.buf.readUInt32LE(off + 4),
      sex: dbc.buf.readUInt32LE(off + 8),
      variation: dbc.buf.readUInt32LE(off + 12),
      geosetId: dbc.buf.readUInt32LE(off + 16),
    });
  }
  return rows;
}

function parseFacialHairGeosets(dbc) {
  const rows = [];
  if (!dbc) return rows;
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    rows.push({
      race: dbc.buf.readUInt32LE(off),
      sex: dbc.buf.readUInt32LE(off + 4),
      variation: dbc.buf.readUInt32LE(off + 8),
      geosets: [
        dbc.buf.readUInt32LE(off + 12),
        dbc.buf.readUInt32LE(off + 16),
        dbc.buf.readUInt32LE(off + 20),
        dbc.buf.readUInt32LE(off + 24),
        dbc.buf.readUInt32LE(off + 28),
      ],
    });
  }
  return rows;
}

function parseCreatureDisplayInfoExtra(dbc, id) {
  if (!dbc || !id) return null;
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    if (dbc.buf.readUInt32LE(off) !== id) continue;
    let bakeName = '';
    for (const bakeOff of [80, 84, 72]) {
      if (bakeOff + 4 > dbc.recordSize) continue;
      const strOff = dbc.buf.readUInt32LE(off + bakeOff);
      for (const corr of [0, 1]) {
        const candidate = dbcStr(dbc, strOff, corr);
        if (candidate && candidate.length > 2 && !/^\d+$/.test(candidate)) {
          bakeName = candidate;
          break;
        }
      }
      if (bakeName) break;
    }
    return {
      race: dbc.buf.readUInt32LE(off + 4),
      sex: dbc.buf.readUInt32LE(off + 8),
      skin: dbc.buf.readUInt32LE(off + 12),
      face: dbc.buf.readUInt32LE(off + 16),
      hairStyle: dbc.buf.readUInt32LE(off + 20),
      hairColor: dbc.buf.readUInt32LE(off + 24),
      facialHair: dbc.buf.readUInt32LE(off + 28),
      bakeName,
    };
  }
  return null;
}

function dbcStr(dbc, offset, corr = 1) {
  if (!offset) return '';
  const pos = dbc.strStart + offset - corr;
  if (pos < dbc.strStart || pos >= dbc.buf.length) return '';
  let end = pos;
  while (end < dbc.buf.length && dbc.buf[end] !== 0) end++;
  return dbc.buf.toString('utf8', pos, end);
}

module.exports = {
  parseSkinFile,
  defaultVisibleGeosets,
  groupSubmeshIds,
  geosetGroup,
  setGroupGeoset,
  findCharHairGeoset,
  findFacialHairRow,
  resolveVisibleGeosets,
  buildGeosetDebugInfo,
  buildIndicesFromSkin,
  parseCharHairGeosets,
  parseFacialHairGeosets,
  parseCreatureDisplayInfoExtra,
  geosetsFromBitmask,
  filterSubmeshesByVisible,
};
