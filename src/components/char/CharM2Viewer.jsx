import { useEffect, useRef, useState } from 'react';
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

// Scene houdt de Canvas altijd gemount; texture wordt in-place geüpdatet
// zodat de WebGL context nooit opnieuw aangemaakt hoeft te worden.
function CharScene({ geoRef, textureRef, noTexRef }) {
  const matRef = useRef(new THREE.MeshLambertMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.05,
    color: '#44cc44',
  }));

  // Texture updaten via useEffect; THREE.js mutation, geen re-render nodig
  useEffect(() => {
    const mat = matRef.current;
    if (textureRef?.current) {
      mat.map = textureRef.current;
      mat.color.set('#ffffff');
    } else {
      mat.map = null;
      mat.color.set(noTexRef?.current ? '#44cc44' : '#ccaa88');
    }
    mat.needsUpdate = true;
  });

  const geo = geoRef?.current;
  if (!geo) return null;
  return <mesh geometry={geo} material={matRef.current} />;
}

export default function CharM2Viewer({ race, gender, skinBlp, active }) {
  const { worldmapMpqPath } = useConnection();

  const [mounted, setMounted]     = useState(false);
  const [geoReady, setGeoReady]   = useState(false);
  const [geoLoading, setGeoLoad]  = useState(false);
  const [geoError, setGeoError]   = useState(null);
  const [texLoading, setTexLoad]  = useState(false);
  const [noTex, setNoTex]         = useState(false);

  // Refs zodat CharScene altijd de laatste waarden ziet zonder herrender
  const geoRef     = useRef(null);
  const textureRef = useRef(null);
  const noTexRef   = useRef(false);
  const geoKey     = useRef(null);
  const texKey     = useRef(null);

  // ── Geometry laden: alleen bij race/gender wijziging ─────────────────────
  useEffect(() => {
    if (!active || !window.azeroth?.m2?.loadCharModel) return;
    const key = `${race}/${gender}`;
    if (geoKey.current === key) return;
    geoKey.current = key;

    setGeoLoad(true);
    setGeoError(null);
    setGeoReady(false);
    setMounted(true);

    window.azeroth.m2.loadCharModel({ race, gender, skinBlp: null })
      .then(res => {
        if (geoKey.current !== key) return;
        if (res?.success && res.data) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(toF32(res.data.positions), 3));
          g.setAttribute('normal',   new THREE.BufferAttribute(toF32(res.data.normals),   3));
          g.setAttribute('uv',       new THREE.BufferAttribute(toF32(res.data.uvs),       2));
          g.setIndex(new THREE.BufferAttribute(toU32(res.data.indices), 1));
          geoRef.current = g;
          setGeoReady(true);
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
  }, [active, race, gender]);

  // ── Texture laden: alleen bij skinBlp wijziging ───────────────────────────
  useEffect(() => {
    if (!active || !skinBlp || !worldmapMpqPath) {
      textureRef.current = null;
      noTexRef.current = !skinBlp ? false : true;
      setNoTex(noTexRef.current);
      return;
    }
    const key = `${worldmapMpqPath}|${skinBlp}`;
    if (texKey.current === key) return;
    texKey.current = key;
    setTexLoad(true);

    window.azeroth.dbc.readBlpTexture(worldmapMpqPath, skinBlp)
      .then(res => {
        if (texKey.current !== key) return;
        if (res?.success && res.png) {
          const img = new Image();
          img.onload = () => {
            if (texKey.current !== key) return;
            const cvs = document.createElement('canvas');
            cvs.width = img.width; cvs.height = img.height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const { data } = ctx.getImageData(0, 0, img.width, img.height);
            const tex = new THREE.DataTexture(new Uint8Array(data), img.width, img.height, THREE.RGBAFormat);
            tex.needsUpdate = true;
            tex.flipY = false;
            textureRef.current = tex;
            noTexRef.current = false;
            setNoTex(false);
            setTexLoad(false);
          };
          img.onerror = () => {
            textureRef.current = null;
            noTexRef.current = true;
            setNoTex(true);
            setTexLoad(false);
          };
          img.src = `data:image/png;base64,${res.png}`;
        } else {
          textureRef.current = null;
          noTexRef.current = true;
          setNoTex(true);
          setTexLoad(false);
        }
      })
      .catch(() => {
        if (texKey.current !== key) return;
        textureRef.current = null;
        noTexRef.current = true;
        setNoTex(true);
        setTexLoad(false);
      });
  }, [active, skinBlp, worldmapMpqPath]);

  if (!active) return null;

  return (
    <div className="char-m2-viewer">
      {/* Overlays */}
      {geoLoading && !geoReady && (
        <div className="char-m2-overlay">
          <Loader2 size={20} className="cc-spin" />
          <span>Model laden…</span>
        </div>
      )}
      {geoError && !geoReady && (
        <div className="char-m2-overlay char-m2-overlay-err">{geoError}</div>
      )}
      {noTex && geoReady && (
        <div className="char-m2-notex-badge" title={`Skin BLP niet gevonden:\n${skinBlp}`}>
          ⚠ Texture niet gevonden
        </div>
      )}
      {texLoading && (
        <div className="char-m2-loading-badge">
          <Loader2 size={11} className="cc-spin" />
        </div>
      )}

      {/* Canvas blijft altijd gemount — nooit opnieuw aanmaken */}
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
          <OrbitControls enablePan={false} minDistance={1} maxDistance={12} target={[0, 1.0, 0]} />
          <CharScene geoRef={geoRef} textureRef={textureRef} noTexRef={noTexRef} />
        </Canvas>
      )}
    </div>
  );
}
