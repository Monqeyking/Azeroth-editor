import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { useConnection } from '../../lib/ConnectionContext';
import '../../pages/CharCustomizationPage.css';
import './GlueM2Viewer.css';

function toF32(arr) {
  if (arr instanceof Float32Array) return arr;
  return new Float32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

function toU32(arr) {
  if (arr instanceof Uint32Array) return arr;
  return new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4);
}

function disposeMaterial(mat) {
  if (!mat) return;
  if (mat.map) mat.map.dispose();
  mat.dispose();
}

function makeTextureMaterial(texture, pass = {}) {
  const blend = Number(pass.blend || 0);
  return new THREE.MeshBasicMaterial({
    map: texture || null,
    color: '#ffffff',
    side: THREE.DoubleSide,
    transparent: blend !== 0,
    opacity: texture ? 1 : 0,
    alphaTest: blend === 1 ? 0.5 : 0.01,
    blending: blend === 3 ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: blend === 0 && !pass.noDepthWrite,
    toneMapped: false,
  });
}

function makeDataTexture(payload) {
  if (!payload?.rgba || !payload.w || !payload.h) return null;
  const texture = new THREE.DataTexture(new Uint8Array(payload.rgba.buffer || payload.rgba), payload.w, payload.h, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.flipY = false;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function formatVec3(vec) {
  if (!vec) return 'n/a';
  return '[' + vec.x.toFixed(1) + ', ' + vec.y.toFixed(1) + ', ' + vec.z.toFixed(1) + ']';
}

function makeDebugState(stage, lines = [], extra = null) {
  const nextLines = [...lines];
  if (extra?.debugSteps?.length) {
    nextLines.push('--- loader steps ---');
    nextLines.push(...extra.debugSteps.slice(0, 18));
  }
  return { stage, lines: nextLines };
}

function Scene({ geoRef, textureRef, materialsRef, frameRef, showHelpers }) {
  const fallbackMat = useRef(new THREE.MeshBasicMaterial({
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
  if (!geo) return null;

  const layered = Array.isArray(materials) && materials.length > 0;
  const geometryReady = !!geo?.attributes?.position?.count;
  const helperSize = Math.max(8, (frame?.radius || 8) * 0.35);
  const center = frame?.center || { x: 0, y: 0, z: 0 };

  return (
    <group>
      <mesh geometry={geo} material={layered ? materials : fallbackMat.current} />
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
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(...state.position);
    camera.fov = state.fov;
    camera.near = state.near;
    camera.far = state.far;
    camera.lookAt(...state.target);
    camera.updateProjectionMatrix();
  }, [camera, state]);
  return null;
}


export default function GlueM2Viewer({ modelPath, active = true, title = 'Glue Model', interactive = true, debug = false, showLabel = true, showHelpers = false }) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { worldmapMpqPath } = useConnection();
  const [textureMissing, setTextureMissing] = useState(false);
  const [frame, setFrame] = useState(null);
  const [embeddedCamera, setEmbeddedCamera] = useState(null);
  const [debugState, setDebugState] = useState({ stage: "idle", lines: [] });
  const geoRef = useRef(null);
  const textureRef = useRef(null);
  const materialsRef = useRef([]);
  const frameRef = useRef(null);
  const modelKey = useRef(null);
  const textureKey = useRef(null);

  const cameraState = useMemo(() => {
    if (embeddedCamera?.position?.length === 3 && embeddedCamera?.target?.length === 3) {
      return {
        ...embeddedCamera,
        fov: embeddedCamera.fov || 38,
        near: embeddedCamera.near || 0.1,
        far: embeddedCamera.far || 50000,
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
      minDistance: Math.max(0.8, radius * 0.25),
      maxDistance: Math.max(dist * 4, radius * 8),
    };
  }, [frame, embeddedCamera]);

  useEffect(() => {
    if (!active || !modelPath) return;
    const key = modelPath;
    if (modelKey.current === key) return;
    modelKey.current = key;
    setMounted(true);
    setLoading(true);
    setError(null);
    setTextureMissing(false);
    setFrame(null);
    setDebugState(makeDebugState("requesting model", [modelPath]));
    setEmbeddedCamera(null);

    let cancelled = false;
    let progressTimer = null;
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
    };

    disposeCurrent();

    progressTimer = setTimeout(() => {
      if (!cancelled) setDebugState(prev => prev.stage === "requesting model" ? makeDebugState("waiting on IPC", [modelPath, "still waiting for model payload"]) : prev);
    }, 500);

    window.azeroth.m2.loadModelByPath({ modelPath })
      .then(async res => {
        if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
        if (cancelled || modelKey.current !== key) return;
        setDebugState(makeDebugState("response received", [
          "success=" + !!res?.success,
          "hasData=" + !!res?.data,
          "hasError=" + (res?.error || "none"),
          "dataKeys=" + (res?.data ? Object.keys(res.data).slice(0, 12).join(", ") : "none"),
        ]));

        if (!res?.success || !res.data) {
          setError(res?.error || "Failed to load model");
          setDebugState(makeDebugState("error", [res?.error || "Failed to load model"]));
          setLoading(false);
          return;
        }

        const data = res.data;
        setEmbeddedCamera(data.camera || null);
        setDebugState({
          stage: "model loaded",
          lines: [
            `positions=${data.positions?.length ?? 0}`,
            `indices=${data.indices?.length ?? 0}`,
            `textures=${Array.isArray(data.texturePaths) ? data.texturePaths.length : 0}`,
            `submeshes=${Array.isArray(data.submeshes) ? data.submeshes.length : 0}`,
          ],
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(toF32(data.positions), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(toF32(data.normals), 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(toF32(data.uvs), 2));
        geo.setIndex(new THREE.BufferAttribute(toU32(data.indices), 1));
        geo.clearGroups();

        const texturePaths = Array.isArray(data.texturePaths) ? data.texturePaths.filter(Boolean) : [];
        const isLoginBackdrop = /UI_MainMenu_Northrend/i.test(modelPath);

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
        } : null;

        if (nextFrame) {
          frameRef.current = nextFrame;
          setFrame(nextFrame);
        }

        setDebugState(makeDebugState("model loaded", [
          'positions=' + (data.positions?.length ?? 0),
          'indices=' + (data.indices?.length ?? 0),
          'textures=' + (Array.isArray(data.texturePaths) ? data.texturePaths.length : 0),
          'submeshes=' + (Array.isArray(data.submeshes) ? data.submeshes.length : 0),
          'texturePath=' + (data.texturePath || 'none'),
          'bounds min=' + (box ? formatVec3(box.min) : 'n/a'),
          'bounds max=' + (box ? formatVec3(box.max) : 'n/a'),
          'center=' + (nextFrame ? formatVec3(nextFrame.center) : 'n/a'),
          'radius=' + (nextFrame ? nextFrame.radius.toFixed(2) : 'n/a'),
          'camera target=' + (nextFrame ? formatVec3(nextFrame.center) : 'n/a'),
          'camera position=' + (nextFrame ? formatVec3({
            x: nextFrame.center.x,
            y: nextFrame.center.y + nextFrame.radius * 0.04,
            z: nextFrame.center.z + Math.max(1, nextFrame.radius) * 1.25,
          }) : 'n/a'),
          'texture candidates=' + (Array.isArray(data.debug?.textureCandidates) ? data.debug.textureCandidates.length : 0),
        ], data.debug));

        if (isLoginBackdrop && Array.isArray(data.renderPasses) && data.renderPasses.length) {
          const passTextures = new Map((data.passTextures || []).map(texture => [texture.passIndex, texture]));
          const mats = data.renderPasses.map((pass, materialIndex) => {
            const texture = makeDataTexture(passTextures.get(pass.index));
            if (pass.indexCount > 0) geo.addGroup(pass.indexStart, pass.indexCount, materialIndex);
            return makeTextureMaterial(texture, pass);
          });
          materialsRef.current = mats;
          setTextureMissing(![...passTextures.values()].some(texture => texture.rgba));
          setDebugState(makeDebugState("render passes ready", ['passes=' + mats.length, 'textures=' + [...passTextures.values()].filter(texture => texture.rgba).length], data.debug));
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
            setDebugState(makeDebugState("no texture found", ["fallback diffuse path used", 'texturePath=' + (data.texturePath || "none")], data.debug));
          }
        }

        setLoading(false);
      })
      .catch(e => {
        if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
        if (cancelled || modelKey.current !== key) return;
        setError(e.message);
        setDebugState(makeDebugState("error", [e.message]));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (progressTimer) clearTimeout(progressTimer);
    };
  }, [active, modelPath, worldmapMpqPath]);

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
      {debug && debugState.stage !== "idle" && (
        <div className="glue-m2-debug">
          <div className="glue-m2-debug-title">{debugState.stage}</div>
          {(debugState.lines || []).map((line, idx) => (
            <div key={idx} className="glue-m2-debug-line">{line}</div>
          ))}
        </div>
      )}
      {mounted && (
        <Canvas
          style={{ width: '100%', height: '100%' }}
          key={embeddedCamera ? 'embedded-camera' : 'preview-camera'}
          camera={{ position: cameraState.position, fov: cameraState.fov, near: cameraState.near, far: cameraState.far }}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#11131a']} />
          <CameraRig state={cameraState} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 8, 5]} intensity={1.2} />
          <directionalLight position={[-3, 3, -4]} intensity={0.25} />
          {interactive && <OrbitControls
            enablePan={false}
            minDistance={cameraState.minDistance}
            maxDistance={cameraState.maxDistance}
            target={cameraState.target}
          />}
          <Scene geoRef={geoRef} textureRef={textureRef} materialsRef={materialsRef} frameRef={frameRef} showHelpers={showHelpers} />
        </Canvas>
      )}
      {showLabel && title && <div className="glue-m2-label">{title}</div>}
    </div>
  );
}

