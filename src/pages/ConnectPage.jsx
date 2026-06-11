import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConnection } from '../lib/ConnectionContext';
import { Database, Zap } from 'lucide-react';
import ollieLogo from '../assets/Ollie.png';
import './ConnectPage.css';

export default function ConnectPage() {
  const { dbConfig, setDbConfig, connectDb, dbError, dbStatus } = useConnection();
  const [form, setForm] = useState(dbConfig);
  const [rememberMe, setRememberMe] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  // Load saved config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const result = await window.azeroth.config.load();
        if (result.success && result.data) {
          setForm(f => ({ ...f, ...result.data.db }));
          setRememberMe(result.data.rememberMe ?? true);
        }
      } catch (e) {
        // config API not available in browser preview
      }
      setLoaded(true);
    }
    loadConfig();
  }, []);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleConnect = async (e) => {
    e.preventDefault();
    // Save config if rememberMe is checked
    if (rememberMe) {
      try {
        const loadedConfig = await window.azeroth.config.load();
        const current = loadedConfig.success && loadedConfig.data ? loadedConfig.data : {};
        await window.azeroth.config.save({ ...current, db: form, rememberMe });
      } catch (e) {}
    }
    const result = await connectDb(form);
    if (result.success) navigate('/dashboard');
  };

  const isConnecting = dbStatus === 'connecting';

  if (!loaded) return null;

  return (
    <div className="connect-page">
      <div className="connect-bg" />

      <div className="connect-card">
        <div className="connect-header">
          <div className="connect-icon">
            <img src={ollieLogo} alt="Ollie" style={{ height: 52, width: 'auto' }} />
          </div>
          <h1>Azeroth Editor</h1>
          <p>Connect to your AzerothCore database</p>
        </div>

        <form onSubmit={handleConnect} className="connect-form">
          <div className="form-section">
            <div className="form-section-label">
              <Database size={13} />
              <span>MySQL Connection</span>
            </div>

            <div className="form-row">
              <div className="form-group flex-3">
                <label>Host</label>
                <input name="host" value={form.host} onChange={handleChange} placeholder="localhost" />
              </div>
              <div className="form-group flex-1">
                <label>Port</label>
                <input name="port" type="number" value={form.port} onChange={handleChange} placeholder="3306" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input name="user" value={form.user} onChange={handleChange} placeholder="acore" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="••••••••" />
              </div>
            </div>

            <div className="form-group">
              <label>World Database</label>
              <input name="database" value={form.database} onChange={handleChange} placeholder="acore_wotlk_world" />
            </div>
          </div>

          <label className="remember-me">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
            />
            <span>Remember credentials</span>
          </label>

          {dbError && (
            <div className="connect-error">
              <span>⚠</span> {dbError}
            </div>
          )}

          <button type="submit" className="connect-btn" disabled={isConnecting}>
            <Zap size={15} />
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </form>

        <div className="connect-hint">
          Make sure your AzerothCore server is running
        </div>
      </div>
    </div>
  );
}
