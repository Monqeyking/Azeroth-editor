import { useState, useRef, useEffect, useCallback } from 'react';
import { User, Box, Search, X, Database, Loader } from 'lucide-react';

export default function Editor3DHierarchy({ spawns, selectedId, onSelect, onAddSpawn, mapId }) {
  const [query,      setQuery]      = useState('');
  const [dbResults,  setDbResults]  = useState(null);   // null = niet gezocht
  const [dbLoading,  setDbLoading]  = useState(false);
  const [dbError,    setDbError]    = useState(null);
  const selectedRef = useRef(null);

  const q = query.trim().toLowerCase();
  const sceneFiltered = q
    ? spawns.filter(s =>
        (s.name ?? '').toLowerCase().includes(q) ||
        String(s.entry ?? '').includes(q) ||
        String(s.guid ?? '').includes(q)
      )
    : spawns;

  // Reset DB-resultaten als de query verandert
  useEffect(() => {
    setDbResults(null);
    setDbError(null);
  }, [query]);

  // Scroll geselecteerd item in beeld
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const handleDbSearch = useCallback(async () => {
    if (!q) return;
    setDbLoading(true);
    setDbError(null);
    setDbResults(null);
    try {
      const res = await window.azeroth.spawns.search({ query: q, mapId, limit: 50 });
      if (!res.success) { setDbError(res.error); return; }
      setDbResults(res.data);
    } catch (e) {
      setDbError(e.message);
    } finally {
      setDbLoading(false);
    }
  }, [q, mapId]);

  const handleDbSelect = useCallback((spawn) => {
    onAddSpawn?.(spawn);
    onSelect(spawn.guid);
  }, [onAddSpawn, onSelect]);

  // Spawns uit DB-resultaten die al in scene zitten tonen als scene-items
  const dbOnlyResults = dbResults
    ? dbResults.filter(r => !spawns.some(s => s.guid === r.guid))
    : [];

  return (
    <div className="ed3-hierarchy">
      <div className="ed3-panel-header">Scene ({spawns.length})</div>

      <div className="ed3-hierarchy-search">
        <Search size={11} className="ed3-hierarchy-search-icon" />
        <input
          className="ed3-hierarchy-search-input"
          placeholder="Zoek naam, entry, guid…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleDbSearch()}
        />
        {query && (
          <button className="ed3-hierarchy-search-clear" onClick={() => setQuery('')}>
            <X size={11} />
          </button>
        )}
      </div>

      <div className="ed3-hierarchy-list">
        {/* Scene-resultaten */}
        {sceneFiltered.map(spawn => (
          <div
            key={spawn.guid}
            ref={spawn.guid === selectedId ? selectedRef : null}
            className={`ed3-hierarchy-item ${spawn.guid === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(spawn.guid === selectedId ? null : spawn.guid)}
          >
            {spawn.type === 'gameobject' ? <Box size={12} /> : <User size={12} />}
            <span className="ed3-hi-name">{spawn.name ?? `#${spawn.entry}`}</span>
            <span className="ed3-hi-guid">{spawn.guid}</span>
          </div>
        ))}

        {/* DB-zoekknop — tonen als query actief is */}
        {q && !dbLoading && dbResults === null && (
          <button className="ed3-hierarchy-db-btn" onClick={handleDbSearch}>
            <Database size={11} />
            Zoek "{query}" in database
          </button>
        )}

        {dbLoading && (
          <div className="ed3-hierarchy-db-loading">
            <Loader size={11} className="ed3-loading-spin" /> Zoeken…
          </div>
        )}

        {dbError && (
          <div className="ed3-hierarchy-db-error">Fout: {dbError}</div>
        )}

        {/* DB-resultaten die nog niet in de scene zitten */}
        {dbOnlyResults.length > 0 && (
          <>
            <div className="ed3-hierarchy-db-header">
              Database ({dbOnlyResults.length})
            </div>
            {dbOnlyResults.map(spawn => (
              <div
                key={spawn.guid}
                className="ed3-hierarchy-item ed3-hierarchy-item-db"
                onClick={() => handleDbSelect(spawn)}
              >
                {spawn.type === 'gameobject' ? <Box size={12} /> : <User size={12} />}
                <span className="ed3-hi-name">{spawn.name ?? `#${spawn.entry}`}</span>
                <span className="ed3-hi-guid">{spawn.guid}</span>
              </div>
            ))}
          </>
        )}

        {dbResults !== null && dbOnlyResults.length === 0 && sceneFiltered.length === 0 && (
          <div className="ed3-hierarchy-empty">Geen resultaten gevonden</div>
        )}

        {!q && spawns.length === 0 && (
          <div className="ed3-hierarchy-empty">Geen spawns geladen</div>
        )}
      </div>
    </div>
  );
}
