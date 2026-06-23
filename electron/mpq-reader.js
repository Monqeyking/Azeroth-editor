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
  listfileCache.clear();
  blpDirCache.clear();
  fileFoundIn.clear();
  archiveDiscoveryCache.clear();
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
const zoneCache     = new Map();   // dataPath → string[]
const tileCache     = new Map();   // `dataPath|zone|idx` → Buffer
const fileFoundIn   = new Map();   // `${dataPath}|${lcPath}` → mpqAbsPath  (memoïseert welke archive een bestand bevat)
const archiveDiscoveryCache = new Map(); // `${dataPath}|${lcPath}` → mpqAbsPath | null  (listfile-miss discovery)

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
  catch (e) {
    console.log(`[mpq] open mislukt voor ${path.basename(mpqAbsPath)}: ${e.message}`);
    return null;
  }

  let buf = null;
  try {
    if (archive.hasFile(internalPath)) {
      const f   = archive.openFile(internalPath);
      const raw = f.read();
      // raw is een Uint8Array-view in WASM-heap; kopieer naar eigen ArrayBuffer
      // VÓÓR f.close()/archive.close() anders wordt het geheugen hergebruikt
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      buf = Buffer.from(copy.buffer, copy.byteOffset, copy.byteLength);
      f.close();
    }
  } catch (e) {
    console.log(`[mpq] hasFile/read fout in ${path.basename(mpqAbsPath)} voor ${internalPath}: ${e.message}`);
  }
  archive.close();
  return buf;
}

// ── Tile-buffer lezen (BLP) ────────────────────────────────────────────────────
// preferOldest: doorzoek archieven van oud naar nieuw (base-MPQ's vóór patches),
// zodat de ORIGINELE (pre-WotLK) versie van een bestand gevonden wordt als die nog
// onaangetast in een vroeg archief zit — bijv. de vanilla World-overview tiles
// zonder Northrend, die in lichking.mpq/patch-3.mpq zijn overschreven.
async function readTileBuffer(dataPath, zoneName, tileIndex, preferOldest = false) {
  const key = `${dataPath}|${zoneName}|${tileIndex}|${preferOldest ? 'old' : 'new'}`;
  if (tileCache.has(key)) return tileCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `Interface\\WorldMap\\${zoneName}\\${zoneName}${tileIndex}.blp`;

  const mpqFiles = findMpqFiles(dataPath);
  const order = preferOldest ? [...mpqFiles].reverse() : mpqFiles;

  for (const mpqPath of order) {
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
const adtCache = new Map(); // key → Buffer | null (negative cache voor ontbrekende tiles)
const ADT_CACHE_MAX = 128;

const adtIndexCache = new Map();
const adtIndexInFlight = new Map();

async function buildAdtIndex(dataPath) {
  if (adtIndexCache.has(dataPath)) return adtIndexCache.get(dataPath);
  if (adtIndexInFlight.has(dataPath)) return adtIndexInFlight.get(dataPath);
  const p = _indexFromListfile(dataPath, '.adt').then(idx => { adtIndexCache.set(dataPath, idx); return idx; });
  adtIndexInFlight.set(dataPath, p);
  return p;
}

// ── WDL: low-res heightmap van de hele map (voor verre terrein-weergave) ──────
const wdlCache = new Map();
const wdlIndexCache = new Map();
const wdlIndexInFlight = new Map();

async function buildWdlIndex(dataPath) {
  if (wdlIndexCache.has(dataPath)) return wdlIndexCache.get(dataPath);
  if (wdlIndexInFlight.has(dataPath)) return wdlIndexInFlight.get(dataPath);
  const p = _indexFromListfile(dataPath, '.wdl').then(idx => { wdlIndexCache.set(dataPath, idx); return idx; });
  wdlIndexInFlight.set(dataPath, p);
  return p;
}

async function readWdlBuffer(dataPath, mapName) {
  const key = `${dataPath}|${mapName}`;
  if (wdlCache.has(key)) return wdlCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `World\\Maps\\${mapName}\\${mapName}.wdl`;

  let buf = null;
  const index = await buildWdlIndex(dataPath);
  const mpqAbsPath = index.get(internalPath.toLowerCase());
  if (mpqAbsPath) {
    buf = await readFileFromMpqEntry(dataPath, mpqAbsPath, internalPath);
  } else if (index.size === 0) {
    buf = await readFileFromMpqs(dataPath, internalPath);
  }
  wdlCache.set(key, buf);
  return buf;
}

// ── WDT: per-map header, o.a. MPHD.flags (bigAlpha) ───────────────────────────
const wdtCache = new Map();
const wdtIndexCache = new Map();
const wdtIndexInFlight = new Map();

async function buildWdtIndex(dataPath) {
  if (wdtIndexCache.has(dataPath)) return wdtIndexCache.get(dataPath);
  if (wdtIndexInFlight.has(dataPath)) return wdtIndexInFlight.get(dataPath);
  const p = _indexFromListfile(dataPath, '.wdt').then(idx => { wdtIndexCache.set(dataPath, idx); return idx; });
  wdtIndexInFlight.set(dataPath, p);
  return p;
}

async function readWdtBuffer(dataPath, mapName) {
  const key = `${dataPath}|${mapName}`;
  if (wdtCache.has(key)) return wdtCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `World\\Maps\\${mapName}\\${mapName}.wdt`;

  let buf = null;
  const index = await buildWdtIndex(dataPath);
  const mpqAbsPath = index.get(internalPath.toLowerCase());
  if (mpqAbsPath) {
    buf = await readFileFromMpqEntry(dataPath, mpqAbsPath, internalPath);
  } else if (index.size === 0) {
    buf = await readFileFromMpqs(dataPath, internalPath);
  }
  wdtCache.set(key, buf);
  return buf;
}

async function readAdtBuffer(dataPath, mapName, tileX, tileY) {
  const key = `${dataPath}|${mapName}|${tileX}|${tileY}`;
  if (adtCache.has(key)) return adtCache.get(key);

  ensureMounted(dataPath);
  const internalPath = `World\\Maps\\${mapName}\\${mapName}_${tileX}_${tileY}.adt`;

  let buf = null;
  const index = await buildAdtIndex(dataPath);
  const mpqAbsPath = index.get(internalPath.toLowerCase());
  if (mpqAbsPath) {
    buf = await readFileFromMpqEntry(dataPath, mpqAbsPath, internalPath);
  } else if (index.size === 0) {
    // Geen listfiles beschikbaar — eenmalige fallback full scan
    for (const mpqPath of findMpqFiles(dataPath)) {
      buf = await readFileFromMpqEntry(dataPath, mpqPath, internalPath);
      if (buf) break;
    }
  }

  if (adtCache.size >= ADT_CACHE_MAX) {
    adtCache.delete(adtCache.keys().next().value);
  }
  adtCache.set(key, buf);
  return buf;
}

// ── Minimap BLP per ADT-tile ──────────────────────────────────────────────────
// Probeert eerst het directe pad, valt terug op md5translate.trs (hashed names).
const md5TransCache = new Map(); // dataPath → Map<lower "dir\mapX_Y.blp", hashedFilename>

async function getMd5Translate(dataPath) {
  if (md5TransCache.has(dataPath)) return md5TransCache.get(dataPath);
  const map = new Map();
  // Alleen lezen als de listfiles het bestand kennen — voorkomt zinloze full scans
  const allPaths = await collectListfilePaths(dataPath);
  const trsPath = allPaths.find(p => /(^|\\)md5translate\.(trs|txt)$/i.test(p));
  const buf = trsPath ? await readFileFromMpqs(dataPath, trsPath) : null;
  if (buf) {
    let dir = '';
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (t.toLowerCase().startsWith('dir:')) { dir = t.slice(4).trim(); continue; }
      const parts = t.split('\t');
      if (parts.length !== 2) continue;
      let plain = parts[0].replace(/\//g, '\\');
      if (dir && !plain.toLowerCase().startsWith(dir.toLowerCase() + '\\')) plain = `${dir}\\${plain}`;
      map.set(plain.toLowerCase(), parts[1].trim());
    }
  }
  md5TransCache.set(dataPath, map);
  return map;
}

async function readMinimapBlp(dataPath, mapName, tileX, tileY) {
  ensureMounted(dataPath);
  // Uitsluitend O(1) lookups via de BLP-index — nooit full MPQ scans per tile,
  // anders blokkeert het main process en hangt de hele app.
  const index = await buildBlpIndex(dataPath);

  const directKey = `world\\minimaps\\${mapName}\\map${tileX}_${tileY}.blp`.toLowerCase();
  const directMpq = index.get(directKey);
  if (directMpq) return await readFileFromMpqEntry(dataPath, directMpq, directKey);

  const trans = await getMd5Translate(dataPath);
  const hash = trans.get(`${mapName.toLowerCase()}\\map${tileX}_${tileY}.blp`);
  if (!hash) return null;
  const hashPath = (hash.includes('\\') ? hash : `textures\\Minimap\\${hash}`).toLowerCase();
  const hashMpq = index.get(hashPath);
  return hashMpq ? await readFileFromMpqEntry(dataPath, hashMpq, hashPath) : null;
}

function pathVariants(internalPath) {
  const p = internalPath.replace(/\//g, '\\');
  const variants = new Set([
    p,
    p.toUpperCase(),
    p.toLowerCase(),
    p.replace(/\\/g, '/'),
  ]);
  return [...variants];
}

async function readFileFromMpqs(dataPath, internalPath) {
  ensureMounted(dataPath);
  for (const variant of pathVariants(internalPath)) {
    const cacheKey = `${dataPath}|${variant.toLowerCase()}`;

    // Snelpad: we weten al in welke archive dit bestand zit
    if (fileFoundIn.has(cacheKey)) {
      const knownMpq = fileFoundIn.get(cacheKey);
      const buf = await readFileFromMpqEntry(dataPath, knownMpq, variant);
      if (buf) return buf;
      fileFoundIn.delete(cacheKey); // ongeldig geworden, opnieuw scannen
    }

    // Volledige scan — onthoud het resultaat voor volgende aanvraag
    for (const mpqPath of findMpqFiles(dataPath)) {
      const buf = await readFileFromMpqEntry(dataPath, mpqPath, variant);
      if (buf) {
        fileFoundIn.set(cacheKey, mpqPath);
        return buf;
      }
    }
  }
  return null;
}

const listfileCache = new Map();
const blpDirCache   = new Map();

function walkDirFiles(dir, prefix, out, ext) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) {
      walkDirFiles(full, prefix ? `${prefix}\\${entry}` : entry, out, ext);
    } else if (entry.toLowerCase().endsWith(ext)) {
      out.add(prefix ? `${prefix}\\${entry}` : entry);
    }
  }
}

function walkDirBlps(dir, prefix, out) {
  walkDirFiles(dir, prefix, out, '.blp');
}

async function collectListfilePaths(dataPath) {
  if (listfileCache.has(dataPath)) return listfileCache.get(dataPath);

  const paths = new Set();
  ensureMounted(dataPath);

  for (const mpqPath of findMpqFiles(dataPath)) {
    let stat;
    try { stat = fs.statSync(mpqPath); } catch (_) { continue; }

    if (stat.isDirectory()) {
      walkDirBlps(mpqPath, '', paths);
      continue;
    }

    let archive;
    try { archive = await MPQ.open(toStormPath(dataPath, mpqPath), 'r'); }
    catch (_) { continue; }

    try {
      if (archive.hasFile('(listfile)')) {
        const f   = archive.openFile('(listfile)');
        const raw = f.read();
        f.close();
        for (const line of Buffer.from(raw).toString('utf8').split(/\r?\n/)) {
          const t = line.trim();
          if (t) paths.add(t.replace(/\//g, '\\'));
        }
      }
    } catch (_) {}
    archive.close();
  }

  const result = [...paths];
  listfileCache.set(dataPath, result);
  return result;
}

// ── BLP pre-index: bouw een Map<blpPathLower, mpqAbsPath> in één pas over alle MPQs ─
const blpIndexCache = new Map();   // dataPath → Map<lowerPath, mpqAbsPath>
const blpIndexBuildInFlight = new Map();

function _indexFromListfile(dataPath, ext = '.blp') {
  return new Promise((resolve) => {
    const idx = new Map();
    const mpqs = findMpqFiles(dataPath);
    let i = 0;
    const next = () => {
      if (i >= mpqs.length) { resolve(idx); return; }
      const mpqPath = mpqs[i++];
      let stat;
      try { stat = fs.statSync(mpqPath); } catch (_) { return next(); }
      if (stat.isDirectory()) {
        const set = new Set();
        walkDirFiles(mpqPath, '', set, ext);
        for (const p of set) {
          const k = p.toLowerCase();
          if (!idx.has(k)) idx.set(k, mpqPath);
        }
        return setImmediate(next);
      }
      (async () => {
        let archive;
        try { archive = await MPQ.open(toStormPath(dataPath, mpqPath), 'r'); }
        catch (_) { return next(); }
        try {
          if (archive.hasFile('(listfile)')) {
            const f = archive.openFile('(listfile)');
            const raw = f.read();
            f.close();
            const text = Buffer.from(raw).toString('utf8');
            for (const line of text.split(/\r?\n/)) {
              const t = line.trim();
              if (!t) continue;
              if (!t.toLowerCase().endsWith(ext)) continue;
              const k = t.replace(/\//g, '\\').toLowerCase();
              if (!idx.has(k)) idx.set(k, mpqPath);
            }
          }
        } catch (_) {}
        archive.close();
        next();
      })();
    };
    next();
  });
}

async function buildBlpIndex(dataPath) {
  if (blpIndexCache.has(dataPath)) return blpIndexCache.get(dataPath);
  if (blpIndexBuildInFlight.has(dataPath)) return blpIndexBuildInFlight.get(dataPath);
  const p = _indexFromListfile(dataPath).then(idx => { blpIndexCache.set(dataPath, idx); return idx; });
  blpIndexBuildInFlight.set(dataPath, p);
  return p;
}

// Snelle BLP-lookup via listfile-index. Valt terug op readFileFromMpqs (full scan)
// als de index het bestand niet kent (geen listfile in die MPQ).
async function readBlpFromMpqs(dataPath, blpPath) {
  const index = await buildBlpIndex(dataPath);
  const key = blpPath.replace(/\//g, '\\').toLowerCase();
  const mpqAbsPath = index.get(key);
  if (mpqAbsPath) return await readFileFromMpqEntry(dataPath, mpqAbsPath, blpPath);
  return await readFileFromMpqs(dataPath, blpPath);
}

// Open een MPQ-archief één keer en geef een sync read-interface terug.
// Bedoeld voor batch-gebruik waar je meerdere bestanden uit dezelfde MPQ nodig hebt
// zonder steeds opnieuw te openen/sluiten.
async function openArchive(dataPath, mpqAbsPath) {
  let stat;
  try { stat = fs.statSync(mpqAbsPath); } catch (e) { return null; }
  if (stat.isDirectory()) {
    // Loose map: sync readFileSync per path
    return {
      kind: 'dir',
      hasFile: (p) => {
        const filePath = path.join(mpqAbsPath, ...p.split(/[\\\/]/));
        try { return fs.existsSync(filePath); } catch (_) { return false; }
      },
      readFile: (p) => {
        const filePath = path.join(mpqAbsPath, ...p.split(/[\\\/]/));
        return fs.readFileSync(filePath);
      },
      close: () => {},
    };
  }
  let archive;
  try { archive = await MPQ.open(toStormPath(dataPath, mpqAbsPath), 'r'); }
  catch (_) { return null; }
  return {
    kind: 'mpq',
    hasFile: (p) => {
      try { return archive.hasFile(p); } catch (_) { return false; }
    },
    readFile: (p) => {
      if (!archive.hasFile(p)) return null;
      const f = archive.openFile(p);
      const raw = f.read();
      f.close();
      return Buffer.from(raw);
    },
    close: () => { try { archive.close(); } catch (_) {} },
  };
}

function listBlpInDir(allPaths, dirPrefix) {
  const norm = dirPrefix.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return allPaths.filter((p) => {
    const pl = p.replace(/\//g, '\\').toLowerCase();
    if (!pl.startsWith(norm + '\\') && pl !== norm) return false;
    return pl.endsWith('.blp');
  });
}

function rankCreatureBlp(blpPath, stem) {
  const name = (blpPath.split(/[\\\/]/).pop() || '').toLowerCase();
  const stemL = stem.toLowerCase();
  if (/particle|reflect|glow|environ|sparkle|trail/i.test(name)) return 100;
  if (name === `${stemL}.blp`) return 0;
  if (name.startsWith(stemL) && name.includes('skin')) return 1;
  if (name.includes(stemL)) return 2;
  return 50;
}

async function discoverCreatureBlps(dataPath, modelDir, stem) {
  const dirKey = modelDir.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  if (blpDirCache.has(dirKey)) return blpDirCache.get(dirKey);

  const all = await collectListfilePaths(dataPath);
  const inDir = listBlpInDir(all, modelDir);
  const sorted = inDir.sort((a, b) => rankCreatureBlp(a, stem) - rankCreatureBlp(b, stem));
  blpDirCache.set(dirKey, sorted);
  return sorted;
}

// Vind in welke MPQ-archive(s) de opgegeven BLP-paden zitten. Bedoeld als fallback
// voor paden die NIET in de listfile staan (de listfile is namelijk niet altijd
// compleet — texture varianten 09..17 staan er bijv. vaak niet in).
// Opent elke MPQ maximaal 1× en checkt alle pads via hasFile (cheap, geen read).
// Resultaat: Map<mpqAbsPath, [blpPath, ...]> — pads die nergens gevonden worden
// worden weggelaten. Cache: per pad wordt het resultaat opgeslagen in
// archiveDiscoveryCache zodat herhaalde lookups direct zijn.
async function findArchivesForPaths(dataPath, blpPaths) {
  const result = new Map();
  const needLookup = [];
  for (const blpPath of blpPaths) {
    if (!blpPath) continue;
    const k = blpPath.replace(/\//g, '\\').toLowerCase();
    const ck = `${dataPath}|${k}`;
    if (archiveDiscoveryCache.has(ck)) {
      const mpqPath = archiveDiscoveryCache.get(ck);
      if (mpqPath) {
        if (!result.has(mpqPath)) result.set(mpqPath, []);
        result.get(mpqPath).push(blpPath);
      }
    } else {
      needLookup.push(blpPath);
    }
  }
  if (!needLookup.length) return result;

  const remaining = new Set(needLookup);
  for (const mpqPath of findMpqFiles(dataPath)) {
    if (!remaining.size) break;

    let stat;
    try { stat = fs.statSync(mpqPath); } catch (_) { continue; }

    if (stat.isDirectory()) {
      // Loose MPQ-map: direct op filesystem
      for (const blpPath of [...remaining]) {
        const filePath = path.join(mpqPath, ...blpPath.split(/[\\\/]/));
        try {
          if (fs.existsSync(filePath)) {
            if (!result.has(mpqPath)) result.set(mpqPath, []);
            result.get(mpqPath).push(blpPath);
            remaining.delete(blpPath);
            const k = blpPath.replace(/\//g, '\\').toLowerCase();
            archiveDiscoveryCache.set(`${dataPath}|${k}`, mpqPath);
          }
        } catch (_) {}
      }
      continue;
    }

    // Normale MPQ: open 1× en check alle remaining pads
    let archive;
    try { archive = await MPQ.open(toStormPath(dataPath, mpqPath), 'r'); }
    catch (_) { continue; }
    try {
      for (const blpPath of [...remaining]) {
        let has = false;
        try { has = archive.hasFile(blpPath); } catch (_) { has = false; }
        if (has) {
          if (!result.has(mpqPath)) result.set(mpqPath, []);
          result.get(mpqPath).push(blpPath);
          remaining.delete(blpPath);
          const k = blpPath.replace(/\//g, '\\').toLowerCase();
          archiveDiscoveryCache.set(`${dataPath}|${k}`, mpqPath);
        } else {
          // Negatief cachen zodat we niet elke keer opnieuw voor niets scannen
          const k = blpPath.replace(/\//g, '\\').toLowerCase();
          if (!archiveDiscoveryCache.has(`${dataPath}|${k}`)) {
            archiveDiscoveryCache.set(`${dataPath}|${k}`, null);
          }
        }
      }
    } finally {
      try { archive.close(); } catch (_) {}
    }
  }
  return result;
}

module.exports = {
  isDataPath, findMpqFiles, listWorldmapZones, readTileBuffer, readAdtBuffer, readMinimapBlp, readWdlBuffer, readWdtBuffer,
  validateDataPath, readFileFromMpqs, readBlpFromMpqs, collectListfilePaths, discoverCreatureBlps,
  buildBlpIndex, openArchive, findArchivesForPaths,
};
