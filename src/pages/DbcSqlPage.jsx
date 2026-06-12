import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import {
  Database, Play, Save, RefreshCw, Search, ChevronRight,
  FileCode, Download, History, X
} from 'lucide-react';
import './DbcSqlPage.css';
import { KNOWN_SCHEMAS, KNOWN_STRING_COLS, KNOWN_FLOAT_COLS } from '../lib/dbcSchemas';

const DEFAULT_SQL = 'SELECT * FROM dbc LIMIT 100;';
const LIMIT_OPTIONS = [50, 100, 500, 1000, 5000];
const MAX_HISTORY = 20;

function toFloat(int32) {
  const buf = new ArrayBuffer(4);
  new Int32Array(buf)[0] = int32;
  return new Float32Array(buf)[0];
}

function exportCsv(columns, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) lines.push(columns.map(c => escape(row[c])).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'export.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function DbcSqlPage() {
  const { dbcPath } = useConnection();
  const [files, setFiles]               = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileSearch, setFileSearch]     = useState('');
  const [selected, setSelected]         = useState(null);
  const [sql, setSql]                   = useState(DEFAULT_SQL);
  const [running, setRunning]           = useState(false);
  const [result, setResult]             = useState(null);
  const [limit, setLimit]               = useState(100);
  const [floatCols, setFloatCols]       = useState(new Set());
  const [history, setHistory]           = useState([]);
  const [showHistory, setShowHistory]   = useState(false);
  const [editorPct, setEditorPct]       = useState(35);

  const textareaRef   = useRef(null);
  const mainRef       = useRef(null);
  const splitDragging = useRef(false);
  const splitStartY   = useRef(0);
  const splitStartPct = useRef(35);
  const autoRunRef    = useRef(false);

  // Resizable split
  useEffect(() => {
    const onMove = (e) => {
      if (!splitDragging.current || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const pct  = ((e.clientY - rect.top) / rect.height) * 100;
      setEditorPct(Math.min(80, Math.max(15, pct)));
    };
    const onUp = () => {
      if (splitDragging.current) {
        splitDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

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
    setSql(`SELECT * FROM dbc LIMIT ${limit};`);
    setResult(null);
    setFloatCols(new Set(KNOWN_FLOAT_COLS[file.name] || []));
    autoRunRef.current = true;
  };

  useEffect(() => {
    if (autoRunRef.current && selected) {
      autoRunRef.current = false;
      runQuery(false);
    }
  }, [selected]);

  const runQuery = async (writeBack = false) => {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    const stringCols = KNOWN_STRING_COLS[selected.name] || [];
    const res = await window.azeroth.dbcSql.query({
      filePath: selected.path,
      sql: sql.trim(),
      writeBack,
      stringCols,
    });
    setResult(res);
    setRunning(false);
    if (res.success !== false) {
      setHistory(h => {
        const next = [sql.trim(), ...h.filter(x => x !== sql.trim())].slice(0, MAX_HISTORY);
        return next;
      });
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery(false);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      const start = ta.selectionStart, end = ta.selectionEnd;
      setSql(s => s.substring(0, start) + '  ' + s.substring(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
    if (e.key === 'Escape') setShowHistory(false);
  };

  const toggleFloat = (colName) => {
    const idx = parseInt(colName.replace('field_', ''), 10);
    if (isNaN(idx)) return;
    setFloatCols(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const schema = selected ? (KNOWN_SCHEMAS[selected.name] || null) : null;

  const colLabel = (colName) => {
    if (!schema) return colName;
    const idx = parseInt(colName.replace('field_', ''), 10);
    return isNaN(idx) ? colName : (schema[idx] || colName);
  };

  const cellValue = (colName, rawVal) => {
    if (rawVal == null) return null;
    const idx = parseInt(colName.replace('field_', ''), 10);
    if (!isNaN(idx) && floatCols.has(idx)) return toFloat(rawVal);
    return rawVal;
  };

  const isWrite   = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql.trim());
  const hasResults = result?.success && result.columns.length > 0;
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  return (
    <div className="dbc-sql-page fade-in">
      {/* ── Left: file list ── */}
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
              {f.records != null && <span className="dbc-file-meta">{f.records}r·{f.fields}f</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Right: editor + results ── */}
      <div className="dbc-sql-main" ref={mainRef}>
        {/* Editor panel */}
        <div className="dbc-editor-panel" style={{ height: `${editorPct}%` }}>
          <div className="dbc-editor-header">
            {selected
              ? <>
                  <ChevronRight size={12} />
                  <span className="dbc-file-breadcrumb">{selected.name}</span>
                  <span className="dbc-meta-chip">{selected.records} records · {selected.fields} fields</span>
                  {schema && <span className="dbc-schema-chip">schema ✓</span>}
                </>
              : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Select a DBC file to query</span>
            }
            <div className="dbc-editor-actions">
              {/* Limit */}
              <select
                className="dbc-limit-select"
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                title="Row limit for auto-generated queries"
              >
                {LIMIT_OPTIONS.map(l => <option key={l} value={l}>LIMIT {l}</option>)}
              </select>

              {/* History */}
              {history.length > 0 && (
                <div className="dbc-history-wrap">
                  <button className="icon-btn" title="Query history" onClick={() => setShowHistory(v => !v)}>
                    <History size={13} />
                  </button>
                  {showHistory && (
                    <div className="dbc-history-dropdown">
                      <div className="dbc-history-header">
                        <span>History</span>
                        <button className="icon-btn" onClick={() => setShowHistory(false)}><X size={11} /></button>
                      </div>
                      {history.map((h, i) => (
                        <button key={i} className="dbc-history-item" onClick={() => { setSql(h); setShowHistory(false); }}>
                          {h.length > 60 ? h.slice(0, 60) + '…' : h}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

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

        {/* Resizer */}
        <div
          className="dbc-h-resizer"
          onMouseDown={(e) => {
            splitDragging.current = true;
            splitStartY.current = e.clientY;
            splitStartPct.current = editorPct;
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {/* Results panel */}
        <div className="dbc-results-panel">
          {!result && !running && (
            <div className="dbc-results-empty">
              {selected ? 'Run a query to see results' : 'Select a DBC file from the left panel'}
            </div>
          )}
          {running && <div className="dbc-results-empty">Running…</div>}
          {result && !result.success && (
            <div className="dbc-results-error">{result.error}</div>
          )}
          {result?.success && !hasResults && (
            <div className="dbc-results-info">
              {result.changes} row(s) affected{result.written ? ' · Written to DBC file ✓' : ''}
            </div>
          )}
          {hasResults && (
            <>
              <div className="dbc-results-bar">
                <span>{result.rows.length} row{result.rows.length !== 1 ? 's' : ''}</span>
                {schema && <span className="dbc-bar-schema">schema: {selected.name}</span>}
                {floatCols.size > 0 && (
                  <span className="dbc-bar-float">{floatCols.size} float col{floatCols.size !== 1 ? 's' : ''}</span>
                )}
                <button
                  className="icon-btn dbc-export-btn"
                  title="Export to CSV"
                  onClick={() => exportCsv(result.columns, result.rows)}
                >
                  <Download size={12} />
                </button>
              </div>
              <div className="dbc-results-scroll">
                <table className="dbc-results-table">
                  <thead>
                    <tr>
                      {result.columns.map(c => (
                        <th key={c} onClick={() => toggleFloat(c)} title={`${colLabel(c)} (click to toggle float)`}>
                          {colLabel(c)}
                          {floatCols.has(parseInt(c.replace('field_', ''), 10)) && <span className="float-indicator"> f</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map(c => {
                          const v = cellValue(c, row[c]);
                          return <td key={c}>{v == null ? <span className="cell-null">NULL</span> : String(v)}</td>;
                        })}
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
