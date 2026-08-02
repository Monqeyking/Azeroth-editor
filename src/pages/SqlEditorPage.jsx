import { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import './EditorPage.css';
import './SqlEditorPage.css';

export default function SqlEditorPage() {
  const [sql, setSql] = useState('');
  const [results, setResults] = useState(null);
  const [columns, setColumns] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rowCount, setRowCount] = useState(null);

  async function execute() {
    const query = sql.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setColumns([]);
    setRowCount(null);
    try {
      const rows = await window.api.query(query, []);
      if (Array.isArray(rows) && rows.length > 0) {
        setColumns(Object.keys(rows[0]));
        setResults(rows);
        setRowCount(rows.length);
      } else if (Array.isArray(rows)) {
        setResults([]);
        setRowCount(0);
      } else {
        setRowCount(rows.affectedRows ?? null);
        setResults([]);
      }
    } catch (e) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      execute();
    }
  }

  return (
    <div className="editor-page sql-editor-page">
      <div className="editor-header">
        <h1>SQL Editor</h1>
      </div>

      <div className="sql-editor-body">
        <div className="sql-textarea-wrap">
          <textarea
            className="sql-textarea"
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM creature_template WHERE entry = 1;"
            spellCheck={false}
          />
          <div className="sql-toolbar">
            <button
              className="btn-primary"
              onClick={execute}
              disabled={loading || !sql.trim()}
            >
              <Play size={14} />
              {loading ? 'Running…' : 'Run'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => { setSql(''); setResults(null); setError(null); setRowCount(null); }}
              disabled={loading}
            >
              <Trash2 size={14} />
              Clear
            </button>
            <span className="sql-hint">Ctrl+Enter to run</span>
          </div>
        </div>

        {error && (
          <div className="sql-error">
            <strong>Error:</strong> {error}
          </div>
        )}

        {!error && rowCount !== null && results !== null && (
          <div className="sql-results">
            <div className="sql-results-header">
              {results.length > 0
                ? `${rowCount} row${rowCount !== 1 ? 's' : ''} found`
                : rowCount === 0 && columns.length === 0
                  ? `Query executed${rowCount !== null ? ` — ${rowCount} row${rowCount !== 1 ? 's' : ''} affected` : ''}`
                  : '0 results'}
            </div>
            {results.length > 0 && (
              <div className="sql-table-wrap">
                <table className="sql-table">
                  <thead>
                    <tr>
                      {columns.map(col => <th key={col}>{col}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr key={i}>
                        {columns.map(col => (
                          <td key={col}>{row[col] === null ? <span className="sql-null">NULL</span> : String(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
