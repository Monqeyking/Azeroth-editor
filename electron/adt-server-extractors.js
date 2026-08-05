const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAP_IDS = { kalimdor: 1, azeroth: 0, easternkingdoms: 0, outland: 530, northrend: 571 };

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

function findServerModel(vmapsPath, modelPath, kind) {
  const name = path.basename(String(modelPath || '').replace(/[\\/]+/g, path.sep));
  const candidate = kind === 'wmo' ? `${name}.vmo` : name;
  return path.join(vmapsPath, candidate);
}

function inspectVmapDependencies({ adtPath, serverVmapsPath, mapId, tileX, tileY }) {
  if (!adtPath || !fs.existsSync(adtPath)) throw new Error(`ADT file not found: ${adtPath}`);
  if (!serverVmapsPath || !fs.existsSync(serverVmapsPath)) throw new Error(`Server vmaps directory not found: ${serverVmapsPath}`);
  const refs = readObjectReferences(fs.readFileSync(adtPath));
  const models = [
    ...refs.m2.map(model => ({ kind: 'm2', model, serverPath: findServerModel(serverVmapsPath, model, 'm2') })),
    ...refs.wmo.map(model => ({ kind: 'wmo', model, serverPath: findServerModel(serverVmapsPath, model, 'wmo') })),
  ].map(item => ({ ...item, exists: fs.existsSync(item.serverPath) }));
  const vmapTile = path.join(serverVmapsPath, vmapTileFileName(mapId, tileX, tileY));
  return {
    mapId, tileX, tileY,
    references: models,
    missingModels: models.filter(item => !item.exists),
    existingVmapTile: { path: vmapTile, exists: fs.existsSync(vmapTile), bytes: fs.existsSync(vmapTile) ? fs.statSync(vmapTile).size : 0 },
    message: models.length
      ? `${models.filter(item => item.exists).length}/${models.length} referenced collision model(s) already exist in server vmaps.`
      : 'The ADT contains no MDDF/MODF object references to validate.',
  };
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function createJunction(source, destination) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.symlinkSync(path.resolve(source), destination, 'junction');
}

function runProcess(executable, args, cwd, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const append = (chunk, target) => {
      const value = chunk.toString();
      if (target === 'stdout') stdout = `${stdout}${value}`.slice(-20000);
      else stderr = `${stderr}${value}`.slice(-20000);
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

async function runTargetMmap({ jobRoot, serverMapsPath, serverVmapsPath, toolRoot, mapId, tileX, tileY, mapOutputPath, configPath }) {
  if (!fs.existsSync(serverMapsPath)) throw new Error(`Server maps directory not found: ${serverMapsPath}`);
  if (!fs.existsSync(serverVmapsPath)) throw new Error(`Server vmaps directory not found: ${serverVmapsPath}`);
  const executable = path.join(toolRoot, 'mmaps_generator.exe');
  if (!fs.existsSync(executable)) throw new Error(`MMAP generator not found: ${executable}`);
  if (!mapOutputPath || !fs.existsSync(mapOutputPath)) throw new Error('Generate the staged .map before generating MMAP.');

  const inputRoot = path.join(jobRoot, 'mmap-input');
  const mapsRoot = path.join(inputRoot, 'maps');
  const mmapsRoot = path.join(inputRoot, 'mmaps');
  const vmapsRoot = path.join(inputRoot, 'vmaps');
  fs.mkdirSync(mapsRoot, { recursive: true });
  fs.mkdirSync(mmapsRoot, { recursive: true });
  createJunction(serverVmapsPath, vmapsRoot);

  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = tileX + dx;
    const y = tileY + dy;
    const name = mapFileName(mapId, x, y);
    const source = dx === 0 && dy === 0 ? mapOutputPath : path.join(serverMapsPath, name);
    copyIfPresent(source, path.join(mapsRoot, name));
  }
  const sourceConfig = configPath || path.join(toolRoot, 'mmaps-config.yaml');
  const localConfig = path.join(jobRoot, 'mmaps-config.yaml');
  patchMmapsConfig(sourceConfig, localConfig, inputRoot);
  const run = await runProcess(executable, [String(mapId), '--tile', `${tileX},${tileY}`, '--config', localConfig, '--silent'], toolRoot);
  if (run.code !== 0) throw new Error(`${path.basename(executable)} exited with code ${run.code}. ${run.stderr || run.stdout}`.trim());
  const outputName = mmapTileFileName(mapId, tileX, tileY);
  const generatedTile = path.join(mmapsRoot, outputName);
  const generatedRoot = path.join(mmapsRoot, `${String(mapId).padStart(3, '0')}.mmap`);
  if (!fs.existsSync(generatedTile)) throw new Error(`MMAP generator completed without creating ${outputName}. ${run.stderr || run.stdout}`.trim());
  const outputRoot = path.join(jobRoot, 'server-output', 'mmaps');
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputTile = path.join(outputRoot, outputName);
  fs.copyFileSync(generatedTile, outputTile);
  const outputMmap = fs.existsSync(generatedRoot) ? path.join(outputRoot, path.basename(generatedRoot)) : null;
  if (outputMmap) fs.copyFileSync(generatedRoot, outputMmap);
  return { outputTile, outputMmap, bytes: fs.statSync(outputTile).size, stdout: run.stdout, stderr: run.stderr, inputRoot, configPath: localConfig };
}

module.exports = {
  mapIdForName,
  mapFileName,
  vmapTileFileName,
  mmapTileFileName,
  inspectVmapDependencies,
  runTargetMmap,
};
