import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Database, Play, Save, RefreshCw, Search, ChevronRight, FileCode } from 'lucide-react';
import './DbcSqlPage.css';

const DEFAULT_SQL = 'SELECT * FROM dbc LIMIT 100;';

export default function DbcSqlPage() {
  const { dbcPath } = useConnection();
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [selected, setSelected] = useState(null);   // { name, records, fields, path }

  const [sql, setSql] = useState(DEFAULT_SQL);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);       // { rows, columns, changes, error, written }

  const textareaRef = useRef(null);

  const loadFiles = useCallback(async () => {
    if (!dbcPath) return;
    setLoadingFiles(true);
    const res = await window.azeroth.dbcSql.listFiles({ folder: dbcPath });
    setFiles(res.files || []);
    setLoadingFiles(false);
  }, [dbcPath]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const selectFile = (file) => {
    const fp = `${dbcPath}\\${file.name}`;
    setSelected({ ...file, path: fp });
    setSql(`SELECT * FROM dbc LIMIT 100;`);
    setResult(null);
  };

  const runQuery = async (writeBack = false) => {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    const res = await window.azeroth.dbcSql.query({
      filePath: selected.path,
      sql: sql.trim(),
      writeBack,
    });
    setResult(res);
    setRunning(false);
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery(false);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      setSql(s => s.substring(0, start) + '  ' + s.substring(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  };

  const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql.trim());
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  return (
    <div className="dbc-sql-page fade-in">
      {/* Left: file list */}
      <aside className="dbc-file-list">
        <div className="dbc-file-list-header">
          <Database size={13} />
          <span>DBC Files</span>
          <button className="icon-btn" onClick={loadFiles} title="Refresh" disabled={loadingFiles}>
            <RefreshCw size={11} className={loadingFiles ? 'spin' : ''} />
          </button>
        </div>
        <div className="dbc-file-search">
          <Search size={11} />
          <input
            placeholder="Filter…"
            value={fileSearch}
            onChange={e => setFileSearch(e.target.value)}
          />
        </div>
        <div className="dbc-file-items">
          {loadingFiles && <span className="dbc-file-empty">Loading…</span>}
          {!loadingFiles && !dbcPath && <span className="dbc-file-empty">No DBC path set in Settings</span>}
          {!loadingFiles && dbcPath && filteredFiles.length === 0 && <span className="dbc-file-empty">No .dbc files found</span>}
          {filteredFiles.map(f => (
            <button
              key={f.name}
              className={`dbc-file-item${selected?.name === f.name ? ' active' : ''}`}
              onClick={() => selectFile(f)}
              title={f.name}
            >
              <FileCode size={11} />
              <span className="dbc-file-name">{f.name}</span>
              {f.records != null && (
                <span className="dbc-file-meta">{f.records}r·{f.fields}f</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Right: editor + results */}
      <div className="dbc-sql-main">
        {/* Editor panel */}
        <div className="dbc-editor-panel">
          <div className="dbc-editor-header">
            {selected
              ? <><ChevronRight size={12} /><span className="dbc-file-breadcrumb">{selected.name}</span><span className="dbc-meta-chip">{selected.records} records · {selected.fields} fields</span></>
              : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Select a DBC file to query</span>
            }
            <div className="dbc-editor-actions">
              <button
                className="btn-primary btn-sm"
                onClick={() => runQuery(false)}
                disabled={!selected || running}
                title="Run (Ctrl+Enter)"
              >
                <Play size={12} />
                {running ? 'Running…' : 'Run'}
              </button>
              {isWrite && (
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => runQuery(true)}
                  disabled={!selected || running}
                  title="Run and write changes back to DBC file"
                >
                  <Save size={12} />
                  Run & Save
                </button>
              )}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            className="dbc-sql-editor"
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM dbc LIMIT 100;"
            spellCheck={false}
            disabled={!selected}
          />
        </div>

        {/* Results panel */}
        <div className="dbc-results-panel">
          {!result && !running && (
            <div className="dbc-results-empty">
              {selected ? 'Run a query to see results' : 'Select a DBC file from the left panel'}
            </div>
          )}
          {running && <div className="dbc-results-empty">Running…</div>}
          {result && result.success === false && (
            <div className="dbc-results-error">{result.error}</div>
          )}
          {result && result.success && result.rows.length === 0 && result.columns.length === 0 && (
            <div className="dbc-results-info">
              {result.changes} row(s) affected{result.written ? ' · Saved to DBC file' : ''}
            </div>
          )}
          {result && result.success && result.columns.length > 0 && (
            <>
              <div className="dbc-results-bar">
                <span>{result.rows.length} row(s)</span>
              </div>
              <div className="dbc-results-scroll">
                <table className="dbc-results-table">
                  <thead>
                    <tr>
                      {result.columns.map(c => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map(c => (
                          <td key={c}>{row[c] == null ? <span className="cell-null">NULL</span> : String(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
