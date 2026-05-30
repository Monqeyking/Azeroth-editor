function readSkinArray(buf, headerOff) {
  return { count: buf.readUInt32LE(headerOff), offset: buf.readUInt32LE(headerOff + 4) };
}

function parseSkinFile(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'SKIN') return null;

  const vertices = readSkinArray(buf, 4);
  const indices = readSkinArray(buf, 12);
  const subArr = readSkinArray(buf, 28);

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

  return { vertexLookup, indexLookup, submeshes };
}

function geosetGroup(meshId) {
  return meshId < 100 ? -1 : Math.floor(meshId / 100);
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
      if (ids.includes(0)) visible.add(0);
      continue;
    }
    visible.add(ids.find(id => id % 100 === 1) ?? ids[0]);
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

function filterSubmeshesByVisible(submeshes, visible, allowDefaultForUnsetGroups) {
  const allIds = submeshes.map(s => s.id);
  const filtered = new Set();
  for (const sm of submeshes) {
    const g = geosetGroup(sm.id);
    if (g === -1) {
      if (visible.has(sm.id)) filtered.add(sm.id);
      continue;
    }
    const groupIds = allIds.filter(id => geosetGroup(id) === g);
    const picked = groupIds.filter(id => visible.has(id));
    if (picked.length > 0) {
      if (picked.includes(sm.id)) filtered.add(sm.id);
    } else if (allowDefaultForUnsetGroups) {
      filtered.add(groupIds.find(id => id % 100 === 1) ?? groupIds[0]);
    }
  }
  return filtered;
}

function resolveCharacterNpcGeosets(submeshes, cdi, extra, charHairRows, facialHairRows) {
  const groups = groupSubmeshIds(submeshes);
  const visible = defaultVisibleGeosets(submeshes);

  for (const id of geosetsFromBitmask(cdi?.creatureGeosetData)) {
    setGroupGeoset(visible, groups, id);
  }
  setGroupGeoset(visible, groups, 101 + (extra.face ?? 0));

  const hairGeoset = findCharHairGeoset(charHairRows, extra.race, extra.sex, extra.hairStyle);
  if (hairGeoset) setGroupGeoset(visible, groups, hairGeoset);

  const facialGeoset = findCharHairGeoset(facialHairRows, extra.race, extra.sex, extra.facialHair);
  if (facialGeoset) setGroupGeoset(visible, groups, facialGeoset);

  return filterSubmeshesByVisible(submeshes, visible, false);
}

function resolveVisibleGeosets(submeshes, cdi, extra, charHairRows, facialHairRows) {
  if (extra) {
    return resolveCharacterNpcGeosets(submeshes, cdi, extra, charHairRows, facialHairRows);
  }

  const visible = geosetsFromBitmask(cdi?.creatureGeosetData);
  if (visible.size === 0) return defaultVisibleGeosets(submeshes);
  return filterSubmeshesByVisible(submeshes, visible, true);
}

function buildGeosetDebugInfo(submeshes, visible, cdi, extra, charHairRows, facialHairRows) {
  const allIds = submeshes.map(s => s.id).sort((a, b) => a - b);
  const visibleIds = [...visible].sort((a, b) => a - b);
  const hairGeoset = extra
    ? findCharHairGeoset(charHairRows, extra.race, extra.sex, extra.hairStyle)
    : null;
  const facialGeoset = extra
    ? findCharHairGeoset(facialHairRows, extra.race, extra.sex, extra.facialHair)
    : null;

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
    resolvedFaceGeoset: extra ? 101 + (extra.face ?? 0) : null,
    resolvedHairGeoset: hairGeoset,
    resolvedFacialGeoset: facialGeoset,
    allSubmeshIds: allIds,
    visibleGeosetIds: visibleIds,
    hiddenGeosetIds: allIds.filter(id => !visible.has(id)),
  };
}

function buildIndicesFromSkin(skin, visibleIds) {
  const { vertexLookup, indexLookup, submeshes } = skin;
  const out = [];
  for (const sm of submeshes) {
    if (!visibleIds.has(sm.id)) continue;
    for (let i = 0; i < sm.indexCount; i++) {
      const triIdx = indexLookup[sm.indexStart + i];
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
  return parseCharHairGeosets(dbc);
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
  resolveVisibleGeosets,
  buildGeosetDebugInfo,
  buildIndicesFromSkin,
  parseCharHairGeosets,
  parseFacialHairGeosets,
  parseCreatureDisplayInfoExtra,
  geosetsFromBitmask,
  geosetGroup,
  filterSubmeshesByVisible,
};
