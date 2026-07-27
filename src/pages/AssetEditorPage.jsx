import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Crosshair, Grid3X3, Move, MousePointer2, RotateCw, Scan, Scale, Upload, AlertTriangle, CheckCircle2, RotateCcw, Search } from 'lucide-react';
import './AssetEditorPage.css';

const EMPTY_TRANSFORM = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const asFloat = value => value instanceof Float32Array ? value : new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4);
const asUint = value => value instanceof Uint32Array ? value : new Uint32Array(value.buffer, value.byteOffset, value.byteLength / 4);
const appearanceText = appearance => appearance ? `Skin ${appearance.skin} · Face ${appearance.face} · Hair ${appearance.hairStyle}/${appearance.hairColor} · Facial ${appearance.facialHair}` : 'No character appearance data';

function buildGeometry(data, selectedSubmesh, deform) {
  if (!data) return null;
  const geometry = new THREE.BufferGeometry();
  const source = asFloat(data.positions);
  const positions = new Float32Array(source);
  if (selectedSubmesh != null && deform && data.skinData?.submeshes?.[selectedSubmesh]) {
    const skin = data.skinData, submesh = skin.submeshes[selectedSubmesh];
    const changed = new Set();
    for (let i = 0; i < submesh.indexCount; i++) {
      const sourceIndex = skin.vertexLookup[skin.indexLookup[submesh.indexStart + i]];
      if (changed.has(sourceIndex)) continue;
      changed.add(sourceIndex);
      positions[sourceIndex * 3 + 1] += deform;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(asFloat(data.normals), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(asFloat(data.uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(asUint(data.indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildPassGeometry(data, source, submeshIndex) {
  const skin = data?.skinData, submesh = skin?.submeshes?.[submeshIndex];
  if (!submesh) return null;
  const indices = new Uint32Array(submesh.indexCount);
  for (let i = 0; i < submesh.indexCount; i++) indices[i] = skin.vertexLookup[skin.indexLookup[submesh.indexStart + i]] || 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position')); geometry.setAttribute('normal', source.getAttribute('normal')); geometry.setAttribute('uv', source.getAttribute('uv'));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function M2RenderPass({ asset, pass, source }) {
  const geometry = useMemo(() => buildPassGeometry(asset, source, pass.submeshIndex), [asset, source, pass.submeshIndex]);
  const textureData = asset.passTextures?.find(entry => entry.passIndex === pass.index);
  const texture = useMemo(() => {
    if (!textureData?.rgba) return null;
    const value = new THREE.DataTexture(new Uint8Array(textureData.rgba), textureData.w, textureData.h, THREE.RGBAFormat);
    value.flipY = false; value.needsUpdate = true; return value;
  }, [textureData]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: texture, color: texture ? '#fff' : '#b88a62', side: THREE.DoubleSide, alphaTest: pass.blend === 1 ? 0.7 : 0, transparent: pass.blend >= 2, depthWrite: !pass.noDepthWrite, roughness: 0.8, blending: pass.blend === 3 || pass.blend === 4 ? THREE.AdditiveBlending : THREE.NormalBlending }), [pass, texture]);
  useEffect(() => () => { geometry?.dispose(); texture?.dispose(); material.dispose(); }, [geometry, texture, material]);
  return geometry ? <mesh geometry={geometry} material={material} renderOrder={pass.order ?? pass.index} /> : null;
}

function AssetMesh({ asset, transform, selectedSubmesh, deform, onSelect, objectRef }) {
  const geometry = useMemo(() => buildGeometry(asset, selectedSubmesh, deform), [asset, selectedSubmesh, deform]);
  const texture = useMemo(() => {
    if (!asset?.textureRgba) return null;
    const tex = new THREE.DataTexture(new Uint8Array(asset.textureRgba), asset.textureW, asset.textureH, THREE.RGBAFormat);
    tex.flipY = false; tex.needsUpdate = true; return tex;
  }, [asset]);
  useEffect(() => () => { geometry?.dispose(); texture?.dispose(); }, [geometry, texture]);
  if (!geometry) return null;
  const usesPasses = asset.renderPasses?.length && asset.passTextures?.length;
  return <group ref={objectRef} position={transform.position} rotation={transform.rotation} scale={transform.scale} onClick={e => { e.stopPropagation(); onSelect(); }}>
    {usesPasses ? asset.renderPasses.map(pass => <M2RenderPass key={pass.index} asset={asset} pass={pass} source={geometry} />) : <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial map={texture} color={texture ? '#ffffff' : '#b88a62'} side={THREE.DoubleSide} roughness={0.8} /></mesh>}
  </group>;
}

function CameraReset({ resetKey }) {
  const { camera, controls } = useThree();
  useEffect(() => { if (resetKey && controls) { camera.position.set(5, 4, 7); controls.target.set(0, 1, 0); controls.update(); } }, [resetKey, camera, controls]);
  return null;
}

function Viewport({ asset, transform, setTransform, tool, grid, selectedSubmesh, deform, resetKey, onSelect }) {
  const objectRef = useRef();
  const [dragging, setDragging] = useState(false);
  const onObjectChange = useCallback(() => {
    const obj = objectRef.current;
    if (!obj) return;
    // Euler.toArray() includes its string rotation order as a fourth item.
    setTransform({ position: obj.position.toArray(), rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.toArray() });
  }, [setTransform]);
  return <Canvas dpr={[1, 1.5]} shadows camera={{ position: [5, 4, 7], fov: 55, near: 0.05, far: 5000 }} gl={{ powerPreference: 'high-performance' }} onPointerMissed={onSelect}>
    <color attach="background" args={['#171923']} />
    <ambientLight intensity={0.65} /><directionalLight position={[8, 12, 6]} intensity={1.7} castShadow /><hemisphereLight intensity={0.5} groundColor="#202020" />
    {grid && <><gridHelper args={[40, 40, '#49516a', '#292d3e']} /><axesHelper args={[2]} /></>}
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.3} maxDistance={1000} enabled={!dragging} />
    <CameraReset resetKey={resetKey} />
    {asset && tool !== 'select'
      ? <TransformControls mode={tool} space="world" onMouseDown={() => setDragging(true)} onMouseUp={() => setDragging(false)} onObjectChange={onObjectChange}><AssetMesh asset={asset} transform={transform} selectedSubmesh={selectedSubmesh} deform={deform} objectRef={objectRef} onSelect={() => onSelect(true)} /></TransformControls>
      : <AssetMesh asset={asset} transform={transform} selectedSubmesh={selectedSubmesh} deform={deform} objectRef={objectRef} onSelect={() => onSelect(true)} />}
    <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" /></GizmoHelper>
  </Canvas>;
}

function VectorFields({ label, value, onChange, step = 0.1 }) {
  return <div className="asset-vector"><span>{label}</span>{value.slice(0, 3).map((number, i) => <input key={i} type="number" step={step} value={Number(Number(number || 0).toFixed(3))} onChange={e => onChange(i, Number(e.target.value) || 0)} />)}</div>;
}

export default function AssetEditorPage() {
  const [path, setPath] = useState(''); const [asset, setAsset] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [assetQuery, setAssetQuery] = useState(''); const [assetResults, setAssetResults] = useState([]); const [searching, setSearching] = useState(false); const [displayId, setDisplayId] = useState(''); const [displayMatches, setDisplayMatches] = useState([]); const [selectedTexture, setSelectedTexture] = useState('');
  const [tool, setTool] = useState('select'); const [grid, setGrid] = useState(true); const [resetKey, setResetKey] = useState(0); const [selected, setSelected] = useState(false);
  const [selectedSubmesh, setSelectedSubmesh] = useState(null); const [deform, setDeform] = useState(0); const [transform, setTransform] = useState(EMPTY_TRANSFORM);
  const openPath = useCallback(async (modelPath = path, texturePath = '') => {
    const clean = modelPath.trim().replace(/\//g, '\\'); if (!clean) return setError('Enter an internal client M2 path or choose a file.');
    setLoading(true); setError(''); setAsset(null); setSelectedSubmesh(null); setDeform(0); setTransform(EMPTY_TRANSFORM);
    try { const result = await window.azeroth.m2.loadModelByPath({ modelPath: clean, texturePath }); if (!result?.success) throw new Error(result?.error || 'The M2 could not be loaded.'); setPath(result.data.modelPath); setSelectedTexture(texturePath); setAsset(result.data); const matches = await window.azeroth.m2.findDisplaysByModelPath({ modelPath: result.data.modelPath }); setDisplayMatches(matches?.success ? matches.data : []); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [path]);
  const pick = useCallback(async () => { const result = await window.azeroth.m2.pickModelPath(); if (!result?.success) return setError(result?.error || 'Could not open the picker.'); if (!result.canceled) { setPath(result.modelPath); openPath(result.modelPath); } }, [openPath]);
  const openDisplay = useCallback(async (value = displayId) => {
    const id = Number(value); if (!Number.isInteger(id) || id <= 0) return setError('Enter a valid CreatureDisplayID.');
    setLoading(true); setError(''); setAsset(null); setSelectedSubmesh(null); setDeform(0); setTransform(EMPTY_TRANSFORM);
    try { const result = await window.azeroth.m2.loadModel({ displayId: id }); if (!result?.success) throw new Error(result?.error || 'Creature display could not be loaded.'); setPath(result.data.modelPath); setSelectedTexture(result.data.texturePath || ''); setAsset(result.data); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [displayId]);
  useEffect(() => {
    const term = assetQuery.trim();
    if (!term) { setAssetResults([]); setSearching(false); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await window.azeroth.m2.searchAssets({ query: term, limit: 80 });
        if (!cancelled) { setAssetResults(result?.success ? result.data : []); if (!result?.success) setError(result?.error || 'Asset search failed.'); }
      } finally { if (!cancelled) setSearching(false); }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [assetQuery]);
  const stats = useMemo(() => asset ? { vertices: asFloat(asset.positions).length / 3, triangles: asUint(asset.indices).length / 3, submeshes: asset.submeshes?.length || 0 } : null, [asset]);
  const updateVector = (field, i, value) => setTransform(current => ({ ...current, [field]: current[field].map((v, index) => index === i ? value : v) }));
  const validation = asset ? [
    { ok: true, text: `M2 geometry loaded: ${stats.vertices.toLocaleString()} vertices.` },
    { ok: !!asset.skinData, text: asset.skinData ? `Skin loaded: ${stats.submeshes} submeshes.` : 'Missing or unsupported SKIN data.' },
    { ok: !!asset.texturePath, text: asset.texturePath ? `Texture loaded: ${asset.texturePath}` : 'No compatible texture was found; using a neutral preview material.' },
  ] : [];
  return <div className="asset-editor-page fade-in">
    <header className="asset-header"><div><h1>WoW 3D Asset Editor</h1><p>Static M2 inspection and preview transforms. Client assets stay read-only.</p></div><div className="asset-header-status">{loading ? 'Loading asset…' : asset ? 'Preview ready' : 'No asset loaded'}</div></header>
    <div className="asset-toolbar">
      {[['select', MousePointer2, 'Select'], ['translate', Move, 'Move'], ['rotate', RotateCw, 'Rotate'], ['scale', Scale, 'Scale']].map(([key, Icon, label]) => <button key={key} className={tool === key ? 'active' : ''} onClick={() => setTool(key)}><Icon size={15} />{label}</button>)}
      <span className="asset-toolbar-divider" /><button onClick={pick}><Upload size={15} />Open M2</button><button onClick={() => openPath()}><Box size={15} />Load path</button><input style={{ width: 88, minWidth: 88, marginLeft: 0 }} aria-label="Creature Display ID" value={displayId} onChange={e => setDisplayId(e.target.value)} onKeyDown={e => e.key === 'Enter' && openDisplay()} placeholder="Display ID" /><button onClick={openDisplay}><Box size={15} />Open display</button><button onClick={() => setResetKey(k => k + 1)}><RotateCcw size={15} />Reset camera</button><button className={grid ? 'active' : ''} onClick={() => setGrid(v => !v)}><Grid3X3 size={15} />Grid</button>
      <input aria-label="M2 asset path" value={path} onChange={e => setPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && openPath()} placeholder="Creature\...\Model.m2 (MPQ path)" />
    </div>
    <div className="asset-workspace">
      <aside className="asset-panel asset-outliner"><div className="asset-panel-title">Assets</div><label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 7, padding: 6, border: '1px solid #353b50', borderRadius: 4 }}><Search size={14} /><input style={{ width: '100%', minWidth: 0, background: 'transparent', border: 0, outline: 0, color: '#dbe2f4' }} value={assetQuery} onChange={e => setAssetQuery(e.target.value)} placeholder="Search M2s, e.g. worgen" /></label><div style={{ maxHeight: 300, overflow: 'auto' }}>{searching && <div className="asset-hint">Searching client data…</div>}{!searching && assetQuery && !assetResults.length && <div className="asset-hint">No M2 assets found.</div>}{assetResults.map(modelPath => <button key={modelPath} className="asset-node" title={modelPath} onClick={() => { setPath(modelPath); openPath(modelPath); }}><Box size={13} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelPath.split('\\').pop()}</span></button>)}</div><div className="asset-panel-title">Scene outliner</div><button className={`asset-node ${selected ? 'selected' : ''}`} onClick={() => setSelected(true)}><Box size={15} />{asset ? asset.modelPath.split('\\').pop() : 'No asset loaded'}</button></aside>
      <main className="asset-viewport">{asset ? <Viewport asset={asset} transform={transform} setTransform={setTransform} tool={tool} grid={grid} selectedSubmesh={selectedSubmesh} deform={deform} resetKey={resetKey} onSelect={setSelected} /> : <div className="asset-empty"><Crosshair size={32} /><strong>Open a static M2 to start</strong><span>Use an MPQ-internal path or choose an unpacked model inside the client Data folder.</span></div>}</main>
      <aside className="asset-panel asset-inspector"><div className="asset-panel-title">Inspector</div>{asset ? <div className="asset-scroll">
        <label className="asset-label">Model path<textarea readOnly value={asset.modelPath} /></label>
        <div className="asset-stat-grid"><div><b>{stats.vertices.toLocaleString()}</b><span>Vertices</span></div><div><b>{stats.triangles.toLocaleString()}</b><span>Triangles</span></div><div><b>{stats.submeshes}</b><span>Geosets</span></div></div>
        <h3>Transform</h3><VectorFields label="Position" value={transform.position} onChange={(i, v) => updateVector('position', i, v)} /><VectorFields label="Rotation" value={transform.rotation} onChange={(i, v) => updateVector('rotation', i, v)} step={0.05} /><VectorFields label="Scale" value={transform.scale} onChange={(i, v) => updateVector('scale', i, v)} step={0.05} />
        {displayMatches.length > 0 && <><h3>Creature Display variants</h3><label className="asset-label">Use CreatureDisplayInfo<select value={asset.displayId || ''} onChange={e => { setDisplayId(e.target.value); openDisplay(e.target.value); }}><option value="">Raw M2 fallback</option>{displayMatches.map(match => <option key={match.id} value={match.id}>Display #{match.id} · {appearanceText(match.appearance)}</option>)}</select></label></>}
        {asset.debug?.appearance && <><h3>Appearance (read-only)</h3><div className="asset-stat-grid"><div><b>{asset.debug.appearance.skin}</b><span>Skin</span></div><div><b>{asset.debug.appearance.face}</b><span>Face</span></div><div><b>{asset.debug.appearance.hairStyle}/{asset.debug.appearance.hairColor}</b><span>Hair</span></div></div><div className="asset-hint">Facial hair: {asset.debug.appearance.facialHair}. Select another linked display above to preview an existing in-game appearance.</div></>}
        <h3>Read-only mesh preview</h3><label className="asset-label">Selected submesh<select value={selectedSubmesh ?? ''} onChange={e => setSelectedSubmesh(e.target.value === '' ? null : Number(e.target.value))}><option value="">None</option>{asset.submeshes.map((submesh, i) => <option key={i} value={i}>#{i} · ID {submesh.id} · {Math.floor(submesh.indexCount / 3)} tris</option>)}</select></label><label className="asset-label">Preview Y offset <input type="range" min="-1" max="1" step="0.01" disabled={selectedSubmesh == null} value={deform} onChange={e => setDeform(Number(e.target.value))} /><span>{deform.toFixed(2)} — not saved</span></label>
      </div> : <div className="asset-hint">Select an M2 to inspect its geometry, render passes and textures.</div>}</aside>
    </div>
    <section className="asset-validation"><div className="asset-panel-title"><Scan size={14} />Asset information & validation</div>{error && <div className="asset-validation-row error"><AlertTriangle size={15} />{error}</div>}{asset && <><div className="asset-info-grid"><div><b>Texture candidates — click to preview</b>{asset.debug?.textureCandidates?.length ? asset.debug.textureCandidates.map(texturePath => <button key={texturePath} className="asset-node" style={{ margin: 0, width: '100%', padding: 3, color: selectedTexture === texturePath ? '#fff' : undefined }} onClick={() => openPath(asset.modelPath, texturePath)}>{texturePath}</button>) : <span>None embedded</span>}</div><div><b>Render passes</b>{asset.renderPasses?.length ? asset.renderPasses.map(pass => <code key={pass.index}>#{pass.index} · submesh {pass.submeshIndex} · blend {pass.blend} · flags {pass.renderFlags}</code>) : <span>None parsed</span>}</div></div>{validation.map((item, i) => <div key={i} className={`asset-validation-row ${item.ok ? 'ok' : 'warning'}`}>{item.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{item.text}</div>)}</>}</section>
  </div>;
}
