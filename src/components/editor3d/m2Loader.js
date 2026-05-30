import { useState, useEffect } from 'react';
import * as THREE from 'three';

const m2PromiseCache   = new Map();
const m2ResultCache    = new Map();
const m2MaterialCache  = new Map();
const m2GlobalListeners = new Set();            // brede listeners (Inspector, InstanceLayers)
const m2AssetListeners  = new Map();            // displayId → Set<fn>  (per-spawn)

function notifyM2Cache(displayId) {
  // Notificeer alleen de spawns die dit displayId hebben
  m2AssetListeners.get(displayId)?.forEach(fn => fn());
  // Notificeer globale listeners (Inspector, InstanceLayers)
  m2GlobalListeners.forEach(fn => fn());
}

export function subscribeM2Cache(listener) {
  m2GlobalListeners.add(listener);
  return () => m2GlobalListeners.delete(listener);
}

export function subscribeM2Asset(displayId, fn) {
  if (!displayId) return () => {};
  if (!m2AssetListeners.has(displayId)) m2AssetListeners.set(displayId, new Set());
  m2AssetListeners.get(displayId).add(fn);
  return () => m2AssetListeners.get(displayId)?.delete(fn);
}

export function getCachedM2Asset(displayId) {
  if (!displayId) return null;
  return m2ResultCache.get(displayId) ?? null;
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
  const key = asset.texture?.uuid ?? 'flat';
  if (!m2MaterialCache.has(key)) {
    m2MaterialCache.set(key, asset.texture
      ? new THREE.MeshLambertMaterial({
          map: asset.texture,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.1,
        })
      : new THREE.MeshLambertMaterial({
          color: '#ccaa88',
          side: THREE.DoubleSide,
        }));
  }
  return m2MaterialCache.get(key);
}

export {
  MODEL_LOAD_DIST,
  BILLBOARD_LOD_DIST,
  MODEL_PREFETCH_DIST,
} from './spawnLod';

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

export function buildM2Asset(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(toFloat32Array(data.positions), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(toFloat32Array(data.normals), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(toFloat32Array(data.uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(toUint32Array(data.indices), 1));

  let texture = null;
  if (data.textureRgba && data.textureW && data.textureH) {
    const rgba = toUint8Array(data.textureRgba);
    texture = new THREE.DataTexture(rgba, data.textureW, data.textureH, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.flipY = false;
  }

  return {
    geo,
    texture,
    modelPath: data.modelPath ?? null,
    texturePath: data.texturePath ?? null,
    debug: data.debug ?? null,
  };
}

export function fetchM2Model(displayId) {
  if (m2PromiseCache.has(displayId)) return m2PromiseCache.get(displayId);
  const promise = window.azeroth.m2.loadModel({ displayId }).then(res => {
    const asset = (res?.success && res.data) ? buildM2Asset(res.data) : null;
    if (asset?.debug) console.log(`[m2:${displayId}]`, asset.debug);
    m2ResultCache.set(displayId, asset);
    notifyM2Cache(displayId);
    return asset;
  }).catch(() => {
    m2ResultCache.set(displayId, null);
    notifyM2Cache(displayId);
    return null;
  });
  m2PromiseCache.set(displayId, promise);
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
