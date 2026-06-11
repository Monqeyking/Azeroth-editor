import { useState, useEffect, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Shield, ShieldOff, Check, Info, FolderDown, FolderUp, FileBox } from 'lucide-react';
import './ExpansionLockPage.css';

const MAPS = [
  { id: 530, name: 'Outland',   expansion: 'tbc',   label: 'The Burning Crusade' },
  { id: 571, name: 'Northrend', expansion: 'wotlk', label: 'Wrath of the Lich King' },
];

// DBC files relevant for expansion feel
const TRACKED_DBC = [
  'WorldMapContinent.dbc',
  'WorldMapArea.dbc',
  'Map.dbc',
];

const EXPANSION_FOLDERS = [
  { id: 'Classic', label: 'Classic', color: '#c8a96e', sub: '1-60' },
  { id: 'TBC',     label: 'The Burning Crusade', color: '#7abeee', sub: '1-70' },
  { id: 'Wotlk',  label: 'Wrath of the Lich King', color: '#8a5acc', sub: '1-80' },
];

const PRESETS = [
  {
    id: 'vanilla',
    label: 'Vanilla',
    sub: 'Classic (1-60)',
    desc: 'Only Kalimdor and Eastern Kingdoms. Outland and Northrend are inaccessible.',
    disabled: [530, 571],
    color: '#c8a96e',
  },
  {
    id: 'tbc',
    label: 'The Burning Crusade',
    sub: 'Through TBC (1-70)',
    desc: 'Outland accessible. Northrend blocked.',
    disabled: [571],
    color: '#7abeee',
  },
  {
    id: 'wotlk',
    label: 'Wrath of the Lich King',
    sub: 'Full WotLK (1-80)',
    desc: 'All content accessible. No restrictions.',
    disabled: [],
    color: '#8a5acc',
  },
];

function detectPreset(disabledIds) {
  for (const p of PRESETS) {
    const a = [...p.disabled].sort().join(',');
    const b = [...disabledIds].sort().join(',');
    if (a === b) return p.id;
  }
  return 'custom';
}

function SnapshotSection({ dbcPath, expansionsFolder }) {
  const [folderFiles, setFolderFiles] = useState({});   // { Classic: ['WorldMapContinent.dbc', ...], ... }
  const [snapshotBusy, setSnapshotBusy] = useState(null);
  const [snapshotMsg, setSnapshotMsg] = useState(null);

  const loadFolderInfo = useCallback(async () => {
    const result = {};
    for (const exp of EXPANSION_FOLDERS) {
      const folder = `${expansionsFolder}\\${exp.id}`;
      const res = await window.azeroth.fs.listFolder({ folder });
      result[exp.id] = (res.files || []).filter(f => TRACKED_DBC.includes(f));
    }
    setFolderFiles(result);
  }, [expansionsFolder]);

  useEffect(() => { loadFolderInfo(); }, [loadFolderInfo]);

  const flash = (msg, isError = false) => {
    setSnapshotMsg({ text: msg, error: isError });
    setTimeout(() => setSnapshotMsg(null), 3000);
  };

  const saveSnapshot = async (expId) => {
    setSnapshotBusy(`save-${expId}`);
    const dest = `${expansionsFolder}\\${expId}`;
    const res = await window.azeroth.fs.copyFiles({ files: TRACKED_DBC, srcDir: dbcPath, destDir: dest });
    setSnapshotBusy(null);
    if (res.success) {
      flash(`Saved ${res.copied.length} file(s) to ${expId}${res.missing.length ? ` (${res.missing.length} not found in live DBC)` : ''}`);
      loadFolderInfo();
    } else {
      flash(res.error, true);
    }
  };

  const restoreSnapshot = async (expId) => {
    setSnapshotBusy(`restore-${expId}`);
    const src = `${expansionsFolder}\\${expId}`;
    const files = folderFiles[expId] || [];
    if (!files.length) { flash('No tracked DBC files in this snapshot', true); setSnapshotBusy(null); return; }
    const res = await window.azeroth.fs.copyFiles({ files, srcDir: src, destDir: dbcPath });
    setSnapshotBusy(null);
    if (res.success) flash(`Restored ${res.copied.length} file(s) to live DBC from ${expId}`);
    else flash(res.error, true);
  };

  return (
    <section className="exp-section">
      <div className="exp-section-label">DBC Snapshots</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Tracked files: {TRACKED_DBC.join(', ')}
      </p>
      {snapshotMsg && (
        <div className={`editor-msg ${snapshotMsg.error ? 'error' : 'success'}`} style={{ marginBottom: 12 }}>
          {snapshotMsg.text}
        </div>
      )}
      <div className="snapshot-grid">
        {EXPANSION_FOLDERS.map(exp => {
          const files = folderFiles[exp.id] || [];
          const hasFiles = files.length > 0;
          return (
            <div key={exp.id} className="snapshot-card" style={{ '--snap-color': exp.color }}>
              <div className="snapshot-card-header">
                <FileBox size={14} style={{ color: exp.color }} />
                <div>
                  <div className="snapshot-label">{exp.label}</div>
                  <div className="snapshot-sub">{exp.sub}</div>
                </div>
              </div>
              <div className="snapshot-files">
                {hasFiles
                  ? files.map(f => <span key={f} className="snapshot-file">{f}</span>)
                  : <span className="snapshot-empty">No snapshot yet</span>
                }
              </div>
              <div className="snapshot-actions">
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => saveSnapshot(exp.id)}
                  disabled={!!snapshotBusy}
                  title="Save current live DBC to this expansion"
                >
                  <FolderDown size={12} />
                  {snapshotBusy === `save-${exp.id}` ? 'Saving...' : 'Snapshot'}
                </button>
                <button
                  className="btn-primary"
                  style={{ fontSize: 12 }}
                  onClick={() => restoreSnapshot(exp.id)}
                  disabled={!!snapshotBusy || !hasFiles}
                  title="Restore this expansion's DBC to live folder"
                >
                  <FolderUp size={12} />
                  {snapshotBusy === `restore-${exp.id}` ? 'Restoring...' : 'Restore'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ExpansionLockPage() {
  const { query, dbcPath, expansionsFolder } = useConnection();
  const [disabledMaps, setDisabledMaps] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadDisables(); }, []);

  async function loadDisables() {
    setLoading(true);
    const res = await query(
      `SELECT entry FROM disables WHERE sourceType=2 AND entry IN (530,571)`
    );
    setDisabledMaps(new Set((res.data || []).map(r => r.entry)));
    setLoading(false);
  }

  async function applyPreset(preset) {
    const next = new Set(preset.disabled);
    setDisabledMaps(next);
  }

  async function toggleMap(id) {
    setDisabledMaps(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    // Remove existing entries for these maps
    await query(`DELETE FROM disables WHERE sourceType=2 AND entry IN (530,571)`);
    // Insert disabled ones
    for (const mapId of disabledMaps) {
      const map = MAPS.find(m => m.id === mapId);
      await query(
        `INSERT INTO disables (sourceType, entry, flags, params_0, params_1, comment) VALUES (2,?,0,'','',?)`,
        [mapId, `Expansion lock: ${map?.name}`]
      );
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const currentPreset = detectPreset(disabledMaps);

  return (
    <div className="exp-lock fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expansion Lock</h1>
          <p className="page-sub">Control which continents players can access</p>
        </div>
      </div>

      <div className="exp-lock-body">
        {/* Presets */}
        <section className="exp-section">
          <div className="exp-section-label">Presets</div>
          <div className="preset-grid">
            {PRESETS.map(p => (
              <button
                key={p.id}
                className={`preset-card${currentPreset === p.id ? ' active' : ''}`}
                style={{ '--preset-color': p.color }}
                onClick={() => applyPreset(p)}
                disabled={loading}
              >
                <div className="preset-card-top">
                  <span className="preset-label">{p.label}</span>
                  {currentPreset === p.id && <Check size={14} className="preset-check" />}
                </div>
                <span className="preset-sub">{p.sub}</span>
                <p className="preset-desc">{p.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Individual toggles */}
        <section className="exp-section">
          <div className="exp-section-label">Map Access</div>
          <div className="map-list">
            {loading ? (
              <div className="loading-text">Loading...</div>
            ) : MAPS.map(m => {
              const blocked = disabledMaps.has(m.id);
              return (
                <div key={m.id} className={`map-row${blocked ? ' blocked' : ''}`}>
                  <div className="map-row-info">
                    {blocked
                      ? <ShieldOff size={16} className="map-icon blocked" />
                      : <Shield size={16} className="map-icon allowed" />
                    }
                    <div>
                      <div className="map-name">{m.name}</div>
                      <div className="map-meta">{m.label} · Map {m.id}</div>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={blocked}
                      onChange={() => toggleMap(m.id)}
                    />
                    <span className="toggle-track">
                      <span className="toggle-thumb" />
                    </span>
                    <span className="toggle-label">{blocked ? 'Blocked' : 'Accessible'}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>

        <SnapshotSection dbcPath={dbcPath} expansionsFolder={expansionsFolder} />

        {/* Info notice */}
        <div className="exp-notice">
          <Info size={13} />
          <span>
            Changes only block <strong>server-side access</strong>. To hide Outland/Northrend from the
            in-game world map UI, the client-side <code>WorldMapContinent.dbc</code> also needs to be patched.
            This will be available in a future update.
          </span>
        </div>

        {/* Save */}
        <div className="exp-actions">
          <button className="btn-primary" onClick={save} disabled={saving || loading}>
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : 'Apply Changes'}
          </button>
          <button className="btn-ghost" onClick={loadDisables} disabled={loading || saving}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
