import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useConnection } from '../../lib/ConnectionContext';
import { Loader2 } from 'lucide-react';

function toF32(arr) {
  if (arr instanceof Float32Array) return arr;
  return new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}
function toU32(arr) {
  if (arr instanceof Uint32Array) return arr;
  return new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

// WotLK 3.3.5's 256x256 character atlas. Unlike modern clients, it has no
// CharComponentTextureLayouts/Sections DB2; the component BLP dimensions and
// the character skin UV atlas use these fixed legacy partitions.
const WOTLK_CHARACTER_ATLAS_REGIONS = {
  armUpper: [0, 0, 128, 64], armLower: [0, 64, 128, 64], hands: [0, 128, 128, 32],
  'face-upper': [0, 160, 128, 32], 'face-lower': [0, 192, 128, 64],
  torsoUpper: [128, 0, 128, 64], torsoLower: [128, 64, 128, 32],
  legUpper: [128, 96, 128, 64], legLower: [128, 160, 128, 64], feet: [128, 224, 128, 32],
};
function characterAtlasRect(region, width, height) {
  const source = WOTLK_CHARACTER_ATLAS_REGIONS[region];
  if (!source) return null;
  const [x, y, rectWidth, rectHeight] = source;
  return { x: x * width / 256, y: y * height / 256, width: rectWidth * width / 256, height: rectHeight * height / 256 };
}
function buildIndices(vertexLookup, indexLookup, skinSubmeshes, enabledSubmeshIndices) {
  if (enabledSubmeshIndices == null) {
    const out = [];
    for (const sm of skinSubmeshes) {
      for (let i = 0; i < sm.indexCount; i++) {
        const triIdx = indexLookup[sm.indexStart + i];
        out.push(vertexLookup[triIdx] ?? 0);
      }
    }
    return out;
  }
  const out = [];
  for (const idx of enabledSubmeshIndices) {
    const sm = skinSubmeshes[idx];
    if (!sm) continue;
    for (let i = 0; i < sm.indexCount; i++) {
      const triIdx = indexLookup[sm.indexStart + i];
      out.push(vertexLookup[triIdx] ?? 0);
    }
  }
  return out;
}

const GROUP_DEBUG_COLORS = {
  '-1': [0.55, 0.55, 0.55],
  '1':  [0.91, 0.30, 0.24],
  '2':  [0.95, 0.61, 0.07],
  '3':  [0.95, 0.77, 0.06],
  '4':  [0.18, 0.80, 0.44],
  '5':  [0.10, 0.74, 0.61],
  '6':  [0.80, 0.50, 0.20],
  '7':  [0.15, 0.68, 0.38],
  '8':  [0.20, 0.60, 0.86],
  '9':  [0.61, 0.35, 0.71],
  '10': [0.90, 0.49, 0.13],
  '11': [0.10, 0.32, 0.46],
  '12': [0.56, 0.27, 0.68],
  '13': [0.75, 0.22, 0.17],
  '14': [0.50, 0.55, 0.55],
  '15': [0.17, 0.24, 0.31],
  '17': [0.83, 0.33, 0.00],
  '18': [0.49, 0.24, 0.60],
};

function geosetGroup(id) {
  return id < 100 ? -1 : Math.floor(id / 100);
}

function buildColorBuffer(vertexCount, enabledIndices, skinData) {
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = 0.3; colors[i * 3 + 1] = 0.3; colors[i * 3 + 2] = 0.3;
  }
  if (!skinData) return colors;
  const { vertexLookup, indexLookup, submeshes } = skinData;
  const indices = enabledIndices && enabledIndices.length ? enabledIndices : submeshes.map((_, i) => i);
  for (const idx of indices) {
    const sm = submeshes[idx];
    if (!sm) continue;
    const g = geosetGroup(sm.id);
    const c = GROUP_DEBUG_COLORS[String(g)] || [0.5, 0.5, 0.5];
    for (let i = 0; i < sm.indexCount; i++) {
      const triIdx = indexLookup[sm.indexStart + i];
      const vi = vertexLookup[triIdx] ?? 0;
      colors[vi * 3] = c[0]; colors[vi * 3 + 1] = c[1]; colors[vi * 3 + 2] = c[2];
    }
  }
  return colors;
}

// Scene houdt de Canvas altijd gemount; texture wordt in-place geÃƒÂ¼pdatet
// zodat de WebGL context nooit opnieuw aangemaakt hoeft te worden.
function CharScene({ geoRef, hairGeoRef, textureRef, hairTextureRef, hairMaterialRef, noTexRef, colorDebug }) {
  const matRef = useRef(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.05, color: '#44cc44' }));
  const hairMatRef = useRef(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.05, color: '#ffffff' }));
  useEffect(() => { hairMaterialRef.current = hairMatRef.current; return () => { if (hairMaterialRef.current === hairMatRef.current) hairMaterialRef.current = null; }; }, [hairMaterialRef]);
  useEffect(() => {
    const mat = matRef.current; const hair = hairMatRef.current;
    if (colorDebug) { mat.map = null; mat.vertexColors = true; mat.color.set('#ffffff'); hair.map = null; hair.color.set('#ff66cc'); }
    else { mat.vertexColors = false; mat.map = textureRef?.current || null; mat.color.set(textureRef?.current ? '#ffffff' : (noTexRef?.current ? '#44cc44' : '#ccaa88')); hair.map = hairTextureRef?.current || textureRef?.current || null; hair.color.set('#ffffff'); }
    mat.needsUpdate = true; hair.needsUpdate = true;
  });
  return <>{geoRef?.current && <mesh geometry={geoRef.current} material={matRef.current} />}{hairGeoRef?.current && <mesh geometry={hairGeoRef.current} material={hairMatRef.current} />}</>;
}

function CharacterRenderPass({ pass, textureRef, hairTextureRef, colorDebug, textureVersion }) {
  const material = useMemo(() => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: pass.blend === 1 ? 0.7 : 0, transparent: pass.blend >= 2, depthWrite: !pass.noDepthWrite }), [pass]);
  useEffect(() => {
    if (colorDebug) { material.map = null; material.color.set(pass.textureType === 6 ? '#ff66cc' : '#44ccff'); material.vertexColors = false; }
    else {
      material.map = pass.textureType === 6 ? hairTextureRef.current : textureRef.current;
      material.color.set('#ffffff'); material.vertexColors = false;
      material.transparent = pass.blend >= 2; material.alphaTest = pass.blend === 1 ? 0.7 : 0;
      material.depthWrite = !pass.noDepthWrite;
      material.blending = pass.blend === 3 || pass.blend === 4 ? THREE.AdditiveBlending : pass.blend >= 5 ? THREE.CustomBlending : THREE.NormalBlending;
      if (pass.blend >= 5) { material.blendSrc = THREE.DstColorFactor; material.blendDst = THREE.SrcColorFactor; }
    }
    material.needsUpdate = true;
  }, [pass, textureRef, hairTextureRef, colorDebug, textureVersion, material]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={pass.geometry} material={material} renderOrder={pass.order ?? pass.index} />;
}

function CharacterPassScene({ passes, textureRef, hairTextureRef, colorDebug, textureVersion }) {
  return <>{passes.map(pass => <CharacterRenderPass key={`${pass.index}-${pass.submeshIndex}`} pass={pass} textureRef={textureRef} hairTextureRef={hairTextureRef} colorDebug={colorDebug} textureVersion={textureVersion} />)}</>;
}
function AttachedM2Pass({ pass, data, texture }) {
  const geometry = useMemo(() => {
    const skinData = data?.skinData;
    if (!data?.positions || !skinData || !Number.isInteger(pass?.submeshIndex)) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(toF32(data.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(toF32(data.normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(toF32(data.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buildIndices(skinData.vertexLookup, skinData.indexLookup, skinData.submeshes, [pass.submeshIndex])), 1));
    return geometry;
  }, [data, pass]);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: pass?.blend === 1 ? 0.7 : 0, transparent: (pass?.blend || 0) >= 2, depthWrite: !pass?.noDepthWrite, blending: pass?.blend === 3 || pass?.blend === 4 ? THREE.AdditiveBlending : THREE.NormalBlending }), [pass, texture]);
  useEffect(() => () => { geometry?.dispose(); material.dispose(); }, [geometry, material]);
  return geometry?.getIndex()?.count ? <mesh geometry={geometry} material={material} renderOrder={pass.order ?? pass.index}/> : null;
}
function AttachedM2({ model, anchor }) {
  const [data, setData] = useState(null);
  useEffect(() => { let cancelled = false; if (!model?.modelPath || !window.azeroth?.m2?.loadModelByPath) { setData(null); return undefined; } window.azeroth.m2.loadModelByPath({ modelPath: model.modelPath, texturePath: model.texturePath || '' }).then(result => { if (!cancelled) setData(result?.success ? result.data : null); }).catch(() => { if (!cancelled) setData(null); }); return () => { cancelled = true; }; }, [model?.modelPath, model?.texturePath]);
  const texture = useMemo(() => { if (!data?.textureRgba || !data.textureW || !data.textureH) return null; const texture = new THREE.DataTexture(new Uint8Array(data.textureRgba), data.textureW, data.textureH, THREE.RGBAFormat); texture.flipY = false; texture.needsUpdate = true; return texture; }, [data]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!anchor || !data) return null;
  const offset = model.offset || [0, 0, 0];
  const passes = data.renderPasses?.length ? data.renderPasses : data.skinData?.submeshes.map((_, submeshIndex) => ({ index: submeshIndex, submeshIndex, blend: 0, order: submeshIndex })) || [];
  return <group position={[anchor[0] + offset[0], anchor[1] + offset[1], anchor[2] + offset[2]]}>{passes.map(pass => <AttachedM2Pass key={`${pass.index}:${pass.submeshIndex}`} pass={pass} data={data} texture={texture}/>)}</group>;
}
export default function CharM2Viewer({ race, gender, skinBlp, textureLayers = [], appearance = {}, enabledSubmeshIndices = null, onSubmeshes, active, modelPath: creatureModelPath, colorDebug = false, attachedModels = [], itemGeosets = {} }) {
  const { worldmapMpqPath } = useConnection();

  const [mounted, setMounted]     = useState(false);
  const [geoReady, setGeoReady]   = useState(false);
  const [geoLoading, setGeoLoad]  = useState(false);
  const [geoError, setGeoError]   = useState(null);
  const [texLoading, setTexLoad]  = useState(false);
  const [noTex, setNoTex]         = useState(false);
  const [textureVersion, setTextureVersion] = useState(0);
  const [renderPasses, setRenderPasses] = useState([]);
  const [headAnchor, setHeadAnchor] = useState(null);
  const [attachmentPoints, setAttachmentPoints] = useState({});

  // Refs zodat CharScene altijd de laatste waarden ziet zonder herrender
  const geoRef     = useRef(null);
  const hairGeoRef = useRef(null);
  const hairTextureRef = useRef(null);
  const hairMaterialRef = useRef(null);
  const hairSubmeshRef = useRef([]);
  const textureRef = useRef(null);
  const noTexRef   = useRef(false);
  const geoKey     = useRef(null);
  const texKey     = useRef(null);
  const skinDataRef = useRef(null);
  const geoCacheRef = useRef(null);
  const serverDefaultRef = useRef(null);

  const isCreatureModel = !!creatureModelPath;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Geometry laden Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (!active) return;

    if (isCreatureModel) {
      if (!window.azeroth?.m2?.loadModelByPath) return;
      const key = `path:${creatureModelPath}`;
      if (geoKey.current === key) return;
      geoKey.current = key;

      setGeoLoad(true);
      setGeoError(null);
      setGeoReady(false);
      setMounted(true);

      window.azeroth.m2.loadModelByPath({ modelPath: creatureModelPath })
        .then(res => {
          if (geoKey.current !== key) return;
          if (res?.success && res.data) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(toF32(res.data.positions), 3));
            g.setAttribute('normal',   new THREE.BufferAttribute(toF32(res.data.normals),   3));
            g.setAttribute('uv',       new THREE.BufferAttribute(toF32(res.data.uvs),       2));
            g.setIndex(new THREE.BufferAttribute(toU32(res.data.indices), 1));
            const passMeshes = (res.data.renderPasses || []).map(pass => {
              const pg = new THREE.BufferGeometry();
              pg.setAttribute('position', g.getAttribute('position'));
              pg.setAttribute('normal', g.getAttribute('normal'));
              pg.setAttribute('uv', g.getAttribute('uv'));
              pg.setIndex(new THREE.BufferAttribute(new Uint32Array(buildIndices(res.data.skinData.vertexLookup, res.data.skinData.indexLookup, res.data.skinData.submeshes, [pass.submeshIndex])), 1));
              return { ...pass, geometry: pg };
            }).filter(pass => pass.geometry.getIndex()?.count);
                        g.computeBoundingBox();
            const box = g.boundingBox;
            setHeadAnchor(box ? [
              (box.min.x + box.max.x) / 2,
              box.max.y - (box.max.y - box.min.y) * 0.12,
              (box.min.z + box.max.z) / 2,
            ] : null);
            setRenderPasses(passMeshes);            geoRef.current = g;
            setGeoReady(true);
            if (onSubmeshes && res.data.submeshes) onSubmeshes(res.data.submeshes, res.data.activeSubmeshIndices);
            // Creature texture comes embedded in the IPC response
            if (res.data.textureRgba && res.data.textureW && res.data.textureH) {
              const tex = new THREE.DataTexture(new Uint8Array(res.data.textureRgba), res.data.textureW, res.data.textureH, THREE.RGBAFormat);
              tex.needsUpdate = true;
              tex.flipY = false;
              textureRef.current = tex;
              noTexRef.current = false;
              setNoTex(false);
            }
          } else {
            setGeoError(res?.error ?? 'Model laden mislukt');
          }
          setGeoLoad(false);
        })
        .catch(e => {
          if (geoKey.current !== key) return;
          setGeoError(e.message);
          setGeoLoad(false);
        });
      return;
    }

    if (!window.azeroth?.m2?.loadCharModel) return;

    // Alleen hairstyle en facial feature wijzigen geosets; skin, face en colors zijn texture-only.
    const modelKey = `${race}/${gender}/${appearance.hairStyle || 0}/${appearance.facialHair || 0}/${JSON.stringify(itemGeosets)}`;
    const subKey = JSON.stringify(enabledSubmeshIndices);
    const fullKey = `${modelKey}|${subKey}`;

    if (geoKey.current === fullKey) return;

    // Model changed Ã¢â‚¬â€ full server load
    if (!geoKey.current?.startsWith(modelKey + '|')) {
      geoKey.current = fullKey;
      serverDefaultRef.current = null;
      skinDataRef.current = null;
      geoCacheRef.current = null;
      setGeoLoad(true);
      setGeoError(null);
      setGeoReady(false);
      setMounted(true);

      window.azeroth.m2.loadCharModel({ race, gender, skinBlp: null, appearance: { ...appearance, itemGeosets }, enabledSubmeshIndices: null })
        .then(res => {
          if (geoKey.current !== fullKey) return;
          if (res?.success && res.data) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(toF32(res.data.positions), 3));
            g.setAttribute('normal',   new THREE.BufferAttribute(toF32(res.data.normals),   3));
            g.setAttribute('uv',       new THREE.BufferAttribute(toF32(res.data.uvs),       2));

            skinDataRef.current = res.data.skinData || null;
            hairSubmeshRef.current = Array.from(res.data.hairSubmeshIndices || []);
            geoCacheRef.current = g;
            const serverActive = Array.from(res.data.activeSubmeshIndices);
            serverDefaultRef.current = serverActive;

            if (res.data.skinData) {
              const selected = enabledSubmeshIndices != null ? enabledSubmeshIndices : serverActive;
              const hairIndices = selected.filter(index => hairSubmeshRef.current.includes(index));
              const bodyIndices = selected.filter(index => !hairSubmeshRef.current.includes(index));
              const h = new THREE.BufferGeometry();
              h.setAttribute('position', g.getAttribute('position'));
              h.setAttribute('normal', g.getAttribute('normal'));
              h.setAttribute('uv', g.getAttribute('uv'));
              h.setIndex(new THREE.BufferAttribute(new Uint32Array(buildIndices(res.data.skinData.vertexLookup, res.data.skinData.indexLookup, res.data.skinData.submeshes, hairIndices)), 1));
              hairGeoRef.current = hairIndices.length ? h : null;
              const clientIndices = buildIndices(res.data.skinData.vertexLookup, res.data.skinData.indexLookup, res.data.skinData.submeshes, bodyIndices);
              g.setIndex(new THREE.BufferAttribute(new Uint32Array(clientIndices), 1));
            } else {
              const si = Array.from(res.data.indices);
              g.setIndex(new THREE.BufferAttribute(new Uint32Array(si), 1));
            }
            const passMeshes = (res.data.renderPasses || []).map(pass => {
              const pg = new THREE.BufferGeometry();
              pg.setAttribute('position', g.getAttribute('position'));
              pg.setAttribute('normal', g.getAttribute('normal'));
              pg.setAttribute('uv', g.getAttribute('uv'));
              pg.setIndex(new THREE.BufferAttribute(new Uint32Array(buildIndices(res.data.skinData.vertexLookup, res.data.skinData.indexLookup, res.data.skinData.submeshes, [pass.submeshIndex])), 1));
              return { ...pass, geometry: pg };
            }).filter(pass => pass.geometry.getIndex()?.count);
                        g.computeBoundingBox();
            const box = g.boundingBox;
            const points = Object.fromEntries((res.data.attachmentPoints || []).map(point => [point.id, point.position]));
            setAttachmentPoints(points);
            const helmetAttachment = points[11];
            setHeadAnchor(helmetAttachment || (box ? [
              (box.min.x + box.max.x) / 2,
              box.max.y - (box.max.y - box.min.y) * 0.12,
              (box.min.z + box.max.z) / 2,
            ] : null));            setRenderPasses(passMeshes);            geoRef.current = g;
            setGeoReady(true);
            if (onSubmeshes && res.data.submeshes) onSubmeshes(res.data.submeshes, serverActive);
          } else {
            setGeoError(res?.error ?? 'Model laden mislukt');
          }
          setGeoLoad(false);
        })
        .catch(e => {
          if (geoKey.current !== fullKey) return;
          setGeoError(e.message);
          setGeoLoad(false);
        });
    } else {
      // Only submesh indices changed Ã¢â‚¬â€ rebuild from cached skinData
      const sd = skinDataRef.current;
      const useIds = enabledSubmeshIndices != null ? enabledSubmeshIndices : serverDefaultRef.current;
      if (sd && sd.vertexLookup && sd.indexLookup && sd.submeshes && useIds) {
        geoKey.current = fullKey;
        const clientIndices = buildIndices(sd.vertexLookup, sd.indexLookup, sd.submeshes, useIds);
        const g = geoCacheRef.current;
        if (g) {
          g.setIndex(new THREE.BufferAttribute(new Uint32Array(clientIndices), 1));
          g.computeBoundingBox?.();
          g.computeBoundingSphere?.();
          setGeoReady(true);
        }
      }
    }
  }, [active, isCreatureModel, creatureModelPath, race, gender, appearance.skin, appearance.face, appearance.hairStyle, appearance.hairColor, appearance.facialHair, JSON.stringify(itemGeosets), enabledSubmeshIndices]);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Texture laden (alleen voor player character modellen) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (isCreatureModel) return;
    const layers = textureLayers.map(layer => typeof layer === 'string' ? { path: layer } : layer).filter(layer => layer?.path);
    const sources = [{ path: skinBlp }, ...layers.filter(layer => layer.region !== 'hair-primary')].filter(layer => layer.path);
    if (!active || !sources.length || !worldmapMpqPath) { textureRef.current = null; noTexRef.current = sources.length > 0; setNoTex(noTexRef.current); return; }
    const key = `${worldmapMpqPath}|${appearance.face || 0}:${appearance.hairStyle || 0}:${appearance.hairColor || 0}:${appearance.facialHair || 0}|${sources.map(layer => `${layer.path}:${layer.region || ''}`).join('|')}`;
    if (texKey.current === key) return;
    texKey.current = key; setTexLoad(true);
    Promise.all(sources.map(layer => window.azeroth.dbc.readBlpTexture(worldmapMpqPath, layer.path).then(row => new Promise((resolve, reject) => { if (!row?.success || !row.png) return resolve(null); const img = new Image(); img.onload = () => resolve({ layer, img }); img.onerror = reject; img.src = `data:image/png;base64,${row.png}`; }))))
      .then(images => { if (texKey.current !== key || !images[0]?.img) return; const base=images[0].img,cvs=document.createElement('canvas');cvs.width=base.width;cvs.height=base.height;const ctx=cvs.getContext('2d');ctx.drawImage(base,0,0);for(const entry of images.slice(1)){if(!entry)continue;const rect=characterAtlasRect(entry.layer.region,cvs.width,cvs.height);if(rect)ctx.drawImage(entry.img,rect.x,rect.y,rect.width,rect.height);else if(entry.img.width===cvs.width&&entry.img.height===cvs.height)ctx.drawImage(entry.img,0,0);}const data=ctx.getImageData(0,0,cvs.width,cvs.height).data;const tex=new THREE.DataTexture(new Uint8Array(data),cvs.width,cvs.height,THREE.RGBAFormat);tex.needsUpdate=true;tex.flipY=false;textureRef.current=tex;noTexRef.current=false;setNoTex(false);setTextureVersion(v => v + 1);setTexLoad(false); })
      .catch(() => { if (texKey.current !== key) return; textureRef.current=null;noTexRef.current=true;setNoTex(true);setTexLoad(false); });
  }, [active, isCreatureModel, skinBlp, appearance.face, appearance.hairStyle, appearance.hairColor, appearance.facialHair, textureLayers.map(layer => typeof layer === 'string' ? layer : `${layer?.path || ''}:${layer?.region || ''}`).join('|'), worldmapMpqPath]);

  useEffect(() => {
    if (isCreatureModel) return;
    const hairLayer = textureLayers.map(layer => typeof layer === 'string' ? { path: layer } : layer).find(layer => layer?.region === 'hair-primary' && layer.path);
    if (!active || !hairLayer || !worldmapMpqPath) { hairTextureRef.current = null; if (hairMaterialRef.current) { hairMaterialRef.current.map = textureRef.current || null; hairMaterialRef.current.needsUpdate = true; } setTextureVersion(v => v + 1); return; }
    let cancelled = false;
    hairTextureRef.current = null;
    if (hairMaterialRef.current) { hairMaterialRef.current.map = textureRef.current || null; hairMaterialRef.current.needsUpdate = true; }
    setTextureVersion(v => v + 1);
    window.azeroth.dbc.readBlpTexture(worldmapMpqPath, hairLayer.path).then(row => {
      if (cancelled || !row?.success || !row.png) return;
      const img = new Image();
      img.onload = () => { if (cancelled) return; const cvs = document.createElement('canvas'); cvs.width = img.width; cvs.height = img.height; const ctx = cvs.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, cvs.width, cvs.height).data; const tex = new THREE.DataTexture(new Uint8Array(data), cvs.width, cvs.height, THREE.RGBAFormat); tex.needsUpdate = true; tex.flipY = false; hairTextureRef.current = tex; if (hairMaterialRef.current) { hairMaterialRef.current.map = tex; hairMaterialRef.current.needsUpdate = true; } setTextureVersion(v => v + 1); };
      img.src = `data:image/png;base64,${row.png}`;
    }).catch(() => { if (!cancelled) { hairTextureRef.current = null; if (hairMaterialRef.current) { hairMaterialRef.current.map = textureRef.current || null; hairMaterialRef.current.needsUpdate = true; } setTextureVersion(v => v + 1); } });
    return () => { cancelled = true; };
  }, [active, isCreatureModel, textureLayers.map(layer => typeof layer === 'string' ? layer : `${layer?.path || ''}:${layer?.region || ''}`).join('|'), worldmapMpqPath]);
  // Ã¢â€â‚¬Ã¢â€â‚¬ Color debug: apply per-group colors to geometry Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    const geo = geoRef.current;
    if (!geo) return;
    if (colorDebug && skinDataRef.current) {
      const posAttr = geo.getAttribute('position');
      if (!posAttr) return;
      const colors = buildColorBuffer(posAttr.count, enabledSubmeshIndices, skinDataRef.current);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    } else {
      geo.deleteAttribute('color');
    }
  }, [colorDebug, enabledSubmeshIndices, geoReady]);

  if (!active) return null;

  return (
    <div className="char-m2-viewer">
      {/* Overlays */}
      {geoLoading && !geoReady && (
        <div className="char-m2-overlay">
          <Loader2 size={20} className="cc-spin" />
          <span>Model ladenÃ¢â‚¬Â¦</span>
        </div>
      )}
      {geoError && !geoReady && (
        <div className="char-m2-overlay char-m2-overlay-err">{geoError}</div>
      )}
      {noTex && geoReady && (
        <div className="char-m2-notex-badge" title={`Skin BLP niet gevonden:\n${skinBlp}`}>
          Ã¢Å¡Â  Texture niet gevonden
        </div>
      )}
      {texLoading && (
        <div className="char-m2-loading-badge">
          <Loader2 size={11} className="cc-spin" />
        </div>
      )}

      {/* Canvas blijft altijd gemount Ã¢â‚¬â€ nooit opnieuw aanmaken */}
      {mounted && (
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: [0, 1.2, 3.5], fov: 38, near: 0.01, far: 500 }}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={['#e8e8e8']} />
          <ambientLight intensity={0.65} />
          <directionalLight position={[3, 8, 5]} intensity={1.2} />
          <directionalLight position={[-2, 3, -4]} intensity={0.3} />
          <OrbitControls enablePan={true} enableZoom={true} minDistance={0.5} maxDistance={20} target={[0, 1.0, 0]} />
          <>{renderPasses.length ? <CharacterPassScene passes={renderPasses} textureRef={textureRef} hairTextureRef={hairTextureRef} colorDebug={colorDebug} textureVersion={textureVersion} /> : <CharScene geoRef={geoRef} hairGeoRef={hairGeoRef} textureRef={textureRef} hairTextureRef={hairTextureRef} hairMaterialRef={hairMaterialRef} noTexRef={noTexRef} colorDebug={colorDebug} />}{attachedModels.map(model => <AttachedM2 key={`${model.slot}:${model.modelPath}`} model={model} anchor={attachmentPoints[model.attachmentId] || (model.attachmentId === 11 ? headAnchor : null)}/>)}</>
        </Canvas>
      )}
    </div>
  );
}
