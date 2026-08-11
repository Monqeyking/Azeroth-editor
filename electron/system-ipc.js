const os = require('os');

function getRuntimeResourceProfile(system = os) {
  const cores = Math.max(1, system.cpus()?.length || 4);
  const totalMemoryMb = Math.round(system.totalmem() / 1024 / 1024);
  const freeMemoryMb = Math.round(system.freemem() / 1024 / 1024);
  const memoryPressure = freeMemoryMb < 2048 || freeMemoryMb / Math.max(1, totalMemoryMb) < 0.12;
  const conservative = memoryPressure || cores <= 4 || totalMemoryMb <= 8192;
  const performance = !conservative && cores >= 8 && totalMemoryMb >= 16384;
  return {
    tier: conservative ? 'conservative' : performance ? 'performance' : 'balanced',
    cores,
    totalMemoryMb,
    freeMemoryMb,
    memoryPressure,
    textureWorkers: conservative ? 1 : 2,
    wmoWorkers: conservative ? 1 : performance ? 2 : 1,
    assetIoConcurrency: conservative ? 3 : 6,
    terrainBatchMax: conservative ? 10 : performance ? 16 : 12,
    textureBatchMax: conservative ? 2 : performance ? 4 : 3,
    wmoBatchMax: conservative ? 6 : performance ? 10 : 8,
    waterBatchMax: conservative ? 3 : performance ? 6 : 4,
    terrainRequestConcurrency: conservative ? 1 : 2,
    textureRequestConcurrency: conservative ? 1 : 2,
    wmoRequestConcurrency: conservative ? 1 : 2,
    waterRequestConcurrency: conservative ? 1 : 2,
    textureUploadsPerFrame: conservative ? 2 : performance ? 6 : 4,
    wmoAssetConcurrency: conservative ? 2 : 3,
    doodadConcurrency: conservative ? 2 : 4,
    m2RequestConcurrency: conservative ? 2 : 4,
    dprMax: conservative ? 1 : performance ? 1.5 : 1.25,
  };
}

function registerSystemIpc(ipcMain, dependencies = {}) {
  const getResourceProfile = dependencies.getRuntimeResourceProfile || getRuntimeResourceProfile;
  const getBlpCacheStats = dependencies.getBlpTextureCacheStats || (() => ({}));
  const getMpqCacheStats = dependencies.getMpqMemoryCacheStats || (() => ({}));
  const getProcessMemoryUsage = dependencies.getProcessMemoryUsage || (() => process.memoryUsage());

  ipcMain.handle('system:getResourceProfile', async event => {
    const profile = getResourceProfile();
    try {
      const memory = await event.sender.getProcessMemoryInfo();
      profile.rendererWorkingSetMb = Math.round((memory?.workingSetSize || 0) / 1024);
      profile.rendererPrivateMb = Math.round((memory?.privateBytes || 0) / 1024);
    } catch {}
    return profile;
  });

  ipcMain.handle('system:getMemoryDiagnostics', async event => {
    const usage = getProcessMemoryUsage();
    let renderer = {};
    try {
      const memory = await event.sender.getProcessMemoryInfo();
      renderer = {
        workingSetBytes: (memory?.workingSetSize || 0) * 1024,
        privateBytes: (memory?.privateBytes || 0) * 1024,
      };
    } catch {}
    let mpq = {};
    try { mpq = getMpqCacheStats() || {}; } catch {}
    return {
      capturedAt: new Date().toISOString(),
      main: {
        rssBytes: usage.rss || 0,
        heapUsedBytes: usage.heapUsed || 0,
        externalBytes: usage.external || 0,
        arrayBuffersBytes: usage.arrayBuffers || 0,
      },
      renderer,
      blp: getBlpCacheStats(),
      mpq,
    };
  });
}

module.exports = { getRuntimeResourceProfile, registerSystemIpc };
