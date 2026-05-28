import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
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

// Three.js → WoW coördinaten (inverse van wowToThree in Editor3DSpawn)
// wowToThree: [-y, z, x]  →  Three(x,y,z) = WoW(-y, z, x)
// inverse:    WoW(x,y,z)  = Three(z, y, -x) → wow_x=t.z, wow_y=-t.x, wow_z=t.y
function threeToWow(tx, ty, tz) {
  return { x: tz, y: -tx, z: ty };
}

export default function Editor3DPage() {
  const { query, soapCommand, soapConfig } = useConnection();
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [spawns,     setSpawns]     = useState([]);
  const [transforms, setTransforms] = useState({});
  const [dirtyGuids, setDirtyGuids] = useState(new Set());
  const [resetKeys,  setResetKeys]  = useState({});
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState(null);
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
  const handleAddSpawn  = useCallback((spawn) => {
    setSpawns(prev => prev.some(s => s.guid === spawn.guid) ? prev : [...prev, spawn]);
  }, []);
  const handleTransform = useCallback((guid, pos, rot) => {
    setTransforms(prev => ({ ...prev, [guid]: { pos, rot } }));
    setDirtyGuids(prev => { const s = new Set(prev); s.add(guid); return s; });
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirtyGuids.size) return;
    setSaving(true);
    setSaveError(null);
    const toSave = spawns.filter(s => dirtyGuids.has(s.guid));
    for (const spawn of toSave) {
      const t = transforms[spawn.guid];
      if (!t?.pos) continue;
      const wow = threeToWow(t.pos.x, t.pos.y, t.pos.z);
      // orientatie: Three.js Y-as rotatie = WoW orientation (rotatie om verticale as)
      const orientation = t.rot?.y ?? spawn.orientation ?? 0;
      const res = await window.azeroth.spawns.update({
        guid: spawn.guid,
        type: spawn.type ?? 'creature',
        x: wow.x, y: wow.y, z: wow.z,
        orientation,
      });
      if (!res.success) {
        setSaveError(`Fout bij ${spawn.guid}: ${res.error}`);
        setSaving(false);
        return;
      }
      // Originele DB-waarden bijwerken zodat undo correct werkt na save
      setSpawns(prev => prev.map(s =>
        s.guid === spawn.guid
          ? { ...s, x: wow.x, y: wow.y, z: wow.z, orientation }
          : s
      ));
    }
    setDirtyGuids(new Set());
    setSaving(false);
  }, [dirtyGuids, spawns, transforms]);

  const handleUndo = useCallback(() => {
    // Verwijder dirty transforms en force remount van de betrokken spawns
    setTransforms(prev => {
      const next = { ...prev };
      dirtyGuids.forEach(guid => delete next[guid]);
      return next;
    });
    setResetKeys(prev => {
      const next = { ...prev };
      dirtyGuids.forEach(guid => { next[guid] = (prev[guid] ?? 0) + 1; });
      return next;
    });
    setDirtyGuids(new Set());
    setSaveError(null);
  }, [dirtyGuids]);

  const handleTeleport = useCallback(async (command) => {
    const direct = await soapCommand(command);
    const isGoFault = !direct.success && String(direct.error ?? '').includes('.gobject');
    if (!isGoFault) return direct;

    const playerName = soapConfig.characterName?.trim();
    if (!playerName) {
      return {
        success: false,
        error: `${direct.error}\n\nSOAP .go werkt zonder speler-context niet. Vul Settings -> GM Character Name in voor teleport fallback.`,
      };
    }

    const match = String(command).match(/^\.?go\s+xyz\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+)/i);
    if (!match) return direct;

    const [, x, y, z, map] = match;
    const teleName = `azeroth_editor_${Date.now()}`;
    const orientation = 0;

    const idResult = await query('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM game_tele');
    if (!idResult.success) return { success: false, error: `Kon tijdelijke teleport ID niet bepalen: ${idResult.error}` };
    const teleId = idResult.data?.[0]?.id;
    if (!teleId) return { success: false, error: 'Kon tijdelijke teleport ID niet bepalen' };

    const del = await query('DELETE FROM game_tele WHERE name = ?', [teleName]);
    if (!del.success) return { success: false, error: `Kon tijdelijke teleport niet voorbereiden: ${del.error}` };

    const ins = await query(
      'INSERT INTO game_tele (id, position_x, position_y, position_z, orientation, map, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [teleId, Number(x), Number(y), Number(z), orientation, Number(map), teleName]
    );
    if (!ins.success) return { success: false, error: `Kon tijdelijke teleport niet opslaan: ${ins.error}` };

    await soapCommand('.reload game_tele');
    const escapedPlayer = playerName.replace(/"/g, '');
    let fallback = await soapCommand(`.tele name ${escapedPlayer} ${teleName}`);
    if (!fallback.success) {
      fallback = await soapCommand(`tele name ${escapedPlayer} ${teleName}`);
    }
    if (!fallback.success) {
      fallback = await soapCommand(`.teleport name ${escapedPlayer} ${teleName}`);
    }
    if (!fallback.success) {
      fallback = await soapCommand(`teleport name ${escapedPlayer} ${teleName}`);
    }

    await query('DELETE FROM game_tele WHERE id = ?', [teleId]);
    await soapCommand('.reload game_tele');

    return fallback.success ? { ...fallback, result: fallback.result || `Teleported ${escapedPlayer}` } : fallback;
  }, [query, soapCommand, soapConfig.characterName]);

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
          onAddSpawn={handleAddSpawn}
          mapId={mapId}
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
              resetKeys={resetKeys}
            />
          </Editor3DErrorBoundary>
        </div>

        <Editor3DInspector
          spawn={selectedSpawn}
          transform={selectedId ? transforms[selectedId] ?? null : null}
          dirty={selectedId ? dirtyGuids.has(selectedId) : false}
          onSave={handleSave}
          saving={saving}
          mapId={mapId}
          onTeleport={handleTeleport}
        />
      </div>

      {dirtyGuids.size > 0 && (
        <div className="ed3-save-bar">
          <span className="ed3-save-bar-msg">
            {dirtyGuids.size} spawn{dirtyGuids.size > 1 ? 's' : ''} niet opgeslagen
          </span>
          {saveError && <span className="ed3-save-bar-error">{saveError}</span>}
          <button className="ed3-save-bar-btn undo" onClick={handleUndo} disabled={saving}>
            Ongedaan maken
          </button>
          <button className="ed3-save-bar-btn save" onClick={handleSave} disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      )}
    </div>
  );
}
