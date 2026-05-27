import { useState, useCallback, useEffect, useMemo } from 'react';
import Editor3DErrorBoundary from '../components/editor3d/Editor3DErrorBoundary';
import Editor3DScene from '../components/editor3d/Editor3DScene';
import Editor3DToolbar from '../components/editor3d/Editor3DToolbar';
import Editor3DHierarchy from '../components/editor3d/Editor3DHierarchy';
import Editor3DInspector from '../components/editor3d/Editor3DInspector';
import './Editor3DPage.css';

const TILE_SIZE = 533.33333;
const MAP_HALF  = 32 * TILE_SIZE;

const MAP_ADT_NAME = {
  0:   'Azeroth',
  1:   'Kalimdor',
  530: 'Expansion01',
  571: 'Northrend',
};

function worldToTile(x, y) {
  return {
    tileX: Math.floor((MAP_HALF - x) / TILE_SIZE),
    tileY: Math.floor((MAP_HALF - y) / TILE_SIZE),
  };
}

export default function Editor3DPage() {
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [spawns,     setSpawns]     = useState([]);
  const [transforms, setTransforms] = useState({});
  const [mapId,      setMapId]      = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [terrain,    setTerrain]    = useState(null);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSpawns([]);
      setTerrain(null);
      setSelectedId(null);
      setTransforms({});

      try {
        const res = await window.azeroth.spawns.load({ mapId, limit: 1000 });
        if (cancelled) return;
        if (!res.success) { setError(res.error ?? 'Kan spawns niet laden'); return; }
        setSpawns(res.data);

        const mapName = MAP_ADT_NAME[mapId];
        if (mapName && res.data.length > 0) {
          const tileMap = new Map();
          res.data.forEach(s => {
            const { tileX, tileY } = worldToTile(s.x, s.y);
            if (tileX >= 0 && tileX < 64 && tileY >= 0 && tileY < 64)
              tileMap.set(`${tileX}_${tileY}`, { tileX, tileY });
          });
          const tiles = [...tileMap.values()].slice(0, 16);
          const tr = await window.azeroth.adt.getTerrain({ mapName, tiles });
          if (!cancelled && tr.success) setTerrain(tr.data);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mapId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'q' || e.key === 'Q') setActiveTool('select');
      if (e.key === 'w' || e.key === 'W') setActiveTool('move');
      if (e.key === 'e' || e.key === 'E') setActiveTool('rotate');
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSelect    = useCallback((guid) => setSelectedId(guid), []);
  const handleTransform = useCallback((guid, pos, rot) => {
    setTransforms(prev => ({ ...prev, [guid]: { pos, rot } }));
  }, []);

  const selectedSpawn = useMemo(
    () => spawns.find(s => s.guid === selectedId) ?? null,
    [spawns, selectedId]
  );

  // Centroïd in Three.js ruimte (WoW → Three.js: x→Z, y→-X, z→Y)
  const spawnCenter = useMemo(() => {
    if (!spawns.length) return null;
    let sx = 0, sy = 0, sz = 0;
    for (const s of spawns) { sx += -s.y; sy += s.z; sz += s.x; }
    return [sx / spawns.length, sy / spawns.length, sz / spawns.length];
  }, [spawns]);

  return (
    <div className="ed3-root">
      <Editor3DToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        mapId={mapId}
        onMapChange={setMapId}
        loading={loading}
        spawnCount={loading ? null : spawns.length}
      />

      {error && <div className="ed3-error-bar">Fout: {error}</div>}

      <div className="ed3-workspace">
        <Editor3DHierarchy
          spawns={spawns}
          selectedId={selectedId}
          onSelect={handleSelect}
        />

        <div className="ed3-viewport">
          <Editor3DErrorBoundary>
            <Editor3DScene
              spawns={spawns}
              selectedId={selectedId}
              onSelect={handleSelect}
              activeTool={activeTool}
              onTransform={handleTransform}
              terrain={terrain}
              initialTarget={spawnCenter}
            />
          </Editor3DErrorBoundary>
        </div>

        <Editor3DInspector
          spawn={selectedSpawn}
          transform={selectedId ? transforms[selectedId] ?? null : null}
        />
      </div>
    </div>
  );
}
