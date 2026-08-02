import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';

function toF32(arr) {
  if (arr instanceof Float32Array) return arr;
  if (Array.isArray(arr)) return new Float32Array(arr);
  return new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

function toU32(arr) {
  if (arr instanceof Uint32Array) return arr;
  if (Array.isArray(arr)) return new Uint32Array(arr);
  return new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

const previewPromiseCache = new Map();

function loadPreviewModel(modelPath) {
  if (!previewPromiseCache.has(modelPath)) {
    const promise = window.azeroth.m2.loadModelByPath({ modelPath })
      .then(res => res?.success && res.data
        ? { data: res.data }
        : { error: res?.error || 'Client model asset ontbreekt' });
    previewPromiseCache.set(modelPath, promise);
  }
  return previewPromiseCache.get(modelPath);
}

// Simpele 1.8-unit mensfiguur als schaalreferentie naast het object.
function ReferenceFigure({ position, height = 1.8 }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7ec8ff', transparent: true, opacity: 0.55 }), []);
  const headMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffcc88', transparent: true, opacity: 0.6 }), []);
  const torso = height * 0.42;
  const leg = height * 0.47;
  const head = height * 0.11;
  return (
    <group position={position}>
      <mesh material={mat} position={[0, leg / 2, 0]}>
        <boxGeometry args={[0.24, leg, 0.18]} />
      </mesh>
      <mesh material={mat} position={[0.22, leg / 2, 0]}>
        <boxGeometry args={[0.24, leg, 0.18]} />
      </mesh>
      <mesh material={mat} position={[0.11, leg + torso / 2, 0]}>
        <boxGeometry args={[0.5, torso, 0.26]} />
      </mesh>
      <mesh material={mat} position={[0.11, leg + torso, 0]}>
        <boxGeometry args={[0.46, 0.08, 0.28]} />
      </mesh>
      <mesh material={headMat} position={[0.11, leg + torso + head * 0.6, 0]}>
        <sphereGeometry args={[head * 0.62, 14, 14]} />
      </mesh>
    </group>
  );
}

function GridFloor({ size, divisions }) {
  const gridMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#2f3a52', transparent: true, opacity: 0.6 }), []);
  return (
    <gridHelper args={[size, divisions, '#3a4766', '#222a3c']} material={gridMat} position={[0, 0, 0]} />
  );
}

function sampleTrack(track, animationIndex, timeMs, duration, globalSequences, fallback, isQuat = false) {
  const sequence = track?.sequences?.[animationIndex] || track?.sequences?.[0];
  if (!sequence?.times?.length || !sequence.values?.length) return fallback;
  const trackDuration = track.globalSequence >= 0
    ? (globalSequences?.[track.globalSequence] || duration)
    : duration;
  const time = trackDuration > 0 ? ((timeMs % trackDuration) + trackDuration) % trackDuration : 0;
  const last = sequence.times.length - 1;
  let from = 0;
  while (from < last && sequence.times[from + 1] <= time) from++;
  const to = Math.min(from + 1, last);
  const span = sequence.times[to] - sequence.times[from];
  const amount = track.interpolation === 0 || !span ? 0 : Math.min(1, Math.max(0, (time - sequence.times[from]) / span));
  const a = sequence.values[from];
  const b = sequence.values[to] || a;
  if (isQuat) {
    const qa = new THREE.Quaternion(...a);
    const qb = new THREE.Quaternion(...b);
    qa.slerp(qb, amount);
    return [qa.x, qa.y, qa.z, qa.w];
  }
  return a.map((value, index) => value + ((b[index] ?? value) - value) * amount);
}

function sampleParticleKeys(keys, phase, fallback) {
  if (!Array.isArray(keys) || !keys.length) return fallback;
  if (keys.length === 1) return keys[0];
  const scaled = Math.max(0, Math.min(1, phase)) * (keys.length - 1);
  const from = Math.floor(scaled);
  const to = Math.min(from + 1, keys.length - 1);
  const amount = scaled - from;
  const a = keys[from];
  const b = keys[to] || a;
  if (Array.isArray(a)) return a.map((value, index) => value + ((b[index] ?? value) - value) * amount);
  return a + ((b - a) * amount);
}

function makeAnimator(animationData) {
  if (!animationData?.animations?.length || !animationData.bones?.length) return null;
  const positions = toF32(animationData.positionsM2);
  const normals = toF32(animationData.normalsM2);
  const boneIndices = animationData.boneIndices instanceof Uint8Array
    ? animationData.boneIndices
    : new Uint8Array(animationData.boneIndices || []);
  const boneWeights = toF32(animationData.boneWeights);
  if (!positions.length || boneIndices.length !== positions.length / 3 * 4) return null;

  const bones = animationData.bones;
  const boneLookup = animationData.boneLookup || [];
  const animation = animationData.animations[0];
  const duration = Math.max(1, animation.length || 1);
  const defaultTranslation = [0, 0, 0];
  const defaultRotation = [0, 0, 0, 1];
  const defaultScale = [1, 1, 1];
  const hasAnimatedTrack = track => track?.sequences?.some(sequence => sequence?.values?.length > 1);
  const animatedBones = new Set(bones.flatMap((bone, index) => (
    hasAnimatedTrack(bone.translation) || hasAnimatedTrack(bone.rotation) || hasAnimatedTrack(bone.scale) ? [index] : []
  )));
  let hasAnimatedMesh = false;
  for (let vertex = 0; vertex < positions.length / 3 && !hasAnimatedMesh; vertex++) {
    for (let slot = 0; slot < 4; slot++) {
      if ((boneWeights[vertex * 4 + slot] || 0) <= 0) continue;
      const lookupIndex = boneIndices[vertex * 4 + slot];
      const boneIndex = boneLookup[lookupIndex] ?? lookupIndex;
      if (animatedBones.has(boneIndex)) { hasAnimatedMesh = true; break; }
    }
  }

  const buildWorldMatrices = timeMs => {
    const worlds = [];
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const translation = sampleTrack(bone.translation, 0, timeMs, duration, animationData.globalSequences, defaultTranslation);
      const rotation = sampleTrack(bone.rotation, 0, timeMs, duration, animationData.globalSequences, defaultRotation, true);
      const boneScale = sampleTrack(bone.scale, 0, timeMs, duration, animationData.globalSequences, defaultScale);
      const pivot = bone.pivot || [0, 0, 0];
      const local = new THREE.Matrix4()
        .makeTranslation(pivot[0] + translation[0], pivot[1] + translation[1], pivot[2] + translation[2])
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...rotation)))
        .scale(new THREE.Vector3(...boneScale))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
      const parent = Number.isInteger(bone.parent) && bone.parent >= 0 ? worlds[bone.parent] : null;
      worlds.push(parent ? new THREE.Matrix4().copy(parent).multiply(local) : local);
    }
    return worlds;
  };

  const bindWorlds = buildWorldMatrices(0);
  const inverseBind = bindWorlds.map(matrix => matrix.clone().invert());
  const rawPosition = new THREE.Vector3();
  const rawNormal = new THREE.Vector3();
  const transformedPosition = new THREE.Vector3();
  const transformedNormal = new THREE.Vector3();
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const bonePosition = new THREE.Vector3();

  return {
    getBonePosition(boneIndex, point, timeMs) {
      const matrix = buildWorldMatrices(timeMs)[boneIndex];
      if (!matrix) return point;
      return bonePosition.set(point[0], point[1], point[2]).applyMatrix4(matrix).toArray();
    },
    update(timeMs, geo) {
      if (!hasAnimatedMesh) return;
      const worlds = buildWorldMatrices(timeMs);
      const skinMatrices = worlds.map((world, index) => world.clone().multiply(inverseBind[index]));
      const positionArray = geo.attributes.position.array;
      const normalArray = geo.attributes.normal.array;
      for (let vertex = 0; vertex < positions.length / 3; vertex++) {
        rawPosition.fromArray(positions, vertex * 3);
        rawNormal.fromArray(normals, vertex * 3);
        position.set(0, 0, 0);
        normal.set(0, 0, 0);
        let totalWeight = 0;
        for (let slot = 0; slot < 4; slot++) {
          const weight = boneWeights[vertex * 4 + slot] || 0;
          const lookupIndex = boneIndices[vertex * 4 + slot];
          const boneIndex = boneLookup[lookupIndex] ?? lookupIndex;
          const matrix = skinMatrices[boneIndex];
          if (!weight || !matrix) continue;
          transformedPosition.copy(rawPosition).applyMatrix4(matrix);
          transformedNormal.copy(rawNormal).transformDirection(matrix);
          position.addScaledVector(transformedPosition, weight);
          normal.addScaledVector(transformedNormal, weight);
          totalWeight += weight;
        }
        if (totalWeight < 1) {
          position.addScaledVector(rawPosition, 1 - totalWeight);
          normal.addScaledVector(rawNormal, 1 - totalWeight);
        }
        positionArray[vertex * 3] = -position.y;
        positionArray[vertex * 3 + 1] = position.z;
        positionArray[vertex * 3 + 2] = position.x;
        normal.normalize();
        normalArray[vertex * 3] = -normal.y;
        normalArray[vertex * 3 + 1] = normal.z;
        normalArray[vertex * 3 + 2] = normal.x;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
    },
  };
}

function buildPassIndices(skinData, submeshIndex) {
  const submesh = skinData?.submeshes?.[submeshIndex];
  if (!submesh) return [];
  const out = [];
  for (let i = 0; i < submesh.indexCount; i++) {
    const triangleIndex = skinData.indexLookup?.[submesh.indexStart + i];
    out.push(skinData.vertexLookup?.[triangleIndex] ?? 0);
  }
  return out;
}

function PassMesh({ baseGeometry, data, pass, texture }) {
  const geometry = useMemo(() => {
    if (!baseGeometry || !data?.skinData || !Number.isInteger(pass?.submeshIndex)) return null;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = baseGeometry.getAttribute(name);
      if (attribute) out.setAttribute(name, attribute);
    }
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(buildPassIndices(data.skinData, pass.submeshIndex)), 1));
    return out;
  }, [baseGeometry, data, pass]);

  const material = useMemo(() => {
    const blend = pass?.blend ?? 0;
    const out = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: blend >= 2,
      alphaTest: blend === 1 ? 0.7 : 0.1,
      depthWrite: !pass?.noDepthWrite,
    });
    out.blending = blend === 3 || blend === 4
      ? THREE.AdditiveBlending
      : blend >= 5 ? THREE.CustomBlending : THREE.NormalBlending;
    if (blend >= 5) {
      out.blendSrc = THREE.DstColorFactor;
      out.blendDst = THREE.SrcColorFactor;
    }
    return out;
  }, [pass, texture]);

  useEffect(() => () => {
    geometry?.dispose();
    material.dispose();
  }, [geometry, material]);

  if (!geometry?.getIndex()?.count) return null;
  return <mesh geometry={geometry} material={material} renderOrder={pass.order ?? pass.index} />;
}

function ParticleSprite({ emitter, texture, size, animator, presentation, index, count }) {
  const material = useMemo(() => {
    if (!texture) return null;
    const particleTexture = texture.clone();
    particleTexture.flipY = true;
    particleTexture.needsUpdate = true;
    return new THREE.SpriteMaterial({
      map: particleTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: presentation.opacity,
      blending: emitter.blend === 3 || emitter.blend === 4 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }, [emitter, presentation.opacity, texture]);
  const spriteRef = useRef();
  const seed = (index / Math.max(1, count)) * Math.PI * 2;
  const isCore = emitter?.texturePath?.toLowerCase()?.endsWith('skullportal2.blp');

  useEffect(() => () => {
    material?.map?.dispose();
    material?.dispose();
  }, [material]);

  useFrame(state => {
    if (!spriteRef.current || !emitter?.position || !material) return;
    const elapsedMs = state.clock.getElapsedTime() * 1000;
    const lifespanMs = Math.max(700, Math.min(4000, (emitter.lifespan || 1.2) * 1000));
    const phase = ((elapsedMs + index * lifespanMs / Math.max(1, count)) % lifespanMs) / lifespanMs;
    const angle = seed + elapsedMs * (isCore ? 0.00008 : 0.0016);
    const spread = isCore
      ? 0.02
      : Math.max(0.08, Math.min(size * 0.38, Math.max(emitter.emissionAreaLength || 0, emitter.emissionAreaWidth || 0) * 0.08));
    const radius = spread * (0.2 + phase * 0.8);
    const point = [...emitter.position];
    point[1] += Math.cos(angle) * radius;
    point[2] += Math.sin(angle) * radius * 0.7;
    point[0] += Math.sin(angle * 0.65) * radius * 0.18;
    const position = animator?.getBonePosition?.(emitter.bone, point, elapsedMs) || point;
    spriteRef.current.position.set(-position[1], position[2], position[0]);

    const color = sampleParticleKeys(emitter.colorKeys, phase, [1, 1, 1]);
    const opacity = sampleParticleKeys(emitter.opacityKeys, phase, 1);
    material.color.setRGB(color[0], color[1], color[2]);
    material.opacity = presentation.opacity * opacity * (isCore ? 1 : 0.75 + phase * 0.25);
    material.rotation = isCore ? 0 : angle * 0.65;
    const particleScale = isCore ? 1 : 0.55 + phase * 0.45;
    const finalSize = size * presentation.scale * particleScale;
    spriteRef.current.scale.set(finalSize, finalSize, finalSize);
  });

  if (!material || !emitter?.position) return null;
  return <sprite ref={spriteRef} material={material} renderOrder={100 + emitter.index + index} />;
}

function ParticlePreview({ emitter, texture, size, animator }) {
  const presentation = useMemo(() => {
    const path = emitter?.texturePath?.toLowerCase() || '';
    if (path.endsWith('skullportal2.blp')) return { scale: 0.95, opacity: 1 };
    if (path.endsWith('skullportal3.blp')) return { scale: 1.08, opacity: 0.55 };
    if (path.endsWith('skullportal.blp')) return { scale: 1.12, opacity: 0.45 };
    if (path.endsWith('glowball.blp')) return { scale: 1.2, opacity: 0.3 };
    return { scale: 1, opacity: 0.6 };
  }, [emitter]);
  const path = emitter?.texturePath?.toLowerCase() || '';
  const count = path.endsWith('skullportal2.blp') ? 1 : path.endsWith('skullportal3.blp') ? 6 : path.endsWith('skullportal.blp') ? 8 : path.endsWith('glowball.blp') ? 7 : 4;
  return (
    <group>
      {Array.from({ length: count }, (_, index) => (
        <ParticleSprite
          key={`${emitter.index}:${index}`}
          emitter={emitter}
          texture={texture}
          size={size}
          animator={animator}
          presentation={presentation}
          index={index}
          count={count}
        />
      ))}
    </group>
  );
}

function HeadingGuide({ length }) {
  const arrow = useMemo(() => new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0.04, 0),
    length,
    0x6f9cff,
    Math.max(0.12, length * 0.12),
    Math.max(0.08, length * 0.07),
  ), [length]);
  useEffect(() => () => {
    arrow.line?.geometry?.dispose();
    arrow.line?.material?.dispose();
    arrow.cone?.geometry?.dispose();
    arrow.cone?.material?.dispose();
  }, [arrow]);
  return <primitive object={arrow} />;
}

function AnimatedMesh({ geo, texture, scale, bounds, data, orientation = 0 }) {
  const animationData = data?.animationData;
  const material = useMemo(() => {
    if (texture) {
      return new THREE.MeshLambertMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.1,
      });
    }
    return new THREE.MeshLambertMaterial({ color: '#c9b48a', side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  }, [texture]);

  useEffect(() => () => { material.dispose(); }, [material]);
  const animator = useMemo(() => makeAnimator(animationData), [animationData]);
  const passTextures = useMemo(() => new Map((data?.passTextures || []).flatMap(entry => {
    const passTexture = makeTexture({ textureRgba: entry.rgba, textureW: entry.w, textureH: entry.h });
    return passTexture ? [[entry.passIndex, passTexture]] : [];
  })), [data]);
  useEffect(() => () => passTextures.forEach(passTexture => passTexture.dispose()), [passTextures]);
  const particleTextures = useMemo(() => new Map((data?.particleTextures || []).flatMap(entry => {
    const particleTexture = makeTexture({ textureRgba: entry.rgba, textureW: entry.w, textureH: entry.h });
    return particleTexture ? [[entry.emitterIndex, particleTexture]] : [];
  })), [data]);
  useEffect(() => () => particleTextures.forEach(particleTexture => particleTexture.dispose()), [particleTextures]);
  useFrame(state => {
    const elapsedMs = state.clock.getElapsedTime() * 1000;
    if (animator?.update) animator.update(elapsedMs, geo);
  });

  if (!geo || !bounds) return null;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  const offsetY = -bounds.min.y;
  const particleSize = Math.max(size.x, size.y, size.z, 1) * 0.75;

  return (
    <group
      position={[-cx * scale, offsetY * scale, -cz * scale]}
      rotation={[0, -orientation, 0]}
      scale={scale}
    >
      {data?.renderPasses?.length && data.skinData?.submeshes?.length
        ? data.renderPasses.map(pass => (
            <PassMesh
              key={`${pass.index}:${pass.submeshIndex}`}
              baseGeometry={geo}
              data={data}
              pass={pass}
              texture={passTextures.get(pass.index) || texture}
            />
          ))
        : <mesh geometry={geo} material={material} />}
      {(data?.particleEmitters || []).map(emitter => (
        <ParticlePreview
          key={`particle:${emitter.index}`}
          emitter={emitter}
          texture={particleTextures.get(emitter.index) || texture}
          size={particleSize}
          animator={animator}
        />
      ))}
      <HeadingGuide length={Math.max(size.x, size.z, 1) * 0.9} />
    </group>
  );
}

// Verplaatst de camera zodat het (nieuwe) model opnieuw ingekaderd wordt.
// De key op deze component forceert een verse mount per modelwissel.
function CameraRig({ cameraState }) {
  const { camera } = useThree();
  const controls = useThree(s => s.controls);
  useEffect(() => {
    camera.position.set(cameraState.position[0], cameraState.position[1], cameraState.position[2]);
    if (controls) controls.target.set(cameraState.target[0], cameraState.target[1], cameraState.target[2]);
  }, [cameraState, camera, controls]);
  return null;
}

function makeTexture(result) {
  if (!result.textureRgba || !result.textureW || !result.textureH) return null;
  const rgba = new Uint8Array(result.textureRgba.buffer || result.textureRgba);
  const tex = new THREE.DataTexture(rgba, result.textureW, result.textureH, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.flipY = false;
  return tex;
}

export default function GameObjectPreview({ modelPath, scale = 1, height = 320, orientation = 0, showReference = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [texData, setTexData] = useState(null);

  const geo = useMemo(() => {
    if (!data) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(toF32(data.positions), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(toF32(data.normals), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(toF32(data.uvs), 2));
    g.setIndex(new THREE.BufferAttribute(toU32(data.indices), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }, [data]);

  useEffect(() => {
    if (!modelPath || !window.azeroth?.m2) {
      setData(null);
      setTexData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPreviewModel(modelPath).then(result => {
      if (cancelled) return;
      setLoading(false);
      if (!result?.data) { setError(result?.error || 'Model not loaded'); return; }
      setData(result.data);
      setTexData(makeTexture(result.data));
    }).catch(err => {
      if (!cancelled) {
        setLoading(false);
      setError(err.message || 'Model not loaded');
      }
    });
    return () => { cancelled = true; };
  }, [modelPath]);

  const frame = useMemo(() => {
    if (!geo) return null;
    const box = geo.boundingBox;
    const sphere = geo.boundingSphere;
    if (!box || !sphere) return null;
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(sphere.radius, 0.5);
    const scaledRadius = radius * Math.max(scale, 0.01);
    return {
      radius: scaledRadius,
      size,
      centerY: (box.max.y - box.min.y) / 2 * Math.max(scale, 0.01),
    };
  }, [geo, scale]);

  const cameraState = useMemo(() => {
    const radius = Math.max(1, frame?.radius ?? 1);
    const dist = radius * 2.6 + 2;
    const targetY = (frame?.centerY ?? 0) + radius * 0.3;
    return {
      position: [dist * 0.9, targetY + dist * 0.55, dist],
      target: [0, targetY, 0],
      minDistance: Math.max(0.5, radius * 0.3),
      maxDistance: dist * 5 + 20,
    };
  }, [frame]);

  const gridSize = useMemo(() => {
    const radius = Math.max(1, frame?.radius ?? 1);
    return Math.max(12, Math.ceil(radius * 2.2 / 2) * 2);
  }, [frame]);

  const figPos = useMemo(() => [-Math.max(1.4, (frame?.radius ?? 1) + 1.2), 0, 0], [frame]);

  const hasModel = !!data;
  const showNoModel = !hasModel && !loading && !error;
  const showLoading = loading;
  const showError = !!error;
  const animationCount = data?.animationData?.animations?.length || 0;
  const boneCount = data?.animationData?.bones?.length || 0;
  const debugText = data && [
    `${Math.round((data.positions?.length || 0) / 3)} vertices`,
    `${Math.round((data.indices?.length || 0) / 3)} triangles`,
    `${data.skinData?.submeshes?.length || 0} submeshes`,
    `${data.renderPasses?.length || 0} passes`,
    `${data.texturePaths?.length || 0} textures`,
    `particles ${data.particleEmitters?.length || 0}`,
    `anim ${animationCount} / bones ${boneCount}`,
    data.texturePath ? `used ${data.texturePath.split('\\').pop()}` : 'texture missing',
  ].join(' · ');
  const debugTextures = data?.texturePaths?.map(path => path.split('\\').pop()).join(', ') || 'none';
  const debugPassTextures = data?.renderPasses?.map(pass => pass.texturePath?.split('\\').pop()).filter(Boolean).join(', ') || 'none';
  const debugParticleTextures = data?.particleTextures?.map(texture => texture.texturePath?.split('\\').pop()).filter(Boolean).join(', ') || 'none';

  return (
    <div className="go-preview-canvas" style={{ height }}>
      {hasModel && (
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: cameraState.position, fov: 40, near: 0.05, far: 50000 }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#10121a']} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[5, 10, 6]} intensity={1.1} />
          <directionalLight position={[-4, 4, -5]} intensity={0.3} />
          <AnimatedMesh
            geo={geo}
            texture={texData}
            scale={scale}
            bounds={geo.boundingBox}
            data={data}
            orientation={orientation}
          />
          <GridFloor size={gridSize} divisions={gridSize} />
          {showReference && <ReferenceFigure position={figPos} />}
          <CameraRig key={modelPath || 'none'} cameraState={cameraState} />
          <OrbitControls
            makeDefault
            enablePan
            minDistance={cameraState.minDistance}
            maxDistance={cameraState.maxDistance}
            target={cameraState.target}
          />
        </Canvas>
      )}
      {showLoading && (
        <div className="go-preview-overlay go-preview-loading">
          <Loader2 size={18} className="spin" /><span>{hasModel ? 'Switching model…' : 'Loading model…'}</span>
        </div>
      )}
      {showError && <div className="go-preview-overlay go-preview-overlay-err">{error}</div>}
      {showNoModel && <div className="go-preview-overlay">No model available</div>}
    </div>
  );
}
