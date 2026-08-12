import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Braces, Eye, FileCode2, FolderOpen, Layers3, Maximize2, Minus, Plus, RefreshCcw, Save } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import GlueM2Viewer from '../components/glue/GlueM2Viewer';
import { buildGlueScene, GLUE_HEIGHT, GLUE_WIDTH, updateGlueNodeXml } from '../lib/glueXmlLayout';
import './DashboardPage.css';
import './EditorPage.css';
import './UIEditorPage.css';

const SCREEN_PRESETS = [
  {
    id: 'login', label: 'Login Screen', description: 'Account login controls and Northrend backdrop.',
    modelPath: 'Interface\\GLUES\\MODELS\\UI_MAINMENU_NORTHREND\\UI_MainMenu_Northrend.m2',
    files: [
      ['Interface\\GlueXML\\AccountLogin.xml', 'xml'],
      ['Interface\\GlueXML\\AccountLogin.lua', 'lua'],
      ['Interface\\GlueXML\\GlueStrings.lua', 'lua'],
      ['Interface\\GlueXML\\GlueParent.xml', 'xml'],
      ['Interface\\GlueXML\\OptionsSelect.xml', 'xml'],
      ['Interface\\GlueXML\\OptionsSelect.lua', 'lua'],
    ],
  },
  {
    id: 'char-select', label: 'Character Select', description: 'Character list, realm controls, and screen layout.',
    modelPath: 'Interface\\Glues\\MODELS\\UI_CharacterSelect\\UI_CharacterSelect.M2',
    files: [
      ['Interface\\GlueXML\\CharacterSelect.xml', 'xml'],
      ['Interface\\GlueXML\\CharacterSelect.lua', 'lua'],
    ],
  },
  {
    id: 'char-create', label: 'Character Create', description: 'Race selection and character creation controls.',
    modelPath: 'Interface\\GLUES\\MODELS\\UI_Orc\\UI_Orc.m2',
    files: [
      ['Interface\\GlueXML\\CharacterCreate.xml', 'xml'],
      ['Interface\\GlueXML\\CharacterCreate.lua', 'lua'],
      ['Interface\\GlueXML\\RaceSelect.xml', 'xml'],
      ['Interface\\GlueXML\\RaceSelect.lua', 'lua'],
    ],
  },
].map(preset => ({ ...preset, files: preset.files.map(([path, kind]) => ({ path, kind, label: path.split('\\').pop() })) }));

const visualTags = new Set(['Texture', 'FontString', 'Button', 'CheckButton', 'EditBox', 'Slider', 'StatusBar']);

function renderNodeContent(node, textureUrl) {
  if (textureUrl && node.tag === 'Texture') return <img src={textureUrl} alt="" draggable={false} />;
  if (textureUrl && (node.tag === 'Button' || node.tag === 'CheckButton')) return <><img className="glue-node-bg" src={textureUrl} alt="" draggable={false} /><span className="glue-node-text">{node.text || node.name}</span></>;
  if (node.tag === 'EditBox') return <span className="glue-node-placeholder">{node.text || node.name || 'EditBox'}</span>;
  if (node.tag === 'CheckButton') return <><span className="glue-check-box" /> <span>{node.text || node.name}</span></>;
  if (node.tag === 'FontString') return node.text ? <span>{node.text}</span> : null;
  if (node.tag === 'Texture') return null;
  return <span>{node.text || node.name || node.tag}</span>;
}

function isRenderableNode(node) {
  if (node.tag === 'Texture') return !!(node.texturePath || node.color);
  if (node.tag === 'FontString') return !!node.text;
  return visualTags.has(node.tag) || (node.tag === 'Frame' && node.texturePath);
}

function GlueCanvas({ scene, modelPath, textures, selectedId, onSelect, onMove }) {
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [dragDelta, setDragDelta] = useState({ id: null, x: 0, y: 0 });
  const [visibility, setVisibility] = useState({});

  useEffect(() => setVisibility({}), [scene]);


  useEffect(() => {
    const update = () => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (rect?.width && rect?.height) setFit(Math.min(rect.width / GLUE_WIDTH, rect.height / GLUE_HEIGHT));
    };
    update();
    const observer = new ResizeObserver(update);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const move = event => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const scale = Math.max(0.01, fit * zoom);
      setDragDelta({ id: drag.node.id, x: (event.clientX - drag.startX) / scale, y: (event.clientY - drag.startY) / scale });
    };
    const end = event => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const scale = Math.max(0.01, fit * zoom);
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      dragRef.current = null;
      setDragDelta({ id: null, x: 0, y: 0 });
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) onMove(drag.node, dx, dy);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [fit, zoom, onMove]);

  const scale = fit * zoom;
  const nodesById = new Map(scene.nodes.map(node => [node.id, node]));
  const hiddenCache = new Map();
  const nodesByName = new Map(scene.nodes.filter(node => node.name).map(node => [node.name, node]));
  const isHidden = node => {
    if (hiddenCache.has(node.id)) return hiddenCache.get(node.id);
    const forced = node.name && visibility[node.name];
    const forcedHidden = node.name && visibility[node.name] === false;
    const ownHidden = node.tag === 'ModelFFX' && node.setAllPoints ? false : (forced ? false : forcedHidden || node.runtimeHidden);
    const candidateParent = nodesById.get(node.parentId) || nodesByName.get(node.parentName);
    const parent = candidateParent !== node ? candidateParent : null;
    const hidden = ownHidden || (parent ? isHidden(parent) : false);
    hiddenCache.set(node.id, hidden);
    return hidden;
  };
  const activate = node => {
    const show = node.actionTargets?.show || [];
    const hide = node.actionTargets?.hide || [];
    if (!show.length && !hide.length) return;
    setVisibility(current => {
      const next = { ...current };
      show.forEach(name => { next[name] = true; });
      hide.forEach(name => { next[name] = false; });
      return next;
    });
  };
  const visibleNodes = scene.nodes.filter(node => !isHidden(node) && isRenderableNode(node));
  return (
    <div className="glue-canvas-host" ref={hostRef}>
      <div className="glue-canvas-tools">
        <button onClick={() => setZoom(value => Math.max(0.5, value - 0.1))} title="Zoom out"><Minus size={14} /></button>
        <button onClick={() => setZoom(value => Math.min(2.5, value + 0.1))} title="Zoom in"><Plus size={14} /></button>
        <button onClick={() => setZoom(1)} title="Fit"><Maximize2 size={14} /></button>
        <span>{Math.round(scale * 100)}%</span>
      </div>
      <div className="glue-canvas" style={{ width: GLUE_WIDTH, height: GLUE_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="glue-model-layer">
          <GlueM2Viewer key={`${modelPath}:render-pass-v2`} modelPath={modelPath} title="" interactive={false} debug={false} showLabel={false} showHelpers={false} />
        </div>
        <div className="glue-ui-layer">
          {visibleNodes.map(node => {
            const delta = dragDelta.id === node.id ? dragDelta : { x: 0, y: 0 };
            const selected = selectedId === node.id;
            const textureUrl = textures[node.texturePath];
            return (
              <button
                type="button"
                key={node.id}
                className={`glue-scene-node tag-${node.tag.toLowerCase()}${selected ? ' selected' : ''}${textureUrl ? ' textured' : ''}`}
                style={{
                  left: node.box.x + delta.x,
                  top: node.box.y + delta.y,
                  width: Math.max(1, node.box.width),
                  height: Math.max(1, node.box.height),
                  zIndex: 20 + node.depth * 10 + node.order,
                  color: node.tag === 'Texture' ? undefined : node.color || undefined,
                  backgroundColor: node.tag === 'Texture' ? node.color || undefined : undefined,
                  fontSize: ['Button', 'CheckButton', 'FontString'].includes(node.tag)
                    ? Math.max(8, Math.min(14, node.box.height * 0.38))
                    : undefined,
                }}
                title={`${node.tag} ${node.name || ''}`}
                onClick={event => { event.stopPropagation(); onSelect(node.id); activate(node); }}
                onPointerDown={event => {
                  event.stopPropagation();
                  onSelect(node.id);
                  if (!node.editable) return;
                  dragRef.current = { node, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
              >
                {renderNodeContent(node, textureUrl)}
              </button>
            );
          })}
        </div>
      </div>
      {!visibleNodes.length && <div className="glue-canvas-empty">No visible XML controls were resolved.</div>}
    </div>
  );
}

function NodeInspector({ node, onApply }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    setDraft(node ? { text: node.rawText || node.text || '', x: Math.round(node.box.x), y: Math.round(node.box.y), width: Math.round(node.box.width), height: Math.round(node.box.height) } : null);
  }, [node?.id, node?.rawText, node?.box.x, node?.box.y, node?.box.width, node?.box.height]);
  if (!node || !draft) return <div className="glue-inspector-empty">Select a control in the viewport or element list.</div>;
  const apply = () => {
    const patch = {
      width: draft.width,
      height: draft.height,
      dx: draft.x - node.box.x,
      dy: draft.y - node.box.y,
    };
    if (node.tag === 'FontString' || node.tag === 'Button' || node.tag === 'CheckButton') patch.text = draft.text;
    onApply(node, patch);
  };
  const field = (key, label, type = 'number') => (
    <label><span>{label}</span><input type={type} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: type === 'number' ? Number(event.target.value) : event.target.value }))} /></label>
  );
  return (
    <div className="glue-inspector-form">
      <div className="glue-selected-name">{node.name || '(anonymous)'}</div>
      <div className="glue-selected-meta">{node.tag} · {node.sourcePath.split('\\').pop()}</div>
      {(node.tag === 'FontString' || node.tag === 'Button' || node.tag === 'CheckButton') && field('text', 'Text / string key', 'text')}
      <div className="glue-field-grid">{field('x', 'X')}{field('y', 'Y')}{field('width', 'Width')}{field('height', 'Height')}</div>
      <div className="glue-readonly-row"><span>Anchor</span><code>{node.anchors[0]?.point || 'none'} → {node.anchors[0]?.relativeTo || node.parentName}</code></div>
      <div className="glue-readonly-row"><span>Texture</span><code>{node.texturePath || 'none'}</code></div>
      <button className="btn-primary glue-apply" disabled={!node.editable} onClick={apply}>Apply to XML</button>
      {!node.editable && <div className="glue-template-note">Inherited template controls are read-only. Edit their source file directly.</div>}
    </div>
  );
}

export default function UIEditorPage() {
  const { worldmapMpqPath, readBlpTextures } = useConnection();
  const [screenId, setScreenId] = useState('login');
  const preset = useMemo(() => SCREEN_PRESETS.find(item => item.id === screenId) || SCREEN_PRESETS[0], [screenId]);
  const [files, setFiles] = useState({});
  const [activePath, setActivePath] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [textures, setTextures] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);
  const unsavedGuard = useUnsavedGuard(dirty);

  const sources = useMemo(() => Object.values(files), [files]);
  const entryPaths = useMemo(() => preset.files.map(file => file.path), [preset]);
  const scene = useMemo(() => buildGlueScene(sources, entryPaths), [sources, entryPaths]);
  const selectedNode = scene.nodes.find(node => node.id === selectedId) || null;
  const activeFile = files[activePath] || null;
  const editablePaths = useMemo(() => new Set(entryPaths.map(path => path.toLowerCase())), [entryPaths]);

  const loadPreset = useCallback(async () => {
    if (!worldmapMpqPath) {
      setMessage({ type: 'error', text: 'Set the Client Data path in Settings first.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await window.azeroth.glue.readBundle(worldmapMpqPath, entryPaths);
      if (!result?.success) throw new Error(result?.error || 'Could not load GlueXML files.');
      const next = {};
      for (const item of result.files || []) {
        if (!item?.path) continue;
        const descriptor = preset.files.find(file => file.path.toLowerCase() === item.path.toLowerCase());
        next[item.path] = {
          path: item.path,
          label: descriptor?.label || item.path.split('\\').pop(),
          kind: descriptor?.kind || (/\.lua$/i.test(item.path) ? 'lua' : 'xml'),
          text: item.success ? String(item.text || '') : '',
          loaded: !!item.success,
          error: item.success ? null : item.error,
          editable: editablePaths.has(item.path.toLowerCase()),
        };
      }
      for (const descriptor of preset.files) {
        if (!next[descriptor.path]) next[descriptor.path] = { ...descriptor, text: '', loaded: false, error: 'File not found.', editable: true };
      }
      setFiles(next);
      setActivePath(preset.files[0]?.path || '');
      setSelectedId(null);
      setDirty(false);
      setMessage({ type: 'success', text: `Loaded ${scene.documents || 0} GlueXML dependencies from the client.` });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [worldmapMpqPath, entryPaths, preset, editablePaths]);

  useEffect(() => { loadPreset(); }, [loadPreset]);

  const texturePaths = useMemo(() => [...new Set(scene.nodes.map(node => node.texturePath).filter(Boolean))], [scene]);
  useEffect(() => {
    let cancelled = false;
    if (!worldmapMpqPath || !texturePaths.length) { setTextures({}); return undefined; }
    readBlpTextures(worldmapMpqPath, texturePaths).then(results => {
      if (cancelled) return;
      const next = {};
      results.forEach((result, index) => { if (result?.success && result.png) next[texturePaths[index]] = `data:image/png;base64,${result.png}`; });
      setTextures(next);
    }).catch(() => { if (!cancelled) setTextures({}); });
    return () => { cancelled = true; };
  }, [worldmapMpqPath, readBlpTextures, texturePaths]);

  const updateNode = useCallback((node, patch) => {
    const source = files[node.sourcePath];
    if (!source?.editable) return;
    try {
      const text = updateGlueNodeXml(source.text, node, patch);
      setFiles(current => ({ ...current, [node.sourcePath]: { ...current[node.sourcePath], text } }));
      setDirty(true);
      setActivePath(node.sourcePath);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  }, [files]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const descriptor of preset.files) {
        const file = files[descriptor.path];
        if (!file?.loaded) continue;
        const result = await window.azeroth.glue.writeTextFile(descriptor.path, file.text);
        if (!result?.success) throw new Error(result?.error || `Could not export ${descriptor.label}.`);
      }
      setDirty(false);
      setMessage({ type: 'success', text: 'Exported the edited GlueXML files to output\\Interface\\GlueXML.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const listedNodes = scene.nodes.filter(node => node.name && visualTags.has(node.tag)).slice(0, 240);
  return (
    <div className="ui2-page fade-in">
      <header className="page-header ui2-header">
        <div><h1 className="page-title">UI Editor</h1><p className="page-sub">Edit the real Blizzard GlueXML layout and export client-ready overrides.</p></div>
        <div className="ui2-actions">
          <button className="btn-ghost" onClick={loadPreset} disabled={loading}><RefreshCcw size={13} /> {loading ? 'Loading…' : 'Reload'}</button>
          <button className="btn-primary" onClick={save} disabled={!dirty || saving}><Save size={13} /> {saving ? 'Exporting…' : 'Export'}</button>
        </div>
      </header>

      <div className="ui2-toolbar">
        <label><span>Glue screen</span><select value={screenId} onChange={event => setScreenId(event.target.value)}>{SCREEN_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="ui2-path"><span>Client Data</span><code>{worldmapMpqPath || 'Not configured'}</code></div>
        <div className="ui2-stats"><span>{scene.nodes.length} controls</span><span>{scene.templates} templates</span><span>{Object.keys(textures).length}/{texturePaths.length} textures</span><strong className={dirty ? 'dirty' : ''}>{dirty ? 'Unsaved' : 'Clean'}</strong></div>
      </div>
      {message && <div className={`editor-msg ${message.type} ui2-message`}>{message.text}</div>}

      <main className="ui2-workspace">
        <aside className="ui2-panel ui2-library">
          <div className="ui2-panel-title"><FileCode2 size={13} /> Screen files</div>
          <div className="ui2-screen-note"><strong>{preset.label}</strong><span>{preset.description}</span></div>
          <div className="ui2-file-list">
            {preset.files.map(descriptor => {
              const file = files[descriptor.path];
              return <button key={descriptor.path} className={activePath === descriptor.path ? 'active' : ''} onClick={() => setActivePath(descriptor.path)}><span><strong>{descriptor.label}</strong><small>{descriptor.kind.toUpperCase()}</small></span><i className={file?.loaded ? 'ok' : 'missing'}>{file?.loaded ? 'OK' : 'MISS'}</i></button>;
            })}
          </div>
          <div className="ui2-panel-title elements"><Layers3 size={13} /> Elements</div>
          <div className="ui2-element-list">
            {listedNodes.map(node => <button key={node.id} className={selectedId === node.id ? 'active' : ''} onClick={() => { setSelectedId(node.id); setActivePath(node.sourcePath); }}><span>{node.name}</span><small>{node.tag}</small></button>)}
          </div>
        </aside>

        <section className="ui2-center">
          <div className="ui2-panel ui2-preview">
            <div className="ui2-panel-title"><Eye size={13} /> XML scene preview</div>
            <GlueCanvas scene={scene} modelPath={preset.modelPath} textures={textures} selectedId={selectedId} onSelect={setSelectedId} onMove={(node, dx, dy) => updateNode(node, { dx, dy })} />
          </div>
          <div className="ui2-panel ui2-source">
            <div className="ui2-panel-title"><Braces size={13} /> {activeFile?.label || 'Source'}</div>
            <textarea value={activeFile?.text || ''} disabled={!activeFile} spellCheck={false} onChange={event => {
              const text = event.target.value;
              setFiles(current => ({ ...current, [activePath]: { ...current[activePath], text, loaded: true } }));
              setDirty(true);
            }} />
          </div>
        </section>

        <aside className="ui2-panel ui2-inspector">
          <div className="ui2-panel-title"><Layers3 size={13} /> Inspector</div>
          <NodeInspector node={selectedNode} onApply={updateNode} />
          <div className="ui2-export-map">
            <div className="ui2-panel-title"><FolderOpen size={13} /> Export map</div>
            {preset.files.map(file => <div key={file.path}><span>{file.label}</span><code>output\\{file.path}</code>{files[file.path]?.error && <small><AlertTriangle size={11} /> {files[file.path].error}</small>}</div>)}
          </div>
        </aside>
      </main>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
    </div>
  );
}
