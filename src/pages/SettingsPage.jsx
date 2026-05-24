import { useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, Zap } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

export default function SettingsPage() {
  const { soapConfig, setSoapConfig, dbcPath, setDbcPath } = useConnection();
  const [form, setForm] = useState(soapConfig);
  const [dbcForm, setDbcForm] = useState(dbcPath);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [dbcSaved, setDbcSaved] = useState(false);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const handleDbcChange = (e) => setDbcForm(e.target.value);

  const handleSave = () => {
    setSoapConfig(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDbcSave = () => {
    setDbcPath(dbcForm);
    setDbcSaved(true);
    setTimeout(() => setDbcSaved(false), 2000);
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
