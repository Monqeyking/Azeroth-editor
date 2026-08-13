import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { useConnection } from '../../lib/ConnectionContext';
import { configureWowRenderer } from '../editor3d/wowRenderConfig';
import { makeAnimator, ParticlePreview } from '../editor3d/GameObjectPreview';
import '../../pages/CharCustomizationPage.css';
import './GlueM2Viewer.css';

function toF32(arr) {
  if (arr instanceof Float32Array) return arr;
  return new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

function toIndexArray(arr) {
  const source = arr instanceof Uint16Array || arr instanceof Uint32Array
    ? arr
    : new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
  let max = 0;
  for (let index = 0; index < source.length; index++) max = Math.max(max, source[index]);
  return max <= 65535 ? new Uint16Array(source) : (source instanceof Uint32Array ? source : new Uint32Array(source));
}

function disposeMaterial(mat) {
  if (!mat) return;
  if (mat.map) mat.map.dispose();
  mat.dispose();
}

function makeTextureMaterial(texture, pass = {}) {
  const blend = Number(pass.blend || 0);
  const renderFlags = Number(pass.renderFlags || 0);
  const transparent = blend >= 2;
  const lit = !(renderFlags & 1) && blend < 3;
  const Material = lit ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
  const material = new Material({
    map: texture || null,
    color: '#ffffff',
    side: THREE.DoubleSide,
    transparent,
    opacity: texture ? 1 : 0,
    alphaTest: blend === 1 ? 224 / 255 : blend > 0 ? 1 / 255 : 0,
    depthWrite: !pass.noDepthWrite,
    depthTest: !(renderFlags & 8),
    toneMapped: false,
  });
  material.fog = !(renderFlags & 2);
  material.blending = blend === 3 || blend === 4
    ? THREE.AdditiveBlending
    : blend >= 5 ? THREE.CustomBlending : THREE.NormalBlending;
  if (blend >= 5) {
    material.blendSrc = THREE.DstColorFactor;
    material.blendDst = THREE.SrcColorFactor;
  }
  return material;
}

function makeDataTexture(payload) {
  if (!payload?.rgba || !payload.w || !payload.h) return null;
  const texture = new THREE.DataTexture(new Uint8Array(payload.rgba.buffer || payload.rgba), payload.w, payload.h, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.flipY = false;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function m2ToThree([x, y, z]) {
  return [-y, z, -x];
}

function lightColor(light) {
  const color = light?.diffuseColor || [1, 1, 1];
  const intensity = Number(light?.diffuseIntensity) || 0;
  return new THREE.Color(
    Math.max(0, Math.min(1, color[0] * intensity)),
    Math.max(0, Math.min(1, color[1] * intensity)),
    Math.max(0, Math.min(1, color[2] * intensity)),
  );
}

function GlueLighting({ lights = [] }) {
  const pointLights = lights.filter(light => light?.visible !== false && Number(light.type) === 1);
  return (
    <>
      <ambientLight color="#6b4854" intensity={0.7} />
      <directionalLight color="#ff9a58" intensity={1.15} position={[-4, 7, 6]} />
      <directionalLight color="#5268b5" intensity={0.3} position={[5, 3, -7]} />
      {pointLights.slice(0, 4).map((light, index) => (
        <pointLight
          key={`m2-light:${index}`}
          color={lightColor(light)}
          intensity={1}
          distance={Math.max(0, Number(light.attenuationEnd) || 0) || 1000}
          decay={1.5}
          position={m2ToThree(light.position || [0, 0, 0])}
        />
      ))}
    </>
  );
}

function m2CameraFovDegrees(cameraOrRadians, aspect = 4 / 3) {
  const fovRadians = Number(typeof cameraOrRadians === 'number' ? cameraOrRadians : cameraOrRadians?.fov);
  if (!Number.isFinite(fovRadians) || fovRadians <= 0) return 38;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return THREE.MathUtils.radToDeg(fovRadians / Math.sqrt(safeAspect * safeAspect + 1));
}

function Scene({ geoRef, textureRef, materialsRef, particleTexturesRef, frameRef, animationData, animationSequence = 0, particleEmitters, glueModel, showHelpers, modelScale = 1 }) {
  const fallbackMat = useRef(new THREE.MeshLambertMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.18,
    color: '#d9d9d9',
    depthWrite: false,
  }));
  const wireMat = useRef(new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    color: '#7cf0ff',
    wireframe: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  }));

  useEffect(() => {
    const mat = fallbackMat.current;
    if (textureRef.current) {
      mat.map = textureRef.current;
      mat.color.set('#ffffff');
    } else {
      mat.map = null;
      mat.color.set('#bfc7d4');
    }
    mat.needsUpdate = true;
  });

  const geo = geoRef.current;
  const frame = frameRef.current;
  const materials = materialsRef.current;
  const particleTextures = particleTexturesRef.current;
  const animator = useMemo(() => makeAnimator(animationData, animationSequence), [animationData, animationSequence]);
  useFrame(state => {
    if (animator?.update && geo) animator.update(state.clock.getElapsedTime() * 1000, geo);
  });
  if (!geo) return null;

  const layered = Array.isArray(materials) && materials.length > 0;
  const geometryReady = !!geo?.attributes?.position?.count;
  const helperSize = Math.max(8, (frame?.radius || 8) * 0.35);
  const particleSize = Math.min(Math.max(frame?.radius || 1, 1) * 0.003, 6);
  const center = frame?.center || { x: 0, y: 0, z: 0 };

  return (
    <group scale={[modelScale, modelScale, modelScale]}>
      <mesh geometry={geo} material={layered ? materials : fallbackMat.current} />
      {particleEmitters?.map(emitter => (
        <ParticlePreview
          key={`particle:${emitter.index}`}
          emitter={emitter}
          texture={particleTextures.get(emitter.index)}
          size={particleSize}
          animator={animator}
        />
      ))}
      {showHelpers && geometryReady && (
        <mesh geometry={geo} material={wireMat.current} renderOrder={999} />
      )}
      {showHelpers && frame && (
        <group position={[center.x, center.y, center.z]}>
          <axesHelper args={[helperSize]} />
          <mesh>
            <boxGeometry args={[helperSize, helperSize, helperSize]} />
            <meshBasicMaterial color='#ffcc66' transparent opacity={0.08} />
          </mesh>
          <mesh>
            <sphereGeometry args={[Math.max(helperSize * 0.03, 1), 16, 16]} />
            <meshBasicMaterial color='#ff6a6a' />
          </mesh>
        </group>
      )}
    </group>
  );
}
function CameraRig({ state }) {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.position.set(...state.position);
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 4 / 3;
    camera.fov = Number.isFinite(state.fovRadians) ? m2CameraFovDegrees(state.fovRadians, aspect) : state.fov;
    camera.near = state.near;
    camera.far = state.far;
    camera.up.set(0, 1, 0);
    if (Number.isFinite(state.roll) && state.roll !== 0) {
      const forward = new THREE.Vector3(...state.target).sub(camera.position).normalize();
      camera.up.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(forward, state.roll));
    }
    camera.lookAt(...state.target);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, state]);
  return null;
}

export default function GlueM2Viewer({ modelPath, glueModel = null, active = true, title = 'Glue Model', interactive = true, showLabel = true, showHelpers = false, loadParticles = false }) {
  const modelScale = 1;
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { worldmapMpqPath } = useConnection();
  const [textureMissing, setTextureMissing] = useState(false);
  const [frame, setFrame] = useState(null);
  const [embeddedCamera, setEmbeddedCamera] = useState(null);
  const [lights, setLights] = useState([]);
  const geoRef = useRef(null);
  const textureRef = useRef(null);
  const materialsRef = useRef([]);
  const particleTexturesRef = useRef(new Map());
  const particleEmittersRef = useRef([]);
  const animationDataRef = useRef(null);
  const frameRef = useRef(null);
  const modelKey = useRef(null);
  const textureKey = useRef(null);

  const cameraState = useMemo(() => {
    if (embeddedCamera?.position?.length === 3 && embeddedCamera?.target?.length === 3) {
      return {
        position: embeddedCamera.position,
        target: embeddedCamera.target,
        fov: m2CameraFovDegrees(embeddedCamera),
        fovRadians: Number(embeddedCamera.fov),
        roll: Number(embeddedCamera.roll) || 0,
        near: embeddedCamera.near || 0.1,
        far: Math.max(embeddedCamera.far || 50000, glueModel?.modelConfig?.fogFar || 0, 1000),
        minDistance: 0.01,
        maxDistance: embeddedCamera.far || 50000,
      };
    }
    const radius = Math.max(1, frame?.radius ?? 1);
    const center = frame?.center ?? { x: 0, y: 0, z: 0 };
    const vfov = THREE.MathUtils.degToRad(38);
    const aspect = 4 / 3;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitY = radius / Math.tan(vfov / 2);
    const fitX = radius / Math.tan(hfov / 2);
    const dist = Math.max(fitX, fitY) * 1.25;
    return {
      position: [center.x, center.y + radius * 0.04, center.z + dist],
      target: [center.x, center.y, center.z],
      fov: 38,
      fovRadians: null,
      roll: 0,
      near: 0.1,
      far: Math.max(1000, glueModel?.modelConfig?.fogFar || 0),
      minDistance: Math.max(0.8, radius * 0.25),
      maxDistance: Math.max(dist * 4, radius * 8),
    };
  }, [frame, embeddedCamera, modelPath, glueModel, modelScale]);

  useEffect(() => {
    if (!active || !modelPath) return;
    const key = modelPath;
    modelKey.current = key;
    setMounted(true);
    setLoading(true);
    setError(null);
    setTextureMissing(false);
    setFrame(null);
    setEmbeddedCamera(null);
    setLights([]);

    let cancelled = false;
    const disposeCurrent = () => {
      if (geoRef.current) {
        geoRef.current.dispose();
        geoRef.current = null;
      }
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
      if (Array.isArray(materialsRef.current)) {
        materialsRef.current.forEach(disposeMaterial);
      }
      materialsRef.current = [];
      new Set(particleTexturesRef.current.values()).forEach(texture => texture.dispose());
      particleTexturesRef.current.clear();
      particleEmittersRef.current = [];
      animationDataRef.current = null;
    };

    disposeCurrent();

    let requestTimeout = null;
    const modelConfig = glueModel?.modelConfig || {};
    const cameraIndex = Number.isInteger(modelConfig.cameraIndex) ? modelConfig.cameraIndex : 0;
    const sequence = Number.isInteger(modelConfig.sequence) ? modelConfig.sequence : 0;
    const renderOptions = {
      modelPath,
      cameraIndex,
      sequence,
      renderProfile: 'glue',
      renderAllSubmeshes: true,
      loadParticles,
    };
    const modelRequest = Promise.race([
      window.azeroth.m2.loadModelByPath(renderOptions),
      new Promise((_, reject) => {
        requestTimeout = setTimeout(() => reject(new Error('M2 IPC timeout after 30 seconds')), 30000);
      }),
    ]);
    modelRequest
      .then(async res => {
        if (requestTimeout) { clearTimeout(requestTimeout); requestTimeout = null; }
        if (cancelled || modelKey.current !== key) return;

        if (!res?.success || !res.data) {
          setError(res?.error || "Failed to load model");
          setLoading(false);
          return;
        }

        const data = res.data;
        particleEmittersRef.current = data.particleEmitters || [];
        animationDataRef.current = data.animationData || null;
        setLights(data.lights || []);
        const particleTextureByPath = new Map();
        particleTexturesRef.current = new Map((data.particleTextures || []).flatMap(entry => {
          const key = String(entry.texturePath || entry.path || entry.textureIndex || entry.emitterIndex).toLowerCase();
          let texture = particleTextureByPath.get(key);
          if (!texture) {
            texture = makeDataTexture(entry);
            if (texture) {
              texture.flipY = true;
              texture.needsUpdate = true;
              particleTextureByPath.set(key, texture);
            }
          }
          return texture ? [[entry.emitterIndex, texture]] : [];
        }));
        setEmbeddedCamera(data.camera || null);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(toF32(data.positions), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(toF32(data.normals), 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(toF32(data.uvs), 2));
        geo.setAttribute('uv2', new THREE.BufferAttribute(toF32(data.uvs2 || data.uvs), 2));
        geo.setIndex(new THREE.BufferAttribute(toIndexArray(data.indices), 1));
        geo.clearGroups();

        const texturePaths = Array.isArray(data.texturePaths) ? data.texturePaths.filter(Boolean) : [];
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        geoRef.current = geo;
        textureKey.current = `${modelPath}|${texturePaths.join('|')}`;

        const box = geo.boundingBox;
        const sphere = geo.boundingSphere;
        const nextFrame = box && sphere ? {
          center: {
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
          },
          radius: sphere.radius || Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1),
          bounds: { min: box.min.toArray(), max: box.max.toArray() },
        } : null;

        if (nextFrame) {
          frameRef.current = nextFrame;
          setFrame(nextFrame);
        }

        if (Array.isArray(data.renderPasses) && data.renderPasses.length) {
          const passTextures = new Map((data.passTextures || []).map(texture => [texture.passIndex, texture]));
          const mats = data.renderPasses.map((pass, materialIndex) => {
            const texture = makeDataTexture(passTextures.get(pass.index));
            if (pass.indexCount > 0) geo.addGroup(pass.indexStart, pass.indexCount, materialIndex);
            return makeTextureMaterial(texture, pass);
          });
          materialsRef.current = mats;
          setTextureMissing(![...passTextures.values()].some(texture => texture.rgba));
        } else {
          materialsRef.current = [];
          if (data.textureRgba && data.textureW > 0 && data.textureH > 0) {
            const tex = new THREE.DataTexture(
              new Uint8Array(data.textureRgba.buffer || data.textureRgba),
              data.textureW,
              data.textureH,
              THREE.RGBAFormat
            );
            tex.needsUpdate = true;
            tex.flipY = false;
            if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
            textureRef.current = tex;
            setTextureMissing(false);
          } else {
            textureRef.current = null;
            setTextureMissing(true);
          }
        }

        setLoading(false);
      })
      .catch(e => {
        if (requestTimeout) { clearTimeout(requestTimeout); requestTimeout = null; }
        if (cancelled || modelKey.current !== key) return;
        setError(e.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, modelPath, worldmapMpqPath, glueModel?.modelConfig?.cameraIndex, glueModel?.modelConfig?.sequence, loadParticles]);

  if (!active) return null;

  return (
    <div className="glue-m2-viewer">
      {loading && !error && (
        <div className="glue-m2-overlay">
          <Loader2 size={20} className="cc-spin" />
          <span>Loading model...</span>
        </div>
      )}
      {error && (
        <div className="glue-m2-overlay glue-m2-overlay-err">{error}</div>
      )}
      {textureMissing && !error && !loading && (
        <div className="glue-m2-notex-badge" title={modelPath}>
          Texture niet gevonden
        </div>
      )}
      {mounted && (
        <Canvas
          className="glue-m2-canvas"
          style={{ width: '100%', height: '100%' }}
          camera={{ position: cameraState.position, fov: cameraState.fov, near: cameraState.near, far: cameraState.far }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            configureWowRenderer(gl);
            gl.domElement.addEventListener('webglcontextlost', event => event.preventDefault(), false);
          }}
        >
          <color attach="background" args={['#11131a']} />
          {glueModel?.modelConfig?.fogFar > 0 && <fog attach="fog" args={['#11131a', Math.max(0, glueModel.modelConfig.fogNear), glueModel.modelConfig.fogFar]} />}
          <CameraRig state={cameraState} />
          <GlueLighting lights={lights} />
          {interactive && <OrbitControls
            enablePan={false}
            minDistance={cameraState.minDistance}
            maxDistance={cameraState.maxDistance}
            target={cameraState.target}
          />}
          <Scene
            geoRef={geoRef}
            textureRef={textureRef}
            materialsRef={materialsRef}
            particleTexturesRef={particleTexturesRef}
            frameRef={frameRef}
            animationData={animationDataRef.current}
            animationSequence={Number.isInteger(glueModel?.modelConfig?.sequence) ? glueModel.modelConfig.sequence : 0}
            particleEmitters={particleEmittersRef.current}
            glueModel={glueModel}
            showHelpers={showHelpers}
            modelScale={modelScale}
          />
        </Canvas>
      )}
      {showLabel && title && <div className="glue-m2-label">{title}</div>}
    </div>
  );
}

