const PORTAL_DISPLAY_IDS = new Set([672, 8243, 8275, 8276, 8196, 8197]);
const GRID_SIZE = 533.33333;
const MAP_BY_DIRECTORY = { Azeroth: 0, Kalimdor: 1, Outland: 530, Northrend: 571 };
const ENTRANCE_WMO_HINTS = {
  ragefirechasm: ['ogrimmar'],
  deadminesinstance: ['deadmines'],
  shadowfangkeep: ['shadowfang'],
  wailingcaverns: ['barrens', 'wailing'],
  blackfathomdeeps: ['ashenvale', 'blackfathom'],
  stockades: ['stormwind'],
  scarletmonastery: ['scarlet'],
  razorfenkraul: ['razorfen'],
  razorfen: ['razorfen'],
  uldaman: ['badlands', 'uldaman'],
  zulfarrak: ['tanaris', 'zulfarrak'],
  maraudon: ['desolace', 'maraudon'],
  diremaul: ['feralas', 'diremaul'],
  stratholme: ['easternplaguelands', 'stratholme'],
  scholomance: ['westernplaguelands', 'scholomance'],
  blackrockdepths: ['blackrock', 'burningsteppes'],
  moltencore: ['blackrock', 'burningsteppes'],
  karazhan: ['deadwind', 'karazhan'],
};
const ENTRANCE_SOURCE_DIRECTORIES = {
  ragefirechasm: ['Kalimdor'],
  deadminesinstance: ['Azeroth'],
  shadowfangkeep: ['Azeroth'],
  wailingcaverns: ['Kalimdor'],
  blackfathomdeeps: ['Kalimdor'],
  stockades: ['Azeroth'],
  scarletmonastery: ['Azeroth'],
  razorfenkraul: ['Kalimdor'],
  razorfen: ['Kalimdor'],
  uldaman: ['Kalimdor'],
  zulfarrak: ['Kalimdor'],
  maraudon: ['Kalimdor'],
  diremaul: ['Kalimdor'],
  stratholme: ['Azeroth'],
  scholomance: ['Azeroth'],
  blackrockdepths: ['Azeroth'],
  moltencore: ['Azeroth'],
  karazhan: ['Azeroth'],
};

const scanCache = new Map();
const adtIndexCache = new Map();

function chunkEntries(buffer, callback) {
  for (let offset = 0; offset + 8 <= buffer.length;) {
    const tag = buffer.toString('ascii', offset, offset + 4).split('').reverse().join('');
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + size);
    callback(tag, start, end - start);
    offset = start + size;
  }
}

function readStringList(buffer, start, size) {
  const result = new Map();
  let offset = 0;
  while (offset < size) {
    const end = buffer.indexOf(0, start + offset);
    if (end < 0 || end >= start + size) break;
    result.set(offset, buffer.toString('utf8', start + offset, end));
    offset = end - start + 1;
  }
  return result;
}

function parseWmo(buffer) {
  if (!buffer) return null;
  let names = new Map();
  const doodads = [];
  chunkEntries(buffer, (tag, start, size) => {
    if (tag === 'MODN') names = readStringList(buffer, start, size);
    if (tag !== 'MODD') return;
    for (let offset = 0; offset + 40 <= size; offset += 40) {
      const p = start + offset;
      doodads.push({
        nameIndex: buffer.readUInt32LE(p) & 0xffffff,
        position: [buffer.readFloatLE(p + 4), buffer.readFloatLE(p + 8), buffer.readFloatLE(p + 12)],
        quaternion: [buffer.readFloatLE(p + 16), buffer.readFloatLE(p + 20), buffer.readFloatLE(p + 24), buffer.readFloatLE(p + 28)],
        scale: buffer.readFloatLE(p + 32),
      });
    }
  });
  return { names, doodads };
}

function parseAdt(buffer) {
  if (!buffer) return null;
  let wmoNames = [];
  let instances = [];
  chunkEntries(buffer, (tag, start, size) => {
    if (tag === 'MWMO') {
      const names = readStringList(buffer, start, size);
      wmoNames = [...names.values()];
    }
    if (tag !== 'MODF') return;
    for (let offset = 0; offset + 64 <= size; offset += 64) {
      const p = start + offset;
      instances.push({
        id: buffer.readUInt32LE(p),
        position: [buffer.readFloatLE(p + 8), buffer.readFloatLE(p + 12), buffer.readFloatLE(p + 16)],
        rotation: [buffer.readFloatLE(p + 20), buffer.readFloatLE(p + 24), buffer.readFloatLE(p + 28)],
        doodadSet: buffer.readUInt16LE(p + 56),
      });
    }
  });
  return { wmoNames, instances };
}

function multiply(a, b) {
  return [0, 1, 2].map(row => [0, 1, 2].map(col =>
    a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col]
  ));
}

function apply(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function rotX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function wmoRotation(rotation) {
  const deg = Math.PI / 180;
  return multiply(rotZ(rotation[1] * deg), multiply(rotY(rotation[0] * deg), rotX(rotation[2] * deg)));
}

function quaternionRotation([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function normalizeAngle(angle) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function portalFromDoodad(doodad, instance, mapId, mapDirectory, wmoPath, tile) {
  const parentPosition = [instance.position[2], instance.position[0], instance.position[1]];
  const parentRotation = wmoRotation(instance.rotation);
  const localPosition = apply(parentRotation, doodad.position);
  const internal = parentPosition.map((value, index) => value + localPosition[index]);
  const base = 32 * GRID_SIZE;
  const combinedRotation = multiply(quaternionRotation(doodad.quaternion), parentRotation);
  const orientation = normalizeAngle(Math.atan2(combinedRotation[1][0], combinedRotation[0][0]));
  return {
    source: 'wmo',
    mapId,
    mapDirectory,
    x: base - internal[0],
    y: base - internal[1],
    z: internal[2],
    orientation,
    scale: Math.max(0.01, Number(doodad.scale) || 1),
    modelPath: doodad.modelPath,
    wmoPath,
    tile,
  };
}

function normalizePath(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function rootWmoPath(value) {
  const normalized = normalizePath(value);
  return normalized.replace(/_\d{3}\.wmo$/i, '.wmo');
}

async function scanWmoPortals(dataPath, mapId, mapDirectory, expansion, mpqReader) {
  const cacheKey = `${dataPath}|${mapId}|${mapDirectory}|${expansion}`;
  if (scanCache.has(cacheKey)) return scanCache.get(cacheKey);

  const allPaths = await mpqReader.collectListfilePaths(dataPath);
  const directoryKey = normalizePath(mapDirectory).replace(/[^a-z0-9]/g, '');
  const hints = new Set([directoryKey, directoryKey.replace(/instance|dungeon|raid/g, ''), ...(ENTRANCE_WMO_HINTS[directoryKey] || [])].filter(token => token.length >= 4));
  const wmoPaths = [...new Set(allPaths.map(normalizePath))]
    .filter(file => file.endsWith('.wmo') && !/_\d{3}\.wmo$/i.test(file) && [...hints].some(token => file.replace(/[^a-z0-9]/g, '').includes(token)));
  const portalWmos = new Map();
  for (const wmoPath of wmoPaths) {
    const parsed = parseWmo(await mpqReader.readFileFromMpqs(dataPath, wmoPath));
    if (!parsed) continue;
    const portalDoodads = parsed.doodads
      .map(doodad => ({ ...doodad, modelPath: parsed.names.get(doodad.nameIndex) || '' }))
      .filter(doodad => /instanceportal/i.test(doodad.modelPath));
    if (portalDoodads.length) portalWmos.set(rootWmoPath(wmoPath), portalDoodads);
  }

  const sourceDirectories = ENTRANCE_SOURCE_DIRECTORIES[directoryKey] || (expansion >= 2
    ? ['Azeroth', 'Kalimdor', 'Outland', 'Northrend']
    : expansion >= 1 ? ['Azeroth', 'Kalimdor', 'Outland'] : ['Azeroth', 'Kalimdor']);
  const adtCacheKey = `${dataPath}|${sourceDirectories.join(',')}`;
  let adtIndex = adtIndexCache.get(adtCacheKey);
  if (!adtIndex) {
    const adtPaths = [...new Set(allPaths.map(normalizePath))].filter(file => file.endsWith('.adt'));
    adtIndex = [];
    for (const adtPath of adtPaths) {
      const match = adtPath.match(/^world\\maps\\([^\\]+)\\([^\\]+)_(\d+)_(\d+)\.adt$/i);
      if (!match || !sourceDirectories.some(name => name.toLowerCase() === match[1].toLowerCase())) continue;
      const mapName = match[1];
      const tile = { x: Number(match[3]), y: Number(match[4]) };
      const adt = parseAdt(await mpqReader.readAdtBuffer(dataPath, mapName, tile.x, tile.y));
      if (adt) adtIndex.push({ mapName, tile, adt });
    }
    adtIndexCache.set(adtCacheKey, adtIndex);
  }
  const candidates = [];
  for (const { mapName, tile, adt } of adtIndex) {
    for (const instance of adt.instances) {
      const wmoPath = rootWmoPath(adt.wmoNames[instance.id]);
      const doodads = portalWmos.get(wmoPath);
      if (!doodads) continue;
      const sourceMapId = MAP_BY_DIRECTORY[Object.keys(MAP_BY_DIRECTORY).find(key => key.toLowerCase() === mapName.toLowerCase())] ?? null;
      for (const doodad of doodads) candidates.push(portalFromDoodad(doodad, instance, sourceMapId, mapName, wmoPath, tile));
    }
  }

  const unique = [];
  const keys = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.mapId}|${candidate.x.toFixed(2)}|${candidate.y.toFixed(2)}|${candidate.z.toFixed(2)}`;
    if (!keys.has(key)) { keys.add(key); unique.push(candidate); }
  }
  unique.sort((a, b) => (a.modelPath.endsWith('instanceportal.mdx') ? -1 : 0) - (b.modelPath.endsWith('instanceportal.mdx') ? -1 : 0));
  const result = unique.slice(0, 50);
  scanCache.set(cacheKey, result);
  return result;
}

async function resolveHeroicPortalTransform({ dbConnection, mpqReader, dataPath, mapId, mapDirectory, expansion }) {
  const displayIds = [...PORTAL_DISPLAY_IDS];
  const placeholders = displayIds.map(() => '?').join(',');
  const [rows] = await dbConnection.execute(
    `SELECT g.guid, g.id AS entry, g.map, g.zoneId, g.areaId, g.position_x, g.position_y, g.position_z, g.orientation, gt.displayId, gt.name, gt.size
     FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id
     WHERE (gt.Data0 = ? AND gt.displayId IN (${placeholders})) OR gt.name LIKE ?
     ORDER BY CASE WHEN gt.displayId IN (8243, 672) THEN 0 ELSE 1 END, g.guid`,
    [Number(mapId), ...displayIds, `Azeroth Editor: Heroic Portal ${Number(mapId)}%`]
  );
  if (rows.length) {
    const row = rows[0];
    return {
      source: 'database',
      transform: {
        source: 'database', mapId: Number(row.map), zoneId: Number(row.zoneId), areaId: Number(row.areaId),
        x: Number(row.position_x), y: Number(row.position_y), z: Number(row.position_z),
        orientation: Number(row.orientation), scale: Math.max(0.01, Number(row.size) || 1),
        displayId: Number(row.displayId), entry: Number(row.entry), guid: Number(row.guid), name: row.name,
      },
      candidates: rows.slice(0, 50),
    };
  }
  if (!dataPath || !mpqReader?.isDataPath(dataPath)) return { source: 'none', transform: null, candidates: [], error: 'Client Data path is not configured or contains no MPQ files.' };
  const candidates = await scanWmoPortals(dataPath, mapId, mapDirectory, Number(expansion) || 0, mpqReader);
  return { source: candidates.length ? 'wmo' : 'none', transform: candidates[0] || null, candidates };
}

module.exports = { resolveHeroicPortalTransform };
