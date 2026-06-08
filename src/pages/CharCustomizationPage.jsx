import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Plus, Trash2, Save, RefreshCw, ImageOff, Loader2 } from 'lucide-react';
import './CharCustomizationPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { useBlpTexture } from '../lib/useBlpTexture';
import CharM2Viewer from '../components/char/CharM2Viewer';
import CharCreationPreview from '../components/char/CharCreationPreview';


const RACES = [
  { id: 1,  label: 'Human' },
  { id: 2,  label: 'Orc' },
  { id: 3,  label: 'Dwarf' },
  { id: 4,  label: 'Night Elf' },
  { id: 5,  label: 'Undead' },
  { id: 6,  label: 'Tauren' },
  { id: 7,  label: 'Gnome' },
  { id: 8,  label: 'Troll' },
  { id: 10, label: 'Blood Elf' },
  { id: 11, label: 'Draenei' },
];

const SECTION_TABS = [
  { id: 0, label: 'Skin' },
  { id: 1, label: 'Face' },
  { id: 2, label: 'Facial Hair' },
  { id: 3, label: 'Hair' },
  { id: 4, label: 'Underclothing' },
];

function TextureThumb({ blpPath, size = 56 }) {
  const { dataUrl, loading, error } = useBlpTexture(blpPath);
  if (!blpPath) return <div className="cc-thumb cc-thumb-empty" style={{ width: size, height: size }} title="Geen texture pad">—</div>;
  if (loading) return <div className="cc-thumb cc-thumb-loading" style={{ width: size, height: size }}><Loader2 size={14} className="cc-spin" /></div>;
  if (error)   return <div className="cc-thumb cc-thumb-error" style={{ width: size, height: size }} title={error}><ImageOff size={14} /></div>;
  return (
    <div className="cc-thumb" style={{ width: size, height: size }}>
      <img src={dataUrl} alt={blpPath} />
    </div>
  );
}

function PreviewSlot({ label, path, size = 96 }) {
  const { dataUrl, loading, error } = useBlpTexture(path);
  const missing = !loading && (error || !path);
  return (
    <div className="cc-preview-slot">
      <div className="cc-preview-slot-label">{label}</div>
      <div className={`cc-preview-thumb ${missing ? 'cc-preview-thumb-missing' : ''}`} style={{ width: size, height: size }}>
        {loading ? <Loader2 size={16} className="cc-spin" /> :
         missing ? <><ImageOff size={16} /><span>{path ? 'Niet gevonden' : 'Leeg'}</span></> :
         <img src={dataUrl} alt={path} />}
      </div>
      <div className={`cc-preview-slot-path ${missing && path ? 'cc-path-error' : ''}`} title={path || ''}>
        {path ? path : <em>leeg</em>}
      </div>
    </div>
  );
}

function SwatchItem({ row, isSelected, onClick }) {
  const { dataUrl, loading, error } = useBlpTexture(row.tex1);
  const missing = !loading && (error || !row.tex1);
  return (
    <button
      className={`cc-swatch${isSelected ? ' cc-swatch-selected' : ''}${missing ? ' cc-swatch-error' : ''}`}
      onClick={onClick}
      title={`Var ${row.variationIndex} / Color ${row.colorIndex}${row.tex1 ? '\n' + row.tex1 : '\n(geen texture)'}`}
    >
      {loading ? <Loader2 size={11} className="cc-spin" /> :
       missing ? <ImageOff size={11} /> :
       <img src={dataUrl} alt="" />}
      <span className="cc-swatch-badge">{row.colorIndex}</span>
    </button>
  );
}

function CharVisualPicker({ rows, selectedId, setSelectedId, race, gender, hasDataPath }) {
  const pickerRef = useRef(null);

  const selectedRow = useMemo(
    () => rows.find(r => r.id === selectedId) || rows[0] || null,
    [rows, selectedId]
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.variationIndex)) map.set(row.variationIndex, []);
      map.get(row.variationIndex).push(row);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([v, items]) => ({ variation: v, items: items.sort((a, b) => a.colorIndex - b.colorIndex) }));
  }, [rows]);

  const handleKeyDown = useCallback((e) => {
    if (!selectedRow || groups.length === 0) return;
    const curGroupIdx = groups.findIndex(g => g.items.some(r => r.id === selectedRow.id));
    if (curGroupIdx === -1) return;
    const curGroup = groups[curGroupIdx];
    const posInGroup = curGroup.items.findIndex(r => r.id === selectedRow.id);

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? curGroup.items[posInGroup + 1] : curGroup.items[posInGroup - 1];
      if (next) setSelectedId(next.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextGroup = e.key === 'ArrowDown' ? groups[curGroupIdx + 1] : groups[curGroupIdx - 1];
      if (nextGroup) {
        const targetPos = Math.min(posInGroup, nextGroup.items.length - 1);
        setSelectedId(nextGroup.items[targetPos].id);
      }
    }
  }, [selectedRow, groups, setSelectedId]);

  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <aside className="cc-visual-picker" ref={pickerRef} tabIndex={0}>
      <div className="cc-vp-model">
        <CharM2Viewer
          race={race}
          gender={gender}
          skinBlp={selectedRow?.tex1 || null}
          active={hasDataPath}
        />
      </div>

      <div className="cc-vp-swatches">
        {!hasDataPath && (
          <div className="cc-preview-warn">Geen WoW Data-pad — textures laden niet.</div>
        )}
        {rows.length === 0 ? (
          <div className="cc-preview-empty">Geen records voor deze selectie.</div>
        ) : (
          groups.map(({ variation, items }) => (
            <div key={variation} className="cc-swatch-group">
              <div className="cc-swatch-group-label">Var {variation}</div>
              <div className="cc-swatch-row">
                {items.map(row => (
                  <SwatchItem
                    key={row.id}
                    row={row}
                    isSelected={selectedRow?.id === row.id}
                    onClick={() => setSelectedId(row.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {selectedRow && (
        <div className="cc-vp-detail">
          <div className="cc-vp-detail-header">
            <span className="cc-vp-detail-id">ID {selectedRow.id}</span>
            <span className="cc-vp-detail-coords">
              Var <strong>{selectedRow.variationIndex}</strong>
              {' / '}
              Color <strong>{selectedRow.colorIndex}</strong>
            </span>
            <span className="cc-vp-detail-flags">{selectedRow.flags === 1 ? 'Player' : 'NPC'}</span>
          </div>
          <div className="cc-vp-slots">
            <PreviewSlot label="Tex 1" path={selectedRow.tex1} />
            <PreviewSlot label="Tex 2" path={selectedRow.tex2} />
            <PreviewSlot label="Tex 3" path={selectedRow.tex3} />
          </div>
        </div>
      )}
    </aside>
  );
}

export default function CharCustomizationPage() {
  const { readCharSections, writeCharSections, dbcPath, worldmapMpqPath } = useConnection();

  const [allRecords, setAllRecords] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState(null);
  const [dirty, setDirty]           = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);

  const [race,      setRace]     = useState(1);
  const [gender,    setGender]   = useState(0);
  const [section,   setSection]  = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode,  setViewMode] = useState('table'); // 'table' | 'preview'

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await readCharSections();
    setLoading(false);
    if (r.success) {
      setAllRecords(r.records);
      setDirty(false);
    } else {
      setError(r.error);
    }
  }, [readCharSections]);

  useEffect(() => { load(); }, [load]);

  const visibleRows = allRecords
    ? allRecords.filter(r => r.race === race && r.sex === gender && r.baseSection === section)
    : [];

  const selectedRow = useMemo(() => {
    if (!allRecords) return null;
    if (selectedId == null) return visibleRows[0] || null;
    return allRecords.find(r => r.id === selectedId) || visibleRows[0] || null;
  }, [allRecords, selectedId, visibleRows]);

  const updateField = (id, field, value) => {
    setAllRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(true);
  };

  const addRow = () => {
    const maxId = allRecords.reduce((m, r) => Math.max(m, r.id), 0);
    const newRow = {
      id: maxId + 1,
      race,
      sex: gender,
      baseSection: section,
      tex1: '',
      tex2: '',
      tex3: '',
      flags: 1,
      variationIndex: 0,
      colorIndex: 0,
    };
    setAllRecords(prev => [...prev, newRow]);
    setDirty(true);
  };

  const deleteRow = (id) => {
    setAllRecords(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const r = await writeCharSections(allRecords);
    setSaving(false);
    if (r.success) {
      setSaveMsg('Opgeslagen');
      setDirty(false);
      setTimeout(() => setSaveMsg(null), 2500);
    } else {
      setSaveMsg('Fout: ' + r.error);
    }
  };

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="cc-page">
      <div className="cc-header">
        <div>
          <h1 className="cc-title">Character Customization</h1>
          <p className="cc-subtitle">CharSections.dbc — skin tones, faces, hair &amp; facial hair per race/gender</p>
        </div>
        <div className="cc-header-actions">
          {!dbcPath && (
            <span className="cc-warn">DBC path niet ingesteld — ga naar Settings</span>
          )}
          {saveMsg && <span className={saveMsg.startsWith('Fout') ? 'cc-error-msg' : 'cc-ok-msg'}>{saveMsg}</span>}
          <button className="cc-btn cc-btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} />
            Herladen
          </button>
          <button className="cc-btn cc-btn-primary" onClick={handleSave} disabled={saving || !allRecords || !dirty}>
            <Save size={14} />
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>

      <div className="cc-toolbar">
        <div className="cc-toolbar-group">
          <label className="cc-label">Race</label>
          <select className="cc-select" value={race} onChange={e => setRace(Number(e.target.value))}>
            {RACES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="cc-toolbar-group">
          <label className="cc-label">Gender</label>
          <div className="cc-gender-toggle">
            <button
              className={`cc-gender-btn ${gender === 0 ? 'active' : ''}`}
              onClick={() => setGender(0)}
            >Male</button>
            <button
              className={`cc-gender-btn ${gender === 1 ? 'active' : ''}`}
              onClick={() => setGender(1)}
            >Female</button>
          </div>
        </div>
        {dirty && <span className="cc-dirty-badge">● Unsaved</span>}
        <div className="cc-view-toggle">
          <button
            className={`cc-gender-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >Tabel</button>
          <button
            className={`cc-gender-btn ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
          >Preview</button>
        </div>
      </div>

      {viewMode === 'table' && <div className="cc-tabs">
        {SECTION_TABS.map(t => (
          <button
            key={t.id}
            className={`cc-tab ${section === t.id ? 'active' : ''}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>}

      <div className="cc-body">
        {loading && <div className="cc-status">Laden…</div>}
        {error   && <div className="cc-status cc-status-err">Fout: {error}</div>}
        {!loading && !error && allRecords && viewMode === 'preview' && (
          <CharCreationPreview
            allRecords={allRecords}
            race={race}
            gender={gender}
            hasDataPath={!!worldmapMpqPath}
          />
        )}
        {!loading && !error && allRecords && viewMode === 'table' && (
          <div className="cc-layout">
            <div className="cc-table-col">
              <div className="cc-table-wrap">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Textures</th>
                      <th>ID</th>
                      <th>Variation</th>
                      <th>Color</th>
                      <th>Texture 1</th>
                      <th>Texture 2</th>
                      <th>Texture 3</th>
                      <th>Flags</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="cc-empty">
                          Geen records voor deze combinatie. Gebruik "Rij toevoegen" om te beginnen.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map(row => (
                      <tr
                        key={row.id}
                        className={`cc-row ${selectedRow?.id === row.id ? 'cc-row-selected' : ''}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td>
                          <div className="cc-thumbs-row">
                            <TextureThumb blpPath={row.tex1} size={32} />
                            <TextureThumb blpPath={row.tex2} size={32} />
                            <TextureThumb blpPath={row.tex3} size={32} />
                          </div>
                        </td>
                        <td className="cc-cell-id">{row.id}</td>
                        <td>
                          <input
                            className="cc-input cc-input-sm"
                            type="text"
                            inputMode="numeric"
                            value={row.variationIndex}
                            onChange={e => updateField(row.id, 'variationIndex', Number(e.target.value) || 0)}
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-sm"
                            type="text"
                            inputMode="numeric"
                            value={row.colorIndex}
                            onChange={e => updateField(row.id, 'colorIndex', Number(e.target.value) || 0)}
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex1}
                            onChange={e => updateField(row.id, 'tex1', e.target.value)}
                            placeholder="pad/naar/texture.blp"
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex2}
                            onChange={e => updateField(row.id, 'tex2', e.target.value)}
                            placeholder=""
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex3}
                            onChange={e => updateField(row.id, 'tex3', e.target.value)}
                            placeholder=""
                          />
                        </td>
                        <td>
                          <select
                            className="cc-select cc-select-sm"
                            value={row.flags}
                            onChange={e => updateField(row.id, 'flags', Number(e.target.value))}
                          >
                            <option value={1}>1 — Player</option>
                            <option value={0}>0 — NPC only</option>
                          </select>
                        </td>
                        <td>
                          <button className="cc-delete-btn" onClick={e => { e.stopPropagation(); deleteRow(row.id); }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cc-footer">
                <button className="cc-btn cc-btn-ghost" onClick={addRow}>
                  <Plus size={14} />
                  Rij toevoegen
                </button>
                <span className="cc-count">{visibleRows.length} record{visibleRows.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <CharVisualPicker
              rows={visibleRows}
              selectedId={selectedRow?.id ?? null}
              setSelectedId={setSelectedId}
              race={race}
              gender={gender}
              hasDataPath={!!worldmapMpqPath}
            />
          </div>
        )}
      </div>
    </div>
    </>
  );
}
