import { useEffect, useState } from 'react';
import * as THREE from 'three';

const wmoPromiseCache = new Map();
const wmoResultCache = new Map();
const wmoListeners = new Set();
const WMO_CACHE_MAX = 24;
const BUILD_BATCH_PER_FRAME = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 4) >= 8 ? 3 : 1;
const wmoBuildQueue = [];
let wmoBuildFrame = null;
const WMO_SHADER_TEXTURE_COUNTS = new Map([
  [3, 2], [5, 2], [6, 2], [7, 3], [8, 2], [9, 2],
  [11, 3], [12, 3], [13, 2], [15, 2], [17, 3],
]);
const WMO_LAYER_SHADERS = new Set([6, 7, 8, 9, 11, 12, 13, 15, 17]);
const WMO_EMISSIVE_SHADERS = new Set([9, 12, 15]);
const sharedWmoTextures = new Map();
const sharedWmoTextureEntries = new WeakMap();

function normalizePath(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function cacheKey(modelPath, includeTextures = false) {
  const path = normalizePath(modelPath);
  return path ? `${path}|${includeTextures ? 'textured' : 'geometry'}` : '';
}

function toFloat32Array(value) {
  if (value instanceof Float32Array) return value;
  return new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4);
}

function toUint32Array(value) {
  if (value instanceof Uint32Array) return value;
  return new Uint32Array(value.buffer, value.byteOffset, value.byteLength / 4);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function wmoShaderTextureCount(shader) {
  return WMO_SHADER_TEXTURE_COUNTS.get(Number(shader)) || 1;
}

function releaseWmoTexture(texture) {
  if (!texture) return;
  const entry = sharedWmoTextureEntries.get(texture);
  if (!entry) {
    texture.dispose();
    return;
  }
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (sharedWmoTextures.get(entry.key)?.texture === texture) sharedWmoTextures.delete(entry.key);
  sharedWmoTextureEntries.delete(texture);
  texture.dispose();
}

function createTexture(material, suffix = '') {
  const rgba = material?.[`texture${suffix}Rgba`];
  const width = material?.[`texture${suffix}W`];
  const height = material?.[`texture${suffix}H`];
  if (!rgba || !width || !height) return null;
  const texturePath = normalizePath(material?.[`texture${suffix}Path`]);
  const cached = texturePath ? sharedWmoTextures.get(texturePath) : null;
  if (cached) {
    cached.refs += 1;
    return cached.texture;
  }
  const bytes = toUint8Array(rgba);
  let alphaMin = 255;
  let alphaMax = 0;
  for (let index = 3; index < bytes.length; index += 4) {
    alphaMin = Math.min(alphaMin, bytes[index]);
    alphaMax = Math.max(alphaMax, bytes[index]);
  }
  const texture = new THREE.DataTexture(
    bytes,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.userData.debugAlpha = { min: alphaMin, max: alphaMax, hasTransparency: alphaMin < 255 };
  texture.flipY = false;
  const useClamp = !!(Number(material.flags) & 0x40) && !(Number(material.flags) & 0x80);
  texture.wrapS = useClamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.wrapT = useClamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.needsUpdate = true;
  const canMipMap = THREE.MathUtils.isPowerOfTwo(width) && THREE.MathUtils.isPowerOfTwo(height);
  texture.generateMipmaps = canMipMap;
  texture.minFilter = canMipMap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (texturePath) {
    const entry = { key: texturePath, texture, refs: 1 };
    sharedWmoTextures.set(texturePath, entry);
    sharedWmoTextureEntries.set(texture, entry);
  }
  return texture;
}

function buildWmoAsset(data) {
  const textureRefs = [];
  const materials = (data.materials || []).map(material => {
    const textureCount = wmoShaderTextureCount(material.shader);
    const texture = createTexture(material);
    const texture2 = textureCount >= 2 ? createTexture(material, '2') : null;
    const texture3 = textureCount >= 3 ? createTexture(material, '3') : null;
    for (const value of [texture, texture2, texture3]) if (value) textureRefs.push(value);
    return { ...material, texture, texture2, texture3 };
  });
  const debugMaterials = materials.map((material, index) => ({
    index,
    flags: material.flags,
    shader: material.shader,
    blendMode: material.blendMode,
    texturePath: material.texturePath || null,
    texturePath2: material.texturePath2 || null,
    texturePath3: material.texturePath3 || null,
    textureLoaded: !!material.texture,
    texture2Loaded: !!material.texture2,
    texture3Loaded: !!material.texture3,
    alpha: material.texture?.userData?.debugAlpha || null,
  }));
  const liquids = Object.entries(data.groupLiquids || {}).map(([groupIndex, liquid]) => ({
    ...liquid,
    groupIndex: Number(groupIndex),
    texture: materials[liquid.materialId]?.texture || null,
  }));
  const meshes = (data.meshes || []).map((mesh, index) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(toFloat32Array(mesh.positions), 3));
    if (mesh.normals?.length) geometry.setAttribute('normal', new THREE.BufferAttribute(toFloat32Array(mesh.normals), 3));
    if (mesh.uvs?.length) geometry.setAttribute('uv', new THREE.BufferAttribute(toFloat32Array(mesh.uvs), 2));
    if (mesh.uvs2?.length) geometry.setAttribute('wmoUv2', new THREE.BufferAttribute(toFloat32Array(mesh.uvs2), 2));
    if (mesh.colors?.length) geometry.setAttribute('wmoColor', new THREE.BufferAttribute(toFloat32Array(mesh.colors), 4));
    geometry.setIndex(new THREE.BufferAttribute(toUint32Array(mesh.indices), 1));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    if (mesh.bounds?.min && mesh.bounds?.max) {
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(...mesh.bounds.min),
        new THREE.Vector3(...mesh.bounds.max),
      );
    } else {
      geometry.computeBoundingBox();
    }

    const materialData = materials[mesh.materialIndex] || {};
    const blendMode = Number(materialData.blendMode) || 0;
    const shaderId = Number(materialData.shader) || 0;
    const isLayered = WMO_LAYER_SHADERS.has(shaderId) && !!materialData.texture2;
    const isEmissive = WMO_EMISSIVE_SHADERS.has(shaderId);
    // Missing alpha textures must not become opaque placeholder polygons.
    if (!materialData.texture && blendMode > 0) return null;
    const material = new THREE.MeshLambertMaterial({
      color: materialData.texture ? '#ffffff' : '#b9a88b',
      map: materialData.texture || null,
      side: THREE.DoubleSide,
      transparent: blendMode > 0,
      alphaTest: blendMode === 1 ? 0.5 : 0,
      depthWrite: blendMode === 0,
    });
    material.userData.wmoTextures = [materialData.texture2, materialData.texture3].filter(Boolean);
    if (isLayered) {
      const hasVertexColors = !!mesh.hasVertexColors;
      const defaultUv2 = mesh.uvs2?.length ? null : new Float32Array((mesh.positions?.length || 0) / 3 * 2).fill(0);
      if (!geometry.getAttribute('wmoUv2')) {
        const uv = geometry.getAttribute('uv');
        geometry.setAttribute('wmoUv2', uv || new THREE.BufferAttribute(defaultUv2, 2));
      }
      if (!geometry.getAttribute('wmoColor')) {
        geometry.setAttribute('wmoColor', new THREE.BufferAttribute(new Float32Array((mesh.positions?.length || 0) / 3 * 4).fill(1), 4));
      }
      material.userData.wmoTexture2 = materialData.texture2;
      material.userData.wmoTexture3 = materialData.texture3 || null;
      material.onBeforeCompile = shaderProgram => {
        shaderProgram.uniforms.wmoTexture2 = { value: materialData.texture2 };
        if (materialData.texture3) shaderProgram.uniforms.wmoTexture3 = { value: materialData.texture3 };
        shaderProgram.uniforms.wmoLayerEnabled = { value: hasVertexColors ? 1 : 0 };
        shaderProgram.uniforms.wmoLayerMode = { value: isEmissive ? 1 : 0 };
        shaderProgram.vertexShader = shaderProgram.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 wmoUv2;\nattribute vec4 wmoColor;\nvarying vec2 vWmoUv2;\nvarying vec4 vWmoColor;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWmoUv2 = wmoUv2;\n\tvWmoColor = wmoColor;');
        const texture3Uniform = materialData.texture3 ? 'uniform sampler2D wmoTexture3;\n' : '';
        const texture3Sample = materialData.texture3 ? 'vec4 wmoTexture3Color = texture2D(wmoTexture3, vWmoUv2);\n\tdiffuseColor.rgb += wmoTexture3Color.rgb * wmoLayerWeight;\n' : '';
        shaderProgram.fragmentShader = shaderProgram.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform sampler2D wmoTexture2;\n${texture3Uniform}uniform float wmoLayerEnabled;\nuniform float wmoLayerMode;\nvarying vec2 vWmoUv2;\nvarying vec4 vWmoColor;`)
          .replace('#include <map_fragment>', `#include <map_fragment>\n\tvec4 wmoLayerColor = texture2D(wmoTexture2, vWmoUv2);\n\tfloat wmoLayerWeight = wmoLayerEnabled * clamp(vWmoColor.a, 0.0, 1.0);\n\tif (wmoLayerMode > 0.5) diffuseColor.rgb += wmoLayerColor.rgb * wmoLayerWeight;\n\telse diffuseColor.rgb = mix(diffuseColor.rgb, wmoLayerColor.rgb, wmoLayerWeight);\n\t${texture3Sample}`);
      };
      material.customProgramCacheKey = () => `wmo-layer-${shaderId}-${materialData.texture3 ? '3' : '2'}-${isEmissive ? 'emissive' : 'mix'}`;
    }
    return { index, groupIndex: mesh.groupIndex ?? -1, geometry, material, materialIndex: mesh.materialIndex, debugMaterial: debugMaterials[mesh.materialIndex] || null };
  }).filter(mesh => mesh && mesh.geometry.getAttribute('position')?.count && mesh.geometry.index?.count);

  return {
    modelPath: data.modelPath || null,
    meshes,
    textureRefs,
    doodads: data.doodads || [],
    doodadSets: data.doodadSets || [],
    groupDoodadRefs: data.groupDoodadRefs || {},
    liquids,
    skyboxPath: data.skyboxPath || null,
    portalData: data.portalData || null,
    debug: { type: 'wmo', modelPath: data.modelPath || null, materials: debugMaterials },
  };
}

function notifyWmoCache() {
  wmoListeners.forEach(listener => listener());
}

export function subscribeWmoCache(listener) {
  wmoListeners.add(listener);
  return () => wmoListeners.delete(listener);
}

export function getCachedWmoAsset(modelPath, preferTextures = true, allowFallback = true) {
  const texturedKey = cacheKey(modelPath, true);
  const geometryKey = cacheKey(modelPath, false);
  if (preferTextures && !allowFallback) {
    if (!wmoResultCache.has(texturedKey)) return null;
    const textured = wmoResultCache.get(texturedKey);
    if (!textured) return null;
    wmoResultCache.delete(texturedKey);
    wmoResultCache.set(texturedKey, textured);
    return textured;
  }
  const preferredKey = preferTextures ? texturedKey : geometryKey;
  const alternateKey = preferTextures ? geometryKey : texturedKey;
  const preferred = wmoResultCache.get(preferredKey);
  const alternate = wmoResultCache.get(alternateKey);
  const key = wmoResultCache.get(texturedKey)
    ? texturedKey
    : (preferred || alternate ? (preferred ? preferredKey : alternateKey) : null);
  if (!key || !wmoResultCache.has(key)) return null;
  const asset = wmoResultCache.get(key);
  wmoResultCache.delete(key);
  wmoResultCache.set(key, asset);
  return asset;
}

export function getWmoAssetState(modelPath, includeTextures = true) {
  const preferredKey = cacheKey(modelPath, includeTextures);
  const alternateKey = cacheKey(modelPath, !includeTextures);
  if (!preferredKey) return 'none';
  if (wmoPromiseCache.has(preferredKey)) return 'loading';
  if (includeTextures) {
    if (wmoResultCache.has(preferredKey)) return wmoResultCache.get(preferredKey) ? 'loaded' : 'failed';
    return 'idle';
  }
  if (wmoPromiseCache.has(alternateKey)) return 'loading';
  if (wmoResultCache.has(preferredKey)) return wmoResultCache.get(preferredKey) ? 'loaded' : 'failed';
  if (wmoResultCache.has(alternateKey)) return wmoResultCache.get(alternateKey) ? 'loaded' : 'failed';
  return 'idle';
}

export function getWmoPendingCount() {
  return wmoPromiseCache.size;
}

function disposeWmoAsset(asset) {
  if (!asset) return;
  for (const mesh of asset.meshes || []) {
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
  for (const texture of asset.textureRefs || []) {
    releaseWmoTexture(texture);
  }
}

export function pruneWmoAssetCache(keepPaths = []) {
  const keep = new Set(keepPaths.flatMap(path => [cacheKey(path, false), cacheKey(path, true)]));
  for (const key of [...wmoResultCache.keys()]) {
    if (keep.has(key)) continue;
    disposeWmoAsset(wmoResultCache.get(key));
    wmoResultCache.delete(key);
  }
  while (wmoResultCache.size > WMO_CACHE_MAX) {
    const candidate = [...wmoResultCache.keys()].find(key => !keep.has(key));
    if (!candidate) break;
    disposeWmoAsset(wmoResultCache.get(candidate));
    wmoResultCache.delete(candidate);
  }
}

function queueWmoBuild(data) {
  return new Promise(resolve => {
    wmoBuildQueue.push({ data, resolve });
    if (wmoBuildFrame != null) return;
    const flush = () => {
      wmoBuildFrame = null;
      for (let i = 0; i < BUILD_BATCH_PER_FRAME && wmoBuildQueue.length; i += 1) {
        const next = wmoBuildQueue.shift();
        try {
          const asset = buildWmoAsset(next.data);
          next.resolve(asset);
        }
        catch (_) { next.resolve(null); }
      }
      if (wmoBuildQueue.length) wmoBuildFrame = requestAnimationFrame(flush);
    };
    wmoBuildFrame = requestAnimationFrame(flush);
  });
}

export function fetchWmoAsset(modelPath, { includeTextures = true } = {}) {
  const key = cacheKey(modelPath, includeTextures);
  if (!key) return Promise.resolve(null);
  if (wmoPromiseCache.has(key)) return wmoPromiseCache.get(key);
  if (wmoResultCache.has(key)) return Promise.resolve(wmoResultCache.get(key));

  const promise = window.azeroth.wmo.loadAsset({ modelPath, includeTextures })
    .then(async result => {
      const data = result?.success && result.data ? result.data : null;
      const asset = data ? await queueWmoBuild(data) : null;
      wmoResultCache.set(key, asset);
      notifyWmoCache();
      return asset;
    })
    .catch(() => {
      wmoResultCache.set(key, null);
      notifyWmoCache();
      return null;
    })
    .finally(() => wmoPromiseCache.delete(key));
  wmoPromiseCache.set(key, promise);
  return promise;
}

export function useWmoAsset(modelPath, enabled = true) {
  const key = normalizePath(modelPath);
  const [asset, setAsset] = useState(() => (key ? getCachedWmoAsset(key) : null));
  useEffect(() => {
    if (!enabled || !key || !window.azeroth?.wmo) return undefined;
    if (wmoResultCache.has(key)) {
      setAsset(wmoResultCache.get(key));
      return undefined;
    }
    let active = true;
    fetchWmoAsset(modelPath, { includeTextures: true }).then(value => { if (active) setAsset(value); });
    return () => { active = false; };
  }, [enabled, key, modelPath]);
  return asset;
}
