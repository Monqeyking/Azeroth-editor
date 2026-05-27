// MPQ reader — leest WoW client Data-mappen (root + enUS)
// Gebruikt @wowserhq/stormjs (StormLib via Emscripten/WASM)

const path = require('path');
const fs   = require('fs');

let stormLib = null;
let FS = null;
let MPQ = null;

function initStorm() {
  if (!stormLib) {
    stormLib = require('@wowserhq/stormjs');
    FS  = stormLib.FS;
    MPQ = stormLib.MPQ;
  }
}

// ── Mount-beheer ───────────────────────────────────────────────────────────────
const MOUNT_POINT = '/wow_data';
let mountedPath = null;

function ensureMounted(dataPath) {
  initStorm();
  if (mountedPath === dataPath) return;

  if (mountedPath) {
    try { FS.unmount(MOUNT_POINT); } catch (_) {}
    mountedPath = null;
  }

  try { FS.mkdir(MOUNT_POINT); } catch (_) {}
  FS.mount(FS.filesystems.NODEFS, { root: dataPath }, MOUNT_POINT);
  mountedPath = dataPath;

  // Zap caches bij pad-wijziging
  zoneCache.clear();
  tileCache.clear();
}

// ── MPQ-bestanden zoeken ───────────────────────────────────────────────────────
function mpqScore(filePath) {
  const name     = path.basename(filePath).toLowerCase();
  const isLocale = /[/\\]enus[/\\]/i.test(filePath);
  // Matcht: patch.mpq  patch-3.mpq  patch-12.mpq  patch-a.mpq  patch-enUS.mpq  patch-enUS-3.mpq
  const m = name.match(/^patch(?:-enus)?(?:-([0-9]+|[a-z]))?\.mpq$/);

  if (m) {
    const sfx = m[1];
    let n = 0;
    if (!sfx)              n = 0;
    else if (/^\d+$/.test(sfx)) n = parseInt(sfx, 10);
    else                   n = sfx.charCodeAt(0) - 96; // a=1 b=2 … z=26
    // Locale patches hebben hogere prioriteit dan non-locale (lager = eerder doorzocht)
    return (isLocale ? -1000 : 0) - n;
  }
  // Base-MPQ's altijd na alle patches
  return isLocale ? 300 : 200;
}

function findMpqFiles(dataPath) {
  const mpqs = [];

  for (const dir of [dataPath, path.join(dataPath, 'enUS')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.toLowerCase().endsWith('.mpq')) {
        mpqs.push(path.join(dir, entry));
      }
    }
  }

  return mpqs.sort((a, b) => mpqScore(a) - mpqScore(b));
}

// ── Detectie: is dit een Data-root met MPQ's? ─────────────────────────────────
function isDataPath(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  const entries = fs.readdirSync(dirPath);
  return entries.some(e => e.toLowerCase().endsWith('.mpq'));
}

// ── Emscripten-pad voor een absoluut MPQ-pad ───────────────────────────────────
function toStormPath(dataPath, mpqAbsPath) {
  const rel = path.relative(dataPath, mpqAbsPath).replace(/\\/g, '/');
  return `${MOUNT_POINT}/${rel}`;
}

// ── Caches ─────────────────────────────────────────────────────────────────────
const zoneCache = new Map();   // dataPath → string[]
const tileCache = new Map();   // `dataPath|zone|idx` → Buffer

// ── Zones ophalen via listfile ─────────────────────────────────────────────────
async function listWorldmapZones(dataPath) {
  if (zoneCache.has(dataPath)) return zoneCache.get(dataPath);

  ensureMounted(dataPath);
  const zones = new Set();

  for (const mpqPath of findMpqFiles(dataPath)) {
    let stat;
    try { stat = fs.statSync(mpqPath); } catch (_) { continue; }

    if (stat.isDirectory()) {
      // Loose MPQ-map: scan Interface/WorldMap subdirectories
      const wmDir = path.join(mpqPath, 'Interface', 'WorldMap');
      if (!fs.existsSync(wmDir)) continue;
      try {
        for (const entry of fs.readdirSync(wmDir)) {
          if (fs.statSync(path.join(wmDir, entry)).isDirectory()) zones.add(entry);
        }
      } catch (_) {}
      continue;
    }

    // Normaal MPQ-archief: lees via (listfile)
    let archive;
    try { archive = await MPQ.open(toStormPath(dataPath, mpqPath), 'r'); }
    catch (_) { continue; }

    try {
      if (archive.hasFile('(listfile)')) {
        const f    = archive.openFile('(listfile)');
        const raw  = f.read();
        f.close();
        const text = Buffer.from(raw).toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/Interface[\\\/]WorldMap[\\\/]([^\\\/]+)[\\\/]/i);
          if (m) zones.add(m[1]);
        }
      }
    } catch (_) {}
    archive.close();
  }

  const result = [...zones].sort();
  zoneCache.set(dataPath, result);
  return result;
}

// ── Bestand lezen uit MPQ-archief of loose MPQ-map ────────────────────────────
async function readFileFromMpqEntry(dataPath, mpqAbsPath, internalPath) {
  let stat;
  try { stat = fs.statSync(mpqAbsPath); } catch (_) { return null; }

  if (stat.isDirectory()) {
    // Loose MPQ-map: bestand direct van schijf lezen
    const parts    = internalPath.split(/[\\\/]/);
    const filePath = path.join(mpqAbsPath, ...parts);
    try { return fs.readFileSync(filePath); } catch (_) { return null; }
  }

  // Normaal MPQ-archief via StormLib
  let archive;
  try { archive = await MPQ.open(toStormPath(dataPath, mpqAbsPath), 'r'); }
  catch (_) { return null; }

  let buf = null;
  try {
    if (archive.hasFile(internalPath)) {
      const f   = archive.openFile(internalPath);
      const raw = f.read();
      f.close();
      buf = Buffer.from(raw);
    }
  } catch (_) {}
  archive.close();
  return buf;
}

// ── Tile-buffer lezen (BLP) ────────────────────────────────────────────────────
async function readTileBuffer(dataPath, zoneName, tileIndex) {
  const key = `${dataPath}|${zoneName}|${tileIndex}`;
  if (tileCache.has(key)) return tileCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `Interface\\WorldMap\\${zoneName}\\${zoneName}${tileIndex}.blp`;

  for (const mpqPath of findMpqFiles(dataPath)) {
    const buf = await readFileFromMpqEntry(dataPath, mpqPath, internalPath);
    if (buf) { tileCache.set(key, buf); return buf; }
  }
  return null;
}

// ── Validate: tel zones via MPQ listfiles ─────────────────────────────────────
async function validateDataPath(dataPath) {
  try {
    const zones = await listWorldmapZones(dataPath);
    if (zones.length === 0) {
      return { success: false, error: 'Geen WORLDMAP zones gevonden in MPQ bestanden' };
    }
    const mpqCount = findMpqFiles(dataPath).length;
    return {
      success: true,
      type: 'mpq',
      message: `${zones.length} zones gevonden in ${mpqCount} MPQ bestand(en)`,
      count: zones.length,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── ADT terrain bestanden lezen ───────────────────────────────────────────────
const adtCache = new Map();

async function readAdtBuffer(dataPath, mapName, tileX, tileY) {
  const key = `${dataPath}|${mapName}|${tileX}|${tileY}`;
  if (adtCache.has(key)) return adtCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `World\\Maps\\${mapName}\\${mapName}_${tileX}_${tileY}.adt`;

  for (const mpqPath of findMpqFiles(dataPath)) {
    const buf = await readFileFromMpqEntry(dataPath, mpqPath, internalPath);
    if (buf) { adtCache.set(key, buf); return buf; }
  }
  return null;
}

module.exports = { isDataPath, findMpqFiles, listWorldmapZones, readTileBuffer, readAdtBuffer, validateDataPath };
