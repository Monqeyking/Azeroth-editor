import { useState, useEffect, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import './CharCustomizationPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';

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

export default function CharCustomizationPage() {
  const { readCharSections, writeCharSections, dbcPath } = useConnection();

  const [allRecords, setAllRecords] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState(null);
  const [dirty, setDirty]           = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);

  const [race,    setRace]    = useState(1);
  const [gender,  setGender]  = useState(0);
  const [section, setSection] = useState(0);

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
      </div>

      <div className="cc-tabs">
        {SECTION_TABS.map(t => (
          <button
            key={t.id}
            className={`cc-tab ${section === t.id ? 'active' : ''}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="cc-body">
        {loading && <div className="cc-status">Laden…</div>}
        {error   && <div className="cc-status cc-status-err">Fout: {error}</div>}
        {!loading && !error && allRecords && (
          <>
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
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
                      <td colSpan={8} className="cc-empty">
                        Geen records voor deze combinatie. Gebruik "Rij toevoegen" om te beginnen.
                      </td>
                    </tr>
                  )}
                  {visibleRows.map(row => (
                    <tr key={row.id} className="cc-row">
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
                        <button className="cc-delete-btn" onClick={() => deleteRow(row.id)}>
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
          </>
        )}
      </div>
    </div>
    </>
  );
}
