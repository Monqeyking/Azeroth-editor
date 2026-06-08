// Module-level batcher:
// Verzamelt BLP-aanvragen over een kort window (default 16ms) en stuurt ze in één
// IPC-call naar de main process. Voorkomt 20 roundtrips bij 20 rijen.

const FLUSH_WINDOW_MS = 16;
const requestCache = new Map(); // `${dataPath}|${blpPath}` → { w, h, dataUrl }

const pending = new Map(); // dataPath → { paths: Set, resolvers: Map<path, {resolve, reject}> }
let flushTimer = null;
let readBlpTexturesFn = null;

export function configureBlpBatchLoader(fn) {
  readBlpTexturesFn = fn;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_WINDOW_MS);
}

async function flush() {
  flushTimer = null;
  if (pending.size === 0 || !readBlpTexturesFn) return;
  const batches = [...pending.entries()];
  pending.clear();

  await Promise.all(batches.map(async ([dataPath, group]) => {
    const paths = [...group.paths];
    if (paths.length === 0) return;
    try {
      const results = await readBlpTexturesFn(dataPath, paths);
      for (let i = 0; i < paths.length; i++) {
        const r = results[i];
        const { resolve, reject } = group.resolvers.get(paths[i]) || {};
        if (!resolve) continue;
        if (r?.success && r.png) {
          const dataUrl = `data:image/png;base64,${r.png}`;
          const key = `${dataPath}|${paths[i].toLowerCase()}`;
          requestCache.set(key, { w: r.w, h: r.h, dataUrl });
          resolve({ w: r.w, h: r.h, dataUrl });
        } else {
          reject(new Error(r?.error || 'Niet gevonden'));
        }
      }
    } catch (e) {
      for (const { resolve, reject } of group.resolvers.values()) reject(e);
    }
  }));
}

export function requestBlpTexture(dataPath, blpPath) {
  if (!blpPath) return Promise.resolve(null);
  const key = `${dataPath}|${blpPath.toLowerCase()}`;
  const hit = requestCache.get(key);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve, reject) => {
    if (!pending.has(dataPath)) pending.set(dataPath, { paths: new Set(), resolvers: new Map() });
    const group = pending.get(dataPath);
    group.paths.add(blpPath);
    group.resolvers.set(blpPath, { resolve, reject });
    scheduleFlush();
  });
}

export function clearBatchBlpCache() {
  requestCache.clear();
}
