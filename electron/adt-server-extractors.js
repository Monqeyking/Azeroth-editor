const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MAP_IDS = { kalimdor: 1, azeroth: 0, easternkingdoms: 0, outland: 530, northrend: 571 };

const SKIP_TOOL_DIRS = new Set(['data', 'logs', 'cache', 'maps', 'vmaps', 'mmaps', 'dbc', 'expansions', 'output', 'node_modules', '.git']);

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function mapIdForName(name) {
  return MAP_IDS[String(name || '').toLowerCase()];
}

function mapFileName(mapId, tileX, tileY) {
  return `${String(mapId).padStart(3, '0')}${String(tileY).padStart(2, '0')}${String(tileX).padStart(2, '0')}.map`;
}

function vmapTileFileName(mapId, tileX, tileY) {
  return `${String(mapId).padStart(3, '0')}_${String(tileX).padStart(2, '0')}_${String(tileY).padStart(2, '0')}.vmtile`;
}

function mmapTileFileName(mapId, tileX, tileY) {
  return `${String(mapId).padStart(3, '0')}${String(tileY).padStart(2, '0')}${String(tileX).padStart(2, '0')}.mmtile`;
}

function findExecutableRecursively(root, filename, preferredRoot = '') {
  const resolvedRoot = path.resolve(root || '');
  if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return null;
  const wanted = String(filename || '').toLowerCase();
  const queue = [];
  const seen = new Set();
  const enqueue = directory => {
    const resolved = path.resolve(directory);
    if (!seen.has(resolved)) { seen.add(resolved); queue.push(resolved); }
  };
  if (preferredRoot && inside(resolvedRoot, preferredRoot)) enqueue(preferredRoot);
  enqueue(resolvedRoot);
  let visited = 0;
  while (queue.length && visited < 5000) {
    const directory = queue.shift();
    visited += 1;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return path.join(directory, entry.name);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_TOOL_DIRS.has(entry.name.toLowerCase())) continue;
      enqueue(path.join(directory, entry.name));
    }
  }
  return null;
}

function resolveServerTools({ serverRoot, preferredRoot = '' } = {}) {
  const root = path.resolve(serverRoot || '');
  const preferred = preferredRoot && fs.existsSync(preferredRoot) ? path.resolve(preferredRoot) : '';
  const resolve = name => findExecutableRecursively(root, name, preferred);
  const vmapExtractor = resolve('vmap4_extractor.exe');
  const vmapAssembler = resolve('vmap4_assembler.exe');
  const mmapGenerator = resolve('mmaps_generator.exe');
  const configCandidates = [
    preferred ? path.join(preferred, 'mmaps-config.yaml') : '',
    vmapExtractor ? path.join(path.dirname(vmapExtractor), 'mmaps-config.yaml') : '',
    mmapGenerator ? path.join(path.dirname(mmapGenerator), 'mmaps-config.yaml') : '',
    path.join(root, 'mmaps-config.yaml'),
  ].filter(Boolean);
  const mmapsConfig = configCandidates.find(candidate => fs.existsSync(candidate)) || null;
  return { root, vmapExtractor, vmapAssembler, mmapGenerator, mmapsConfig };
}

function chunkType(buf, offset) {
  const direct = buf.toString('ascii', offset, offset + 4);
  const reverse = direct.split('').reverse().join('');
  return ['MMDX', 'MMID', 'MWMO', 'MWID', 'MDDF', 'MODF'].includes(direct) ? direct : reverse;
}

function topChunks(buf) {
  const chunks = [];
  for (let offset = 0; offset + 8 <= buf.length;) {
    const size = buf.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buf.length) break;
    chunks.push({ type: chunkType(buf, offset), offset, size });
    offset = end;
  }
  return chunks;
}

function chunkData(buf, chunk) {
  return buf.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.size);
}

function stringsFromChunk(data) {
  const result = [];
  let start = 0;
  for (let i = 0; i <= data.length; i++) {
    if (i === data.length || data[i] === 0) {
      result.push(data.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  return result.filter(Boolean);
}

function readObjectReferences(adtBuffer) {
  const chunks = topChunks(adtBuffer);
  const byType = new Map(chunks.map(chunk => [chunk.type, chunk]));
  const mmdx = byType.get('MMDX') ? stringsFromChunk(chunkData(adtBuffer, byType.get('MMDX'))) : [];
  const mwmo = byType.get('MWMO') ? stringsFromChunk(chunkData(adtBuffer, byType.get('MWMO'))) : [];
  const mddfData = byType.get('MDDF') ? chunkData(adtBuffer, byType.get('MDDF')) : Buffer.alloc(0);
  const modfData = byType.get('MODF') ? chunkData(adtBuffer, byType.get('MODF')) : Buffer.alloc(0);
  const m2 = [];
  const wmo = [];
  for (let offset = 0; offset + 36 <= mddfData.length; offset += 36) {
    const modelIndex = mddfData.readUInt32LE(offset);
    if (mmdx[modelIndex]) m2.push(mmdx[modelIndex]);
  }
  for (let offset = 0; offset + 64 <= modfData.length; offset += 64) {
    const modelIndex = modfData.readUInt32LE(offset);
    if (mwmo[modelIndex]) wmo.push(mwmo[modelIndex]);
  }
  return {
    m2: [...new Set(m2)].sort((a, b) => a.localeCompare(b)),
    wmo: [...new Set(wmo)].sort((a, b) => a.localeCompare(b)),
  };
}

function readObjectReferencesFromBuffers(buffers = []) {
  const m2 = new Set();
  const wmo = new Set();
  for (const buffer of buffers) {
    if (!Buffer.isBuffer(buffer)) continue;
    const refs = readObjectReferences(buffer);
    refs.m2.forEach(value => m2.add(value));
    refs.wmo.forEach(value => wmo.add(value));
  }
  return {
    m2: [...m2].sort((a, b) => a.localeCompare(b)),
    wmo: [...wmo].sort((a, b) => a.localeCompare(b)),
  };
}

function findServerModel(vmapsPath, modelPath, kind) {
  return path.join(vmapsPath, modelCollisionFileName(modelPath, kind));
}

function modelCollisionFileName(modelPath, kind) {
  const name = path.basename(String(modelPath || '').replace(/[\\/]+/g, path.sep));
  return kind === 'wmo' ? `${name}.vmo` : name;
}

function inspectVmapDependenciesBuffer({ adtBuffer, adtBuffers = [], adtEntries = [], serverVmapsPath, mapId, tileX, tileY, generatedVmapsPath = '' } = {}) {
  if (!serverVmapsPath || !fs.existsSync(serverVmapsPath)) throw new Error(`Server vmaps directory not found: ${serverVmapsPath}`);
  const refs = readObjectReferencesFromBuffers([adtBuffer, ...adtBuffers]);
  const generatedNames = new Set();
  if (generatedVmapsPath && fs.existsSync(generatedVmapsPath)) {
    for (const name of fs.readdirSync(generatedVmapsPath)) {
      if (path.extname(name).toLowerCase() === '.m2' || path.extname(name).toLowerCase() === '.vmo') generatedNames.add(name.toLowerCase());
    }
  }
  const models = [
    ...refs.m2.map(model => ({ kind: 'm2', model })),
    ...refs.wmo.map(model => ({ kind: 'wmo', model })),
  ].map(item => {
    const collisionFile = modelCollisionFileName(item.model, item.kind);
    const serverPath = path.join(serverVmapsPath, collisionFile);
    const exists = fs.existsSync(serverPath);
    const generated = !exists && generatedNames.has(collisionFile.toLowerCase());
    return { ...item, collisionFile, serverPath, exists, generated, status: exists ? 'available' : generated ? 'generated' : 'unresolved' };
  });
  const vmapTile = path.join(serverVmapsPath, vmapTileFileName(mapId, tileX, tileY));
  const available = models.filter(item => item.status === 'available');
  const generated = models.filter(item => item.status === 'generated');
  const unresolved = models.filter(item => item.status === 'unresolved');
  const generatedModelAssets = [...new Set(generated.map(item => item.collisionFile))];
  const message = models.length
    ? generatedVmapsPath
      ? `${available.length}/${models.length} model assets available in server vmaps; ${generated.length} generated in this build; ${unresolved.length} still unresolved. Missing asset counts are informational unless a newly added model remains unresolved.`
      : `${available.length}/${models.length} referenced model assets already have standalone server collision files. ${models.length - available.length} will be checked during VMap generation.`
    : 'The ADT contains no MDDF/MODF object references to validate.';
  const result = {
    mapId, tileX, tileY,
    references: models,
    missingModels: models.filter(item => !item.exists),
    missingServerAssets: models.filter(item => !item.exists),
    generatedModelAssets,
    unresolvedModels: unresolved,
    counts: { referenced: models.length, available: available.length, generated: generated.length, unresolved: unresolved.length },
    existingVmapTile: { path: vmapTile, exists: fs.existsSync(vmapTile), bytes: fs.existsSync(vmapTile) ? fs.statSync(vmapTile).size : 0 },
    phase: generatedVmapsPath ? 'post-generation' : 'pre-generation',
    message,
  };
  if (adtEntries.length) {
    result.perTile = adtEntries.map(entry => {
      const tileResult = inspectVmapDependenciesBuffer({
        adtBuffer: entry.buffer,
        serverVmapsPath,
        mapId,
        tileX: entry.tileX,
        tileY: entry.tileY,
        generatedVmapsPath,
      });
      return {
        tileX: Number(entry.tileX),
        tileY: Number(entry.tileY),
        counts: tileResult.counts,
        generatedModelAssets: tileResult.generatedModelAssets,
        unresolvedModels: tileResult.unresolvedModels.map(item => ({
          kind: item.kind,
          model: item.model,
          collisionFile: item.collisionFile,
          status: item.status,
        })),
      };
    });
  }
  return result;
}

function inspectVmapDependencies({ adtPath, adtBuffers = [], adtEntries = [], serverVmapsPath, mapId, tileX, tileY }) {
  if (!adtPath || !fs.existsSync(adtPath)) throw new Error(`ADT file not found: ${adtPath}`);
  return inspectVmapDependenciesBuffer({ adtBuffer: fs.readFileSync(adtPath), adtBuffers, adtEntries, serverVmapsPath, mapId, tileX, tileY });
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function linkOrCopyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.linkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
  }
  return true;
}

function linkOrCopyReplacing(source, destination) {
  if (!fs.existsSync(source)) return false;
  try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch { /* overwrite below will report a useful error */ }
  return linkOrCopyIfPresent(source, destination);
}

function listFilesRecursively(root) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const source = path.join(current, entry.name);
      if (entry.isDirectory()) visit(source);
      else if (entry.isFile()) files.push(source);
    }
  };
  visit(root);
  return files;
}

function stageMmapVmaps(serverVmapsPath, generatedVmapsPath, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const baseFiles = listFilesRecursively(serverVmapsPath);
  const generatedFiles = listFilesRecursively(generatedVmapsPath);
  const relativeName = (root, filePath) => path.relative(root, filePath);

  for (const source of baseFiles) {
    linkOrCopyIfPresent(source, path.join(destinationRoot, relativeName(serverVmapsPath, source)));
  }

  const overriddenFiles = [];
  const stagedFiles = generatedFiles.map(source => {
    const relative = relativeName(generatedVmapsPath, source);
    const destination = path.join(destinationRoot, relative);
    const existed = fs.existsSync(destination);
    linkOrCopyReplacing(source, destination);
    const bytes = fs.statSync(source).size;
    return { path: relative.replace(/\\/g, '/'), bytes, sha256: fileSha256(source), overridden: existed };
  });
  for (const item of stagedFiles) if (item.overridden) overriddenFiles.push(item.path);

  return {
    source: generatedFiles.length ? 'staged-vmap-overlay' : 'live-server-vmaps',
    serverRoot: serverVmapsPath,
    generatedRoot: generatedFiles.length ? generatedVmapsPath : null,
    liveFileCount: baseFiles.length,
    stagedFileCount: stagedFiles.length,
    overriddenFileCount: overriddenFiles.length,
    stagedFiles,
  };
}

function clearFiles(root, extensions) {
  if (!fs.existsSync(root)) return;
  const allowed = new Set(extensions.map(extension => extension.toLowerCase()));
  for (const name of fs.readdirSync(root)) {
    const filePath = path.join(root, name);
    if (fs.statSync(filePath).isFile() && allowed.has(path.extname(name).toLowerCase())) fs.unlinkSync(filePath);
  }
}

function removeStagingDirectory(root, junctions = []) {
  for (const junction of junctions) {
    try {
      if (fs.existsSync(junction) && fs.lstatSync(junction).isSymbolicLink()) fs.unlinkSync(junction);
    } catch { /* best-effort cleanup; output remains available */ }
  }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

function runProcess(executable, args, cwd, timeoutMs = 15 * 60 * 1000, visible = false, onOutput = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: !visible, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const append = (chunk, target) => {
      const value = chunk.toString();
      if (target === 'stdout') stdout = `${stdout}${value}`.slice(-20000);
      else stderr = `${stderr}${value}`.slice(-20000);
      if (onOutput) onOutput({ stream: target, text: value });
    };
    child.stdout.on('data', chunk => append(chunk, 'stdout'));
    child.stderr.on('data', chunk => append(chunk, 'stderr'));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(executable)} timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function patchMmapsConfig(sourcePath, destinationPath, dataRoot) {
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : 'mmapsConfig:\n  skipLiquid: false\n  skipContinents: false\n  skipJunkMaps: true\n  skipBattlegrounds: false\n  meshSettings:\n    walkableSlopeAngle: 60\n    walkableHeight: 6\n    walkableClimb: 6\n    walkableRadius: 2\n    vertexPerMapEdge: 2000\n    vertexPerTileEdge: 80\n    maxSimplificationError: 1.8\n';
  const quoted = dataRoot.replace(/\\/g, '/').replace(/"/g, '\\"');
  const next = /^\s*dataDir:\s*.*$/m.test(source)
    ? source.replace(/^\s*dataDir:\s*.*$/m, `  dataDir: "${quoted}"`)
    : `${source.trimEnd()}\n  dataDir: "${quoted}"\n`;
  fs.writeFileSync(destinationPath, next, 'utf8');
}

function readMmapRoot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 28) return null;
  return {
    bytes: buffer.length,
    origin: [buffer.readFloatLE(0), buffer.readFloatLE(4), buffer.readFloatLE(8)],
    tileWidth: buffer.readFloatLE(12),
    tileHeight: buffer.readFloatLE(16),
    maxTiles: buffer.readUInt32LE(20),
    maxPolys: buffer.readUInt32LE(24),
    hash: require('crypto').createHash('sha256').update(buffer).digest('hex'),
  };
}

async function runTargetMmap({ jobRoot, serverMapsPath, serverMmapsPath, serverVmapsPath, toolRoot, executablePath, mapId, tileX, tileY, mapOutputPath, tiles = [], configPath, onProgress }) {
  if (!fs.existsSync(serverMapsPath)) throw new Error(`Server maps directory not found: ${serverMapsPath}`);
  if (!fs.existsSync(serverVmapsPath)) throw new Error(`Server vmaps directory not found: ${serverVmapsPath}`);
  const executable = executablePath && fs.existsSync(executablePath)
    ? executablePath
    : fs.existsSync(path.join(toolRoot, 'mmaps_generator.exe'))
    ? path.join(toolRoot, 'mmaps_generator.exe')
    : findExecutableRecursively(path.dirname(serverMapsPath), 'mmaps_generator.exe', toolRoot);
  if (!fs.existsSync(executable)) throw new Error(`MMAP generator not found: ${executable}`);
  const requestedTiles = (tiles.length ? tiles : [{ tileX, tileY, mapOutputPath }]).map(tile => ({
    tileX: Number(tile.tileX ?? tile.x),
    tileY: Number(tile.tileY ?? tile.y),
    mapOutputPath: tile.mapOutputPath,
  }));
  if (!requestedTiles.length || requestedTiles.some(tile => !Number.isInteger(tile.tileX) || !Number.isInteger(tile.tileY))) throw new Error('MMAP generation requires valid tile coordinates.');
  for (const tile of requestedTiles) {
    if (!tile.mapOutputPath || !fs.existsSync(tile.mapOutputPath)) throw new Error(`Generate the staged .map before generating MMAP for ${tile.tileX},${tile.tileY}.`);
  }

  const inputRoot = path.join(jobRoot, 'mmap-input');
  const mapsRoot = path.join(inputRoot, 'maps');
  const mmapsRoot = path.join(inputRoot, 'mmaps');
  const vmapsRoot = path.join(inputRoot, 'vmaps');
  const generatedVmapsRoot = path.join(jobRoot, 'server-output', 'vmaps');
  const progress = update => onProgress?.({ ...update, jobRoot });
  progress({ phase: 'preparing', message: 'Preparing MMAP map input', percent: 5 });
  fs.mkdirSync(mapsRoot, { recursive: true });
  fs.mkdirSync(mmapsRoot, { recursive: true });
  const vmapInput = stageMmapVmaps(serverVmapsPath, generatedVmapsRoot, vmapsRoot);
  progress({ phase: 'preparing', message: `Prepared MMAP VMap input (${vmapInput.source})`, percent: 10 });

  clearFiles(mapsRoot, ['.map']);
  clearFiles(mmapsRoot, ['.mmap', '.mmtile']);
  const mapPrefix = String(mapId).padStart(3, '0');
  const targetMapOutputs = new Map(requestedTiles.map(tile => [mapFileName(mapId, tile.tileX, tile.tileY), tile.mapOutputPath]));
  const mapNames = fs.readdirSync(serverMapsPath)
    .filter(name => name.toLowerCase().startsWith(mapPrefix) && name.toLowerCase().endsWith('.map'));
  for (const targetName of targetMapOutputs.keys()) if (!mapNames.includes(targetName)) mapNames.push(targetName);
  let inputMapCount = 0;
  for (const name of mapNames) {
    const source = targetMapOutputs.get(name) || path.join(serverMapsPath, name);
    if (linkOrCopyIfPresent(source, path.join(mapsRoot, name))) inputMapCount += 1;
  }
  if (!inputMapCount) throw new Error(`No ${mapPrefix}*.map files were available for MMAP generation.`);
  const sourceConfig = configPath || path.join(toolRoot, 'mmaps-config.yaml');
  const localConfig = path.join(jobRoot, 'mmaps-config.yaml');
  patchMmapsConfig(sourceConfig, localConfig, inputRoot);
  const runs = [];
  const outputRoot = path.join(jobRoot, 'server-output', 'mmaps');
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputTiles = [];
  for (let index = 0; index < requestedTiles.length; index += 1) {
    const tile = requestedTiles[index];
    const percent = 28 + Math.round((index / requestedTiles.length) * 60);
    progress({ phase: 'mmap', message: `Running mmaps_generator for ${tile.tileX},${tile.tileY} (${index + 1}/${requestedTiles.length})`, percent, indeterminate: true });
    const run = await runProcess(executable, [String(mapId), '--tile', `${tile.tileX},${tile.tileY}`, '--config', localConfig, '--silent'], toolRoot, 60 * 60 * 1000, true, output => progress({ phase: 'mmap', message: `Running mmaps_generator for ${tile.tileX},${tile.tileY} (${index + 1}/${requestedTiles.length})`, percent, indeterminate: true, output: output.text }));
    if (run.code !== 0) throw new Error(`${path.basename(executable)} exited with code ${run.code} for ${tile.tileX},${tile.tileY}. ${run.stderr || run.stdout}`.trim());
    runs.push(run);
    const outputName = mmapTileFileName(mapId, tile.tileX, tile.tileY);
    const generatedTile = path.join(mmapsRoot, outputName);
    if (!fs.existsSync(generatedTile)) throw new Error(`MMAP generator completed without creating ${outputName}. ${run.stderr || run.stdout}`.trim());
    const outputTile = path.join(outputRoot, outputName);
    fs.copyFileSync(generatedTile, outputTile);
    outputTiles.push({ tileX: tile.tileX, tileY: tile.tileY, outputTile, bytes: fs.statSync(outputTile).size });
  }
  const generatedRoot = path.join(mmapsRoot, `${String(mapId).padStart(3, '0')}.mmap`);
  const outputMmap = fs.existsSync(generatedRoot) ? path.join(outputRoot, path.basename(generatedRoot)) : null;
  if (outputMmap) fs.copyFileSync(generatedRoot, outputMmap);
  const generatedRootInfo = readMmapRoot(generatedRoot);
  const liveRootInfo = readMmapRoot(serverMmapsPath ? path.join(serverMmapsPath, `${String(mapId).padStart(3, '0')}.mmap`) : null);
  const rootMatchesLive = !liveRootInfo || !generatedRootInfo
    ? null
    : generatedRootInfo.hash === liveRootInfo.hash;
  progress({ phase: 'cleanup', message: 'Cleaning temporary MMAP input', percent: 96 });
  removeStagingDirectory(inputRoot);
  try { fs.rmSync(localConfig, { force: true }); } catch { /* best-effort cleanup */ }
  const primary = outputTiles.find(tile => tile.tileX === Number(tileX) && tile.tileY === Number(tileY)) || outputTiles[0];
  return { outputTile: primary.outputTile, outputTiles, outputMmap, bytes: primary.bytes, inputMapCount, targetName: mapFileName(mapId, primary.tileX, primary.tileY), generatedRootInfo, liveRootInfo, rootMatchesLive, vmapInput, stdout: runs.map(run => run.stdout).join('\n').trim(), stderr: runs.map(run => run.stderr).join('\n').trim(), inputRoot, configPath: localConfig };
}

function readDbcHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid DBC buffer.');
  const recordCount = buffer.readUInt32LE(4);
  const fieldCount = buffer.readUInt32LE(8);
  const recordSize = buffer.readUInt32LE(12);
  const stringSize = buffer.readUInt32LE(16);
  const recordsEnd = 20 + recordCount * recordSize;
  if (recordsEnd + stringSize > buffer.length) throw new Error('DBC buffer is truncated.');
  return { recordCount, fieldCount, recordSize, stringSize, recordsEnd };
}

function dbcWithSingleRecord(buffer, recordId) {
  const header = readDbcHeader(buffer);
  let record = null;
  for (let index = 0; index < header.recordCount; index += 1) {
    const offset = 20 + index * header.recordSize;
    if (header.recordSize >= 4 && buffer.readUInt32LE(offset) === Number(recordId)) {
      record = buffer.subarray(offset, offset + header.recordSize);
      break;
    }
  }
  if (!record) throw new Error(`DBC record ${recordId} was not found.`);
  const output = Buffer.alloc(20 + header.recordSize + header.stringSize);
  buffer.copy(output, 0, 0, 20);
  output.writeUInt32LE(1, 4);
  record.copy(output, 20);
  buffer.copy(output, 20 + header.recordSize, header.recordsEnd, header.recordsEnd + header.stringSize);
  return output;
}

function emptyDbc(buffer) {
  const header = readDbcHeader(buffer);
  const output = Buffer.alloc(21);
  buffer.copy(output, 0, 0, 20);
  output.writeUInt32LE(0, 4);
  output.writeUInt32LE(1, 16);
  output[20] = 0;
  return output;
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildVmapDelta(generatedRoot, liveRoot, outputRoot, mapId) {
  if (!liveRoot || !fs.existsSync(liveRoot)) throw new Error(`Live server vmaps directory not found: ${liveRoot}`);
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const changedFiles = [];
  let changedBytes = 0;
  const mapPrefix = String(mapId).padStart(3, '0');
  const generatedFiles = fs.readdirSync(generatedRoot)
    .map(name => path.join(generatedRoot, name))
    .filter(filePath => {
      if (!fs.statSync(filePath).isFile()) return false;
      const name = path.basename(filePath);
      const extension = path.extname(name).toLowerCase();
      return name === `${mapPrefix}.vmtree`
        || (name.startsWith(`${mapPrefix}_`) && extension === '.vmtile')
        || extension === '.vmo'
        || extension === '.m2';
    });
  for (const source of generatedFiles) {
    const name = path.basename(source);
    const target = path.join(liveRoot, name);
    const changed = !fs.existsSync(target)
      || fs.statSync(target).size !== fs.statSync(source).size
      || fileSha256(target) !== fileSha256(source);
    if (!changed) continue;
    const destination = path.join(outputRoot, name);
    fs.copyFileSync(source, destination);
    const bytes = fs.statSync(source).size;
    changedFiles.push({ name, bytes, reason: fs.existsSync(target) ? 'changed' : 'new' });
    changedBytes += bytes;
  }
  return { changedFiles, changedBytes, generatedFileCount: generatedFiles.length };
}

function linkClientArchives(clientDataPath, stagingDataPath) {
  const copied = [];
  const linkArchives = (sourceDirectory, targetDirectory) => {
    if (!sourceDirectory || !fs.existsSync(sourceDirectory)) return;
    fs.mkdirSync(targetDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.mpq') || entry.name.toLowerCase() === 'patch-4.mpq') continue;
      const source = path.join(sourceDirectory, entry.name);
      const destination = path.join(targetDirectory, entry.name);
      linkOrCopyIfPresent(source, destination);
      copied.push(destination);
    }
  };
  linkArchives(clientDataPath, stagingDataPath);
  linkArchives(path.join(clientDataPath, 'enUS'), path.join(stagingDataPath, 'enUS'));
  if (!copied.length) throw new Error(`No client MPQ archives were found in ${clientDataPath}.`);
  return copied;
}

async function createVmapPatch({ mpqEditorPath, dataRoot, stagedAdtPath, adtInternalPath, stagedAdts = [], mapDbc, gameObjectDbc, jobRoot, onProgress }) {
  if (!mpqEditorPath || !fs.existsSync(mpqEditorPath)) throw new Error(`MPQ Editor executable not found: ${mpqEditorPath || '(not configured)'}`);
  const patchRoot = path.join(jobRoot, 'vmap-input', 'patch-files');
  fs.mkdirSync(patchRoot, { recursive: true });
  const mapDbcPath = path.join(patchRoot, 'Map.dbc');
  const gameObjectDbcPath = path.join(patchRoot, 'GameObjectDisplayInfo.dbc');
  fs.writeFileSync(mapDbcPath, mapDbc);
  fs.writeFileSync(gameObjectDbcPath, gameObjectDbc);
  const patchPath = path.join(dataRoot, 'patch-4.MPQ');
  onProgress?.({ phase: 'preparing', message: 'Creating temporary patch overlay', percent: 8 });
  let run = await runProcess(mpqEditorPath, ['new', patchPath, '0x1000'], jobRoot);
  if (run.code !== 0 || !fs.existsSync(patchPath)) throw new Error(`MPQ Editor could not create patch-4.MPQ. ${run.stderr || run.stdout}`.trim());
  const add = async (source, target) => {
    const result = await runProcess(mpqEditorPath, ['add', patchPath, source, target, '/auto'], jobRoot);
    if (result.code !== 0) throw new Error(`MPQ Editor could not add ${target}. ${result.stderr || result.stdout}`.trim());
  };
  await add(mapDbcPath, 'DBFilesClient\\Map.dbc');
  await add(gameObjectDbcPath, 'DBFilesClient\\GameObjectDisplayInfo.dbc');
  const inputs = stagedAdts.length ? stagedAdts : [{ source: stagedAdtPath, target: adtInternalPath }];
  for (const input of inputs) await add(input.source, input.target);
  return { patchPath, mapDbcPath, gameObjectDbcPath };
}

async function runTargetVmap({ jobRoot, clientDataPath, serverVmapsPath, mpqEditorPath, stagedAdtPath, stagedAdts = [], mapDbcBuffer, gameObjectDbcBuffer, mapId, mapName, tileX, tileY, toolPaths, onProgress }) {
  if (!jobRoot || !fs.existsSync(jobRoot)) throw new Error('VMap staging job directory not found.');
  if (!clientDataPath || !fs.existsSync(clientDataPath)) throw new Error(`Client Data directory not found: ${clientDataPath}`);
  const requestedAdts = stagedAdts.length ? stagedAdts : [{ path: stagedAdtPath, tileX, tileY }];
  if (!requestedAdts.length || requestedAdts.some(item => !item.path || !fs.existsSync(item.path))) throw new Error('One or more staged ADT files are missing.');
  const extractor = toolPaths?.vmapExtractor;
  const assembler = toolPaths?.vmapAssembler;
  if (!extractor || !fs.existsSync(extractor)) throw new Error('vmap4_extractor.exe was not found under the configured server root.');
  if (!assembler || !fs.existsSync(assembler)) throw new Error('vmap4_assembler.exe was not found under the configured server root.');
  if (!Buffer.isBuffer(mapDbcBuffer) || !Buffer.isBuffer(gameObjectDbcBuffer)) throw new Error('Map.dbc and GameObjectDisplayInfo.dbc are required for VMap generation.');
  const dataRoot = path.join(jobRoot, 'vmap-input', 'Data');
  const workRoot = path.join(jobRoot, 'vmap-work');
  const buildingsRoot = path.join(workRoot, 'Buildings');
  const assembledRoot = path.join(workRoot, 'assembled-vmaps');
  const outputRoot = path.join(jobRoot, 'server-output', 'vmaps');
  const progress = update => onProgress?.({ ...update, jobRoot });
  progress({ phase: 'preparing', message: 'Preparing VMap client input', percent: 3 });
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(assembledRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  linkClientArchives(clientDataPath, dataRoot);
  const mapDbc = dbcWithSingleRecord(mapDbcBuffer, mapId);
  const gameObjectDbc = emptyDbc(gameObjectDbcBuffer);
  const mapFolder = String(mapName || '').toLowerCase() === 'kalimdor' ? 'Kalimdor' : String(mapName || 'Map');
  const patchAdts = requestedAdts.map(item => {
    const mapBaseName = path.basename(item.path, path.extname(item.path));
    return { source: item.path, target: `World\\Maps\\${mapFolder}\\${mapBaseName}.adt` };
  });
  const patch = await createVmapPatch({ mpqEditorPath, dataRoot, stagedAdts: patchAdts, mapDbc, gameObjectDbc, jobRoot, onProgress: progress });
  progress({ phase: 'extractor', message: 'Running vmap4_extractor', percent: 20, indeterminate: true });
  const runExtractor = await runProcess(extractor, ['-s', '-d', dataRoot], workRoot, 60 * 60 * 1000, true, output => progress({ phase: 'extractor', message: 'Running vmap4_extractor', percent: 20, indeterminate: true, output: output.text }));
  if (runExtractor.code !== 0) throw new Error(`${path.basename(extractor)} exited with code ${runExtractor.code}. ${runExtractor.stderr || runExtractor.stdout}`.trim());
  if (!fs.existsSync(path.join(buildingsRoot, 'dir_bin'))) throw new Error('VMap extractor completed without creating Buildings\\dir_bin.');
  progress({ phase: 'assembler', message: 'Running vmap4_assembler', percent: 62, indeterminate: true });
  const runAssembler = await runProcess(assembler, [buildingsRoot, assembledRoot], workRoot, 60 * 60 * 1000, true, output => progress({ phase: 'assembler', message: 'Running vmap4_assembler', percent: 62, indeterminate: true, output: output.text }));
  if (runAssembler.code !== 0) throw new Error(`${path.basename(assembler)} exited with code ${runAssembler.code}. ${runAssembler.stderr || runAssembler.stdout}`.trim());
  const mapIdText = String(mapId).padStart(3, '0');
  const generatedTree = path.join(assembledRoot, `${mapIdText}.vmtree`);
  const generatedTiles = requestedAdts.map(item => {
    const tilePath = path.join(assembledRoot, vmapTileFileName(mapId, item.tileX, item.tileY));
    const refs = readObjectReferences(fs.readFileSync(item.path));
    const referenceCount = refs.m2.length + refs.wmo.length;
    return { tileX: Number(item.tileX), tileY: Number(item.tileY), path: tilePath, exists: fs.existsSync(tilePath), referenceCount };
  });
  for (const tile of generatedTiles) {
    if (!tile.exists && tile.referenceCount > 0) throw new Error(`VMap assembler completed without creating ${path.basename(tile.path)} for a tile containing ${tile.referenceCount} object reference(s).`);
  }
  if (!fs.existsSync(generatedTree)) throw new Error(`VMap assembler completed without creating ${path.basename(generatedTree)}.`);
  progress({ phase: 'delta', message: 'Comparing generated VMaps with live server', percent: 88 });
  const delta = buildVmapDelta(assembledRoot, serverVmapsPath, outputRoot, mapId);
  const changedNames = new Set(delta.changedFiles.map(file => file.name));
  const primaryGeneratedTile = generatedTiles.find(tile => tile.tileX === Number(tileX) && tile.tileY === Number(tileY)) || generatedTiles[0];
  const primaryTileName = primaryGeneratedTile ? path.basename(primaryGeneratedTile.path) : '';
  const outputTile = primaryGeneratedTile?.exists ? path.join(outputRoot, primaryTileName) : null;
  const treeName = `${mapIdText}.vmtree`;
  const outputTree = path.join(outputRoot, treeName);
  for (const tile of generatedTiles) {
    if (tile.exists) copyIfPresent(tile.path, path.join(outputRoot, path.basename(tile.path)));
  }
  copyIfPresent(generatedTree, outputTree);
  const stagedBuffers = requestedAdts.map(item => fs.readFileSync(item.path));
  const modelDependencies = inspectVmapDependenciesBuffer({
    adtBuffer: stagedBuffers[0],
    adtBuffers: stagedBuffers.slice(1),
    adtEntries: requestedAdts.map((item, index) => ({ tileX: item.tileX, tileY: item.tileY, buffer: stagedBuffers[index] })),
    serverVmapsPath,
    mapId,
    tileX,
    tileY,
    generatedVmapsPath: assembledRoot,
  });
  progress({ phase: 'cleanup', message: 'Cleaning temporary VMap input', percent: 96 });
  fs.rmSync(path.join(jobRoot, 'vmap-input'), { recursive: true, force: true });
  fs.rmSync(workRoot, { recursive: true, force: true });
  return {
    outputTile,
    outputTiles: generatedTiles.map(tile => { const name = path.basename(tile.path); const included = tile.exists; const output = included ? path.join(outputRoot, name) : null; return { tileX: tile.tileX, tileY: tile.tileY, outputTile: output, generated: tile.exists, included, changed: tile.exists && changedNames.has(name), status: tile.exists ? (changedNames.has(name) ? 'changed' : 'unchanged') : 'no-collision', referenceCount: tile.referenceCount, bytes: output && fs.existsSync(output) ? fs.statSync(output).size : 0 }; }),
    outputTree,
    tileBytes: outputTile ? fs.statSync(outputTile).size : 0,
    treeBytes: outputTree ? fs.statSync(outputTree).size : 0,
    treeChanged: changedNames.has(treeName),
    changedFiles: delta.changedFiles,
    changedFileCount: delta.changedFiles.length,
    changedBytes: delta.changedBytes,
    generatedFileCount: delta.generatedFileCount,
    modelDependencies,
    patchPath: patch.patchPath,
    inputRoot: dataRoot,
    workRoot,
    stdout: `${runExtractor.stdout}\n${runAssembler.stdout}`.trim(),
    stderr: `${runExtractor.stderr}\n${runAssembler.stderr}`.trim(),
  };
}

module.exports = {
  mapIdForName,
  mapFileName,
  vmapTileFileName,
  mmapTileFileName,
  findExecutableRecursively,
  resolveServerTools,
  inspectVmapDependencies,
  runTargetVmap,
  runTargetMmap,
};
