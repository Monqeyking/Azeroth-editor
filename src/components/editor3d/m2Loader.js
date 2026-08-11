import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { configureWowColorTexture } from './wowRenderConfig';

const m2PromiseCache   = new Map();
const m2ResultCache    = new Map();
const m2MaterialCache  = new Map();
const m2PathPromiseCache = new Map();
const m2PathResultCache = new Map();
const m2PathListeners = new Set();
const m2GlobalListeners = new Set();            // brede listeners (Inspector, InstanceLayers)
const sharedM2Textures = new Map();
const sharedM2TextureEntries = new WeakMap();
const m2AssetListeners  = new Map();            // displayId → Set<fn>  (per-spawn)
const M2_CACHE_MAX = 48;
const M2_PATH_CACHE_MAX = 96;
const BUILD_BATCH_PER_FRAME = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 4) >= 8 ? 3 : 1;
const m2BuildQueue = [];
let m2BuildFrame = null;

function notifyM2Cache(displayId) {
  // Notificeer alleen de spawns die dit displayId hebben
  m2AssetListeners.get(displayId)?.forEach(fn => fn());
  // Notificeer globale listeners (Inspector, InstanceLayers)
  m2GlobalListeners.forEach(fn => fn());
}

function normalizeM2Path(modelPath) {
  return String(modelPath || '').replace(/\//g, '\\').replace(/\.mdx$/i, '.m2').toLowerCase();
}

function notifyM2PathCache() {
  m2PathListeners.forEach(listener => listener());
}

export function subscribeM2Cache(listener) {
  m2GlobalListeners.add(listener);
  return () => m2GlobalListeners.delete(listener);
}

export function subscribeM2PathCache(listener) {
  m2PathListeners.add(listener);
  return () => m2PathListeners.delete(listener);
}

export function subscribeM2Asset(displayId, fn) {
  if (!displayId) return () => {};
  if (!m2AssetListeners.has(displayId)) m2AssetListeners.set(displayId, new Set());
  m2AssetListeners.get(displayId).add(fn);
  return () => m2AssetListeners.get(displayId)?.delete(fn);
}

export function getCachedM2Asset(displayId) {
  if (!displayId) return null;
  const asset = m2ResultCache.get(displayId) ?? null;
  if (asset) {
    m2ResultCache.delete(displayId);
    m2ResultCache.set(displayId, asset);
  }
  return asset;
}

function disposeM2Asset(asset) {
  if (!asset) return;
  for (const material of asset.materials || []) {
    material.dispose();
  }
  if (asset.texture) {
    const material = m2MaterialCache.get(asset.texture.uuid);
    material?.dispose();
    m2MaterialCache.delete(asset.texture.uuid);
  }
  for (const texture of asset.textureRefs || []) releaseM2Texture(texture);
  asset.geo?.dispose();
}

export function pruneM2AssetCache(keepDisplayIds) {
  const keep = new Set(keepDisplayIds);
  while (m2ResultCache.size > M2_CACHE_MAX) {
    const candidate = [...m2ResultCache.keys()].find(id => !keep.has(id));
    if (candidate == null) break;
    const asset = m2ResultCache.get(candidate);
    m2ResultCache.delete(candidate);
    disposeM2Asset(asset);
  }
}

export function getCachedM2AssetByPath(modelPath) {
  const key = normalizeM2Path(modelPath);
  if (!key || !m2PathResultCache.has(key)) return null;
  const asset = m2PathResultCache.get(key);
  m2PathResultCache.delete(key);
  m2PathResultCache.set(key, asset);
  return asset;
}

export function getM2PathAssetState(modelPath) {
  const key = normalizeM2Path(modelPath);
  if (!key) return 'none';
  if (m2PathPromiseCache.has(key)) return 'loading';
  if (!m2PathResultCache.has(key)) return 'idle';
  return m2PathResultCache.get(key) ? 'loaded' : 'failed';
}

export function getM2PathPendingCount() {
  return m2PathPromiseCache.size;
}

export function pruneM2PathAssetCache(keepPaths = []) {
  const keep = new Set(keepPaths.map(normalizeM2Path));
  while (m2PathResultCache.size > M2_PATH_CACHE_MAX) {
    const candidate = [...m2PathResultCache.keys()].find(key => !keep.has(key));
    if (!candidate) break;
    disposeM2Asset(m2PathResultCache.get(candidate));
    m2PathResultCache.delete(candidate);
  }
}

function getAssetBytes(assets) {
  const seenGeometries = new Set();
  const seenArrays = new Set();
  const seenTextures = new Set();
  let geometryBytes = 0;
  let textureBytes = 0;
  let assetCount = 0;
  for (const asset of assets) {
    if (!asset) continue;
    assetCount += 1;
    const geo = asset.geo;
    if (geo && !seenGeometries.has(geo)) {
      seenGeometries.add(geo);
      for (const attribute of Object.values(geo.attributes || {})) {
        if (attribute?.array && !seenArrays.has(attribute.array)) {
          seenArrays.add(attribute.array);
          geometryBytes += attribute.array.byteLength || 0;
        }
      }
      if (geo.index?.array && !seenArrays.has(geo.index.array)) {
        seenArrays.add(geo.index.array);
        geometryBytes += geo.index.array.byteLength || 0;
      }
    }
    for (const texture of asset.textureRefs || []) {
      if (texture && !seenTextures.has(texture)) {
        seenTextures.add(texture);
        textureBytes += texture.image?.data?.byteLength || 0;
      }
    }
  }
  return { assetCount, geometryBytes, textureBytes, estimatedBytes: geometryBytes + textureBytes };
}

export function getM2CacheStats() {
  return {
    displayEntries: m2ResultCache.size,
    pathEntries: m2PathResultCache.size,
    pendingDisplays: m2PromiseCache.size,
    pendingPaths: m2PathPromiseCache.size,
    ...getAssetBytes([...m2ResultCache.values(), ...m2PathResultCache.values()]),
  };
}

// 'idle' | 'loading' | 'loaded' | 'failed'
export function getM2AssetState(displayId) {
  if (!displayId) return 'none';
  if (!m2ResultCache.has(displayId)) {
    return m2PromiseCache.has(displayId) ? 'loading' : 'idle';
  }
  return m2ResultCache.get(displayId) ? 'loaded' : 'failed';
}

export function getM2Material(asset) {
  if (!asset?.geo) return null;
  if (asset.materials?.length) return asset.materials;
  const key = asset.texture?.uuid ?? 'flat';
  if (!m2MaterialCache.has(key)) {
    m2MaterialCache.set(key, asset.texture
      ? new THREE.MeshLambertMaterial({
          map: asset.texture,
          side: THREE.DoubleSide,
          alphaTest: 0.5,
        })
      : new THREE.MeshLambertMaterial({
          color: '#ccaa88',
          side: THREE.DoubleSide,
        }));
  }
  return m2MaterialCache.get(key);
}

function toFloat32Array(buf) {
  if (buf instanceof Float32Array) return buf;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function toUint32Array(buf) {
  if (buf instanceof Uint32Array) return buf;
  return new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function toUint8Array(buf) {
  if (buf instanceof Uint8Array) return buf;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function releaseM2Texture(texture) {
  if (!texture) return;
  const entry = sharedM2TextureEntries.get(texture);
  if (!entry) {
    texture.dispose();
    return;
  }
  entry.refs -= 1;
  if (entry.refs > 0) return;
  sharedM2Textures.delete(entry.key);
  sharedM2TextureEntries.delete(texture);
  texture.dispose();
}

function createM2Texture(source, textureRefs = null) {
  const rgba = source?.rgba ?? source?.textureRgba;
  const width = source?.w ?? source?.textureW;
  const height = source?.h ?? source?.textureH;
  if (!rgba || !width || !height) return null;
  const key = source?.path || source?.texturePath
    ? normalizeM2Path(source.path || source.texturePath)
    : '';
  if (key && sharedM2Textures.has(key)) {
    const texture = sharedM2Textures.get(key);
    const entry = sharedM2TextureEntries.get(texture);
    if (entry) entry.refs += 1;
    textureRefs?.push(texture);
    return texture;
  }
  const bytes = toUint8Array(rgba);
  let alphaMin = 255;
  let alphaMax = 0;
  for (let index = 3; index < bytes.length; index += 4) {
    alphaMin = Math.min(alphaMin, bytes[index]);
    alphaMax = Math.max(alphaMax, bytes[index]);
  }
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.userData.debugAlpha = { min: alphaMin, max: alphaMax, hasTransparency: alphaMin < 255 };
  texture.flipY = false;
  configureWowColorTexture(texture);
  texture.needsUpdate = true;
  const canMipMap = THREE.MathUtils.isPowerOfTwo(width) && THREE.MathUtils.isPowerOfTwo(height);
  texture.generateMipmaps = canMipMap;
  texture.minFilter = canMipMap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (key) {
    sharedM2Textures.set(key, texture);
    sharedM2TextureEntries.set(texture, { key, refs: 1 });
  }
  textureRefs?.push(texture);
  return texture;
}

function createM2PassMaterial(pass, texture) {
  const blend = Number(pass?.blend) || 0;
  const cutout = blend === 1;
  const transparent = blend >= 2;
  const twoSided = (Number(pass?.renderFlags) & 4) !== 0;
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    color: texture ? '#ffffff' : '#ccaa88',
    side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent,
    alphaTest: cutout ? 224 / 255 : blend > 0 ? 1 / 255 : 0,
    depthWrite: !pass?.noDepthWrite,
  });
  material.blending = blend === 3 || blend === 4
    ? THREE.AdditiveBlending
    : blend >= 5 ? THREE.CustomBlending : THREE.NormalBlending;
  if (blend >= 5) {
    material.blendSrc = THREE.DstColorFactor;
    material.blendDst = THREE.SrcColorFactor;
  }
  return material;
}

export function buildM2Asset(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(toFloat32Array(data.positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(toFloat32Array(data.normals), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(toFloat32Array(data.uvs), 2));
  if (data.uvs2) geo.setAttribute('uv1', new THREE.BufferAttribute(toFloat32Array(data.uvs2), 2));
  geo.setIndex(new THREE.BufferAttribute(toUint32Array(data.indices), 1));

  const textureRefs = [];
  let fallbackTexture = null;
  const getFallbackTexture = () => {
    if (!fallbackTexture) fallbackTexture = createM2Texture(data, textureRefs);
    return fallbackTexture;
  };
  const passTextures = new Map((data.passTextures || []).map(entry => [entry.passIndex, entry]));
  const textureByPath = new Map();
  const materials = [];
  const particleTextures = new Map();
  const particleTextureByPath = textureByPath;
  const usablePasses = [];
  const debugPasses = [];
  const renderPasses = [...(data.renderPasses || [])]
    .filter(pass => Number.isFinite(pass.indexStart) && pass.indexCount > 0)
    .sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index) || a.index - b.index);

  for (const pass of renderPasses) {
    const source = passTextures.get(pass.index);
    const pathKey = source?.path?.toLowerCase();
    const textureKey = pathKey ? `${pathKey}|uv${pass.uvSet === 1 ? 1 : 0}` : '';
    const texturePath = source?.path || pass.texturePath || '';
    let texture = textureKey ? textureByPath.get(textureKey) : null;
    if (!texture) texture = createM2Texture(source, textureRefs);
    if (texture && pass.uvSet === 1) {
      texture = texture.clone();
      texture.channel = 1;
      texture.needsUpdate = true;
      textureRefs.push(texture);
    }
    const blend = Number(pass?.blend) || 0;
    const particleDrivenGlow = data.particleEmitters?.length
      && /genericglow_alpha_128\.blp$/i.test(texturePath);
    if (particleDrivenGlow) {
      debugPasses.push({
        ...pass,
        texturePath,
        textureLoaded: !!texture,
        fallbackUsed: false,
        skipped: true,
        skippedReason: 'particle-driven-glow',
        materialIndex: null,
      });
      continue;
    }
    const particleAnchorPlaceholder = data.particleEmitters?.length
      && blend === 0
      && /(?:^|\\)64\.blp$/i.test(texturePath);
    if (particleAnchorPlaceholder) {
      debugPasses.push({
        ...pass,
        texturePath,
        textureLoaded: !!texture,
        fallbackUsed: false,
        skipped: true,
        skippedReason: 'particle-anchor-placeholder',
        materialIndex: null,
      });
      continue;
    }
    // Particle/light passes are usually alpha textured. A flat fallback turns
    // their billboard or cone into a large opaque triangle.
    if (!texture && blend > 0) {
      debugPasses.push({ ...pass, texturePath: source?.path || pass.texturePath || null, textureLoaded: false, fallbackUsed: false, skipped: true, materialIndex: null });
      continue;
    }
    const passTexture = texture;
    if (!texture) texture = getFallbackTexture();
    if (texture && textureKey) textureByPath.set(textureKey, texture);
    materials.push(createM2PassMaterial(pass, texture));
    debugPasses.push({
      ...pass,
      texturePath: source?.path || pass.texturePath || null,
      textureLoaded: !!passTexture,
      fallbackUsed: !passTexture,
      skipped: false,
      materialIndex: materials.length - 1,
      alpha: passTexture?.userData?.debugAlpha || null,
    });
    usablePasses.push(pass);
  }

  for (const entry of data.particleTextures || []) {
    if (!entry?.rgba || !entry.w || !entry.h) continue;
    const pathKey = entry.path?.toLowerCase();
    let texture = pathKey ? particleTextureByPath.get(pathKey) : null;
    if (!texture) texture = createM2Texture(entry, textureRefs);
    if (!texture) continue;
    if (pathKey) particleTextureByPath.set(pathKey, texture);
    particleTextures.set(entry.emitterIndex, texture);
  }

  if (renderPasses.length) {
    geo.clearGroups();
    usablePasses.forEach((pass, index) => geo.addGroup(pass.indexStart, pass.indexCount, index));
    if (!usablePasses.length) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
  }

  return {
    geo,
    texture: fallbackTexture,
    textureRefs,
    materials,
    particleEmitters: data.particleEmitters || [],
    particleTextures,
    animationData: data.animationData || null,
    modelPath: data.modelPath ?? null,
    texturePath: data.texturePath ?? null,
    debug: { type: 'm2', modelPath: data.modelPath ?? null, renderPasses: debugPasses },
  };
}

function queueM2Build(data) {
  return new Promise((resolve) => {
    m2BuildQueue.push({ data, resolve });
    if (m2BuildFrame != null) return;
    const flush = () => {
      m2BuildFrame = null;
      for (let i = 0; i < BUILD_BATCH_PER_FRAME && m2BuildQueue.length; i += 1) {
        const next = m2BuildQueue.shift();
        try { next.resolve(buildM2Asset(next.data)); }
        catch (_) { next.resolve(null); }
      }
      if (m2BuildQueue.length) m2BuildFrame = requestAnimationFrame(flush);
    };
    m2BuildFrame = requestAnimationFrame(flush);
  });
}

export function fetchM2Model(displayId) {
  if (m2PromiseCache.has(displayId)) return m2PromiseCache.get(displayId);
  const promise = window.azeroth.m2.loadModel({ displayId }).then(async res => {
    const asset = (res?.success && res.data) ? await queueM2Build(res.data) : null;
    m2ResultCache.set(displayId, asset);
    notifyM2Cache(displayId);
    return asset;
  }).catch(() => {
    m2ResultCache.set(displayId, null);
    notifyM2Cache(displayId);
    return null;
  }).finally(() => {
    m2PromiseCache.delete(displayId);
  });
  m2PromiseCache.set(displayId, promise);
  return promise;
}

export function fetchM2ModelByPath(modelPath) {
  const key = normalizeM2Path(modelPath);
  if (!key) return Promise.resolve(null);
  if (m2PathPromiseCache.has(key)) return m2PathPromiseCache.get(key);
  if (m2PathResultCache.has(key)) return Promise.resolve(m2PathResultCache.get(key));

  const promise = window.azeroth.m2.loadModelByPath({ modelPath: key }).then(async result => {
    const asset = result?.success && result.data ? await queueM2Build(result.data) : null;
    m2PathResultCache.set(key, asset);
    notifyM2PathCache();
    return asset;
  }).catch(() => {
    m2PathResultCache.set(key, null);
    notifyM2PathCache();
    return null;
  }).finally(() => m2PathPromiseCache.delete(key));
  m2PathPromiseCache.set(key, promise);
  return promise;
}

export function prefetchM2Models(displayIds) {
  if (!window.azeroth?.m2?.prefetch || !displayIds?.length) return;
  window.azeroth.m2.prefetch({ displayIds });
}

export function useM2Model(displayId, enabled) {
  const [asset, setAsset] = useState(() => m2ResultCache.get(displayId) ?? null);
  useEffect(() => {
    if (!enabled || !displayId || !window.azeroth?.m2) return;
    if (m2ResultCache.has(displayId)) {
      setAsset(m2ResultCache.get(displayId));
      return;
    }
    fetchM2Model(displayId).then(setAsset);
  }, [displayId, enabled]);
  return asset;
}
