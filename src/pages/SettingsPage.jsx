import { useEffect, useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, Zap, Hash } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

const ID_RANGE_EDITORS = [
  { key: 'creature', label: 'Creature' },
  { key: 'item',     label: 'Item' },
  { key: 'spell',    label: 'Spell' },
  { key: 'quest',    label: 'Quest' },
  { key: 'talent',   label: 'Talent' },
];

export default function SettingsPage() {
  const { soapConfig, setSoapConfig, dbcPath, setDbcPath, minimapPath, setMinimapPath, worldmapMpqPath, setWorldmapMpqPath, idRanges, setIdRanges } = useConnection();
  const [form, setForm] = useState(soapConfig);
  const [dbcForm, setDbcForm] = useState(dbcPath);
  const [minimapForm, setMinimapForm] = useState(minimapPath);
  const [worldmapForm, setWorldmapForm] = useState(worldmapMpqPath);
  const [idRangesForm, setIdRangesForm] = useState(idRanges);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [dbcSaved, setDbcSaved] = useState(false);
  const [minimapSaved, setMinimapSaved] = useState(false);
  const [worldmapSaved, setWorldmapSaved] = useState(false);
  const [worldmapValidating, setWorldmapValidating] = useState(false);
  const [worldmapValidation, setWorldmapValidation] = useState(null);
  const [idRangesSaved, setIdRangesSaved] = useState(false);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const handleDbcChange = (e) => setDbcForm(e.target.value);

  useEffect(() => {
    setForm(soapConfig);
  }, [soapConfig]);

  useEffect(() => {
    setDbcForm(dbcPath);
  }, [dbcPath]);

  useEffect(() => {
    setMinimapForm(minimapPath);
  }, [minimapPath]);

  useEffect(() => {
    setWorldmapForm(worldmapMpqPath);
  }, [worldmapMpqPath]);

  useEffect(() => {
    setIdRangesForm(idRanges);
  }, [idRanges]);

  const persistConfig = async (patch) => {
    const result = await window.azeroth.config.load();
    const current = (result.success && result.data) ? result.data : {};
    await window.azeroth.config.save({ ...current, ...patch });
  };

  const handleMinimapSave = async () => {
    setMinimapPath(minimapForm);
    await persistConfig({ minimapPath: minimapForm });
    setMinimapSaved(true);
    setTimeout(() => setMinimapSaved(false), 2000);
  };

  const handleWorldmapSave = async () => {
    setWorldmapMpqPath(worldmapForm);
    await persistConfig({ worldmapMpqPath: worldmapForm });
    setWorldmapSaved(true);
    setTimeout(() => setWorldmapSaved(false), 2000);
  };

  const handleWorldmapValidate = async () => {
    setWorldmapValidating(true);
    setWorldmapValidation(null);
    try {
      const result = await window.azeroth.worldmap.validatePath(worldmapForm);
      setWorldmapValidation(result);
    } catch (e) {
      setWorldmapValidation({ success: false, error: e.message });
    }
    setWorldmapValidating(false);
  };

  const handleSave = async () => {
    setSoapConfig(form);
    await persistConfig({ soap: form });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDbcSave = async () => {
    setDbcPath(dbcForm);
    await persistConfig({ dbcPath: dbcForm });
    setDbcSaved(true);
    setTimeout(() => setDbcSaved(false), 2000);
  };

  const handleIdRangesSave = async () => {
    const parsed = {};
    for (const { key } of ID_RANGE_EDITORS) {
      parsed[key] = parseInt(idRangesForm[key]) || 4000000;
    }
    setIdRanges(parsed);
    await persistConfig({ idRanges: parsed });
    setIdRangesSaved(true);
    setTimeout(() => setIdRangesSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.azeroth.soap.command({
        ...form,
        command: '.server info'
      });
      setTestResult({ success: result.success, text: result.success ? result.result : result.error });
    } catch (e) {
      setTestResult({ success: false, text: e.message });
    }
    setTesting(false);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }} className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure SOAP and editor preferences</p>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 560 }}>
        <div className="panel">
          <div className="panel-header">
            <Zap size={13} />
            <span>SOAP — Live Server Connection</span>
          </div>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              SOAP allows live-reloading changes without restarting the server.
              Enable it in <code style={{ color: 'var(--gold)', background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: 3 }}>worldserver.conf</code>:
              <br/><code style={{ color: 'var(--text-primary)', fontSize: 11 }}>SOAP.Enabled = 1 · SOAP.IP = 127.0.0.1 · SOAP.Port = 7878</code>
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 10, marginBottom: 10 }}>
              <div className="field-group">
                <label>Host</label>
                <input name="host" value={form.host} onChange={handleChange} placeholder="127.0.0.1" />
              </div>
              <div className="field-group">
                <label>Port</label>
                <input name="port" type="number" value={form.port} onChange={handleChange} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div className="field-group">
                <label>Username (GM account)</label>
                <input name="user" value={form.user} onChange={handleChange} placeholder="admin" />
              </div>
              <div className="field-group">
                <label>Password</label>
                <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="••••••••" />
              </div>
            </div>

            <div className="field-group" style={{ marginBottom: 16 }}>
              <label>GM Character Name (for SOAP teleport)</label>
              <input name="characterName" value={form.characterName ?? ''} onChange={handleChange} placeholder="Redleaf" />
            </div>

            {testResult && (
              <div className={`editor-msg ${testResult.success ? 'success' : 'error'}`} style={{ marginBottom: 12 }}>
                {testResult.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={handleTest} disabled={testing}>
                <Zap size={13} /> {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button className="btn-primary" onClick={handleSave}>
                <Save size={13} /> {saved ? 'Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-header">
            <Hash size={13} />
            <span>Custom ID Ranges — Clone start IDs</span>
          </div>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Startpunt voor het zoeken naar een vrije ID bij het klonen van records. Standaard: 4.000.000.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {ID_RANGE_EDITORS.map(({ key, label }) => (
                <div key={key} className="field-group">
                  <label>{label} ID Range Start</label>
                  <input
                    type="number"
                    value={idRangesForm[key] ?? 4000000}
                    onChange={e => setIdRangesForm(f => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <button className="btn-primary" onClick={handleIdRangesSave}>
              <Save size={13} /> {idRangesSaved ? 'Opgeslagen!' : 'Save ID Ranges'}
            </button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-header">
            <Zap size={13} />
            <span>Minimap Tiles — Spawn Map achtergrond</span>
          </div>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Map naar de map met minimap tiles. Verwacht structuur: <code style={{ color: 'var(--gold)', background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: 3 }}>Map_0\Map_0_32_32.png</code>
              <br/>Ondersteunde formaten: PNG, JPEG.
            </p>
            <div className="field-group" style={{ marginBottom: 16 }}>
              <label>Minimap Path</label>
              <input
                value={minimapForm}
                onChange={e => setMinimapForm(e.target.value)}
                placeholder="D:\WoW\Minimap"
              />
            </div>
            {minimapSaved && (
              <div className="editor-msg success" style={{ marginBottom: 12 }}>
                Minimap path opgeslagen!
              </div>
            )}
            <button className="btn-primary" onClick={handleMinimapSave}>
              <Save size={13} /> {minimapSaved ? 'Opgeslagen!' : 'Save Minimap Path'}
            </button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-header">
            <Zap size={13} />
            <span>Worldmap Tiles — WoW Client Data</span>
          </div>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Pad naar de <code style={{ color: 'var(--gold)', background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: 3 }}>Data</code>-map van je WoW-client.
              De app zoekt automatisch in alle MPQ-bestanden (root + <code style={{ color: 'var(--gold)', background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: 3 }}>enUS/</code>) naar worldmap tiles.
              <br/>Voorbeeld: <code style={{ color: 'var(--text-primary)', fontSize: 11 }}>D:\CaioCore\Client\Data</code>
            </p>
            <div className="field-group" style={{ marginBottom: 16 }}>
              <label>WoW Client Data-map (optioneel)</label>
              <input
                value={worldmapForm}
                onChange={e => setWorldmapForm(e.target.value)}
                placeholder="D:\CaioCore\Client\Data"
              />
            </div>
            {worldmapValidation && (
              <div className={`editor-msg ${worldmapValidation.success ? 'success' : 'error'}`} style={{ marginBottom: 12 }}>
                {worldmapValidation.message || worldmapValidation.error}
                {worldmapValidation.count && ` (${worldmapValidation.count} tiles)`}
              </div>
            )}
            {worldmapSaved && (
              <div className="editor-msg success" style={{ marginBottom: 12 }}>
                Worldmap path opgeslagen!
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" onClick={handleWorldmapValidate} disabled={worldmapValidating || !worldmapForm}>
                <Zap size={13} /> {worldmapValidating ? 'Validating...' : 'Validate Path'}
              </button>
              <button className="btn-primary" onClick={handleWorldmapSave}>
                <Save size={13} /> {worldmapSaved ? 'Opgeslagen!' : 'Save Worldmap Path'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-header">
            <Zap size={13} />
            <span>DBC Files — Talent Tree Data</span>
          </div>
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Path to DBC files directory (Talent.dbc, TalentTab.dbc, Spell.dbc).
              <br/>Example: <code style={{ color: 'var(--gold)', background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: 3 }}>D:\CaioCore\CaioServer\data\dbc</code>
            </p>

            <div className="field-group" style={{ marginBottom: 16 }}>
              <label>DBC Path</label>
              <input
                value={dbcForm}
                onChange={handleDbcChange}
                placeholder="D:\CaioCore\CaioServer\data\dbc"
              />
            </div>

            {dbcSaved && (
              <div className="editor-msg success" style={{ marginBottom: 12 }}>
                DBC path saved!
              </div>
            )}

            <button className="btn-primary" onClick={handleDbcSave}>
              <Save size={13} /> {dbcSaved ? 'Saved!' : 'Save DBC Path'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
