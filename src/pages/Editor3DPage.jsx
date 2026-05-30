import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import Editor3DErrorBoundary from '../components/editor3d/Editor3DErrorBoundary';
import Editor3DScene from '../components/editor3d/Editor3DScene';
import Editor3DToolbar from '../components/editor3d/Editor3DToolbar';
import Editor3DHierarchy from '../components/editor3d/Editor3DHierarchy';
import Editor3DInspector from '../components/editor3d/Editor3DInspector';
import MinimapOverlay from '../components/editor3d/MinimapOverlay';
import './Editor3DPage.css';
import { cameraInput } from '../components/editor3d/cameraInputState';
import { wowToThree, threeToWow } from '../components/editor3d/wowCoords';

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
function spawnThreePosition(spawn, transform) {
  if (transform?.pos) return [transform.pos.x, transform.pos.y, transform.pos.z];
  return wowToThree(spawn.x, spawn.y, spawn.z);
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
  const [focusTick,  setFocusTick]  = useState(0);
  const camPosRef = useRef({ wx: 0, wy: 0 });

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
          // Centroïd-tile berekenen en 4×4 blok eromheen laden
          let sumX = 0, sumY = 0, count = 0;
          res.data.forEach(s => {
            const { tileX, tileY } = worldToTile(s.x, s.y);
            if (tileX >= 0 && tileX < 64 && tileY >= 0 && tileY < 64) {
              sumX += tileX; sumY += tileY; count++;
            }
          });
          const tiles = [];
          if (count > 0) {
            const cX = Math.round(sumX / count);
            const cY = Math.round(sumY / count);
            for (let dy = -2; dy <= 3; dy++) {
              for (let dx = -2; dx <= 3; dx++) {
                const tx = cX + dx, ty = cY + dy;
                if (tx >= 0 && tx < 64 && ty >= 0 && ty < 64)
                  tiles.push({ tileX: tx, tileY: ty });
              }
            }
          }
          const tr = await window.azeroth.adt.getTerrain({ mapName, tiles });
          if (!cancelled && tr.success) {
            setTerrain(tr.data);

            // ── DEBUG HEIGHT OFFSET ──────────────────────────────────────────
            // Bouw een snel lookup: per geladen tile een lijst van chunks geïndexeerd op (ix,iy)
            const CHUNK_SIZE = TILE_SIZE / 16;          // 33.333 yards per chunk
            const UNIT       = CHUNK_SIZE / 8;          // 4.1666 yards per outer vertex step
            const MAP_HALF_L = 32 * TILE_SIZE;

            function terrainHeightAt(terrainData, wowX, wowY) {
              const tileX = Math.floor((MAP_HALF_L - wowX) / TILE_SIZE);
              const tileY = Math.floor((MAP_HALF_L - wowY) / TILE_SIZE);
              const tile  = terrainData.find(t => t.tileX === tileX && t.tileY === tileY);
              if (!tile) return null;
              // Positie binnen tile (0..TILE_SIZE)
              const lx = (MAP_HALF_L - wowX) - tileX * TILE_SIZE; // richting ix
              const ly = (MAP_HALF_L - wowY) - tileY * TILE_SIZE; // richting iy
              const ix = Math.min(15, Math.floor(lx / CHUNK_SIZE));
              const iy = Math.min(15, Math.floor(ly / CHUNK_SIZE));
              const chunk = tile.chunks?.find(c => c?.ix === ix && c?.iy === iy);
              if (!chunk) return null;
              // Vertex binnen chunk
              const cx = (lx - ix * CHUNK_SIZE) / UNIT;
              const cy = (ly - iy * CHUNK_SIZE) / UNIT;
              const r  = Math.min(8, Math.round(cy));
              const c  = Math.min(8, Math.round(cx));
              return {
                height: chunk.posZ + chunk.outer[r * 9 + c],
                tileX, tileY, ix, iy, r, c,
                posZ: chunk.posZ,
                outerVal: chunk.outer[r * 9 + c],
              };
            }

            // Scan ALLE spawns in geladen tiles, bereken terrain-spawn verschil
            const loadedTileSet = new Set(tr.data.map(t => `${t.tileX}_${t.tileY}`));
            const results = [];
            for (const s of res.data) {
              if (s.z == null) continue;
              const { tileX, tileY } = worldToTile(s.x, s.y);
              if (!loadedTileSet.has(`${tileX}_${tileY}`)) continue;
              const info = terrainHeightAt(tr.data, s.x, s.y);
              if (!info) continue;
              results.push({ s, info, diff: info.height - s.z });
            }

            console.log(`[SPAWN DEBUG] ${results.length} spawns in geladen tiles gevonden`);

            // Top 5 spawns ONDER terrein (diff > 0 = spawn ligt onder maaiveld)
            const buried = results.filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
            // Top 5 spawns BOVEN terrein (diff < 0)
            const floating = results.filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

            // Sluit garbage-waarden uit (>1 miljoen) voor de sortering
            const validResults = results.filter(r => Math.abs(r.diff) < 1e6);

            if (buried.length) {
              console.log('[SPAWN DEBUG] === BEGRAVEN spawns (terrein > spawn.z) ===');
              buried.forEach(({ s, info, diff }) => {
                const tile = tr.data.find(t => t.tileX === info.tileX && t.tileY === info.tileY);
                const chunk = tile?.chunks?.find(c => c?.ix === info.ix && c?.iy === info.iy);
                console.log(
                  ` guid=${s.guid} name=${s.name ?? '?'}`,
                  `| spawn WoW(x=${s.x?.toFixed(1)} y=${s.y?.toFixed(1)} z=${s.z.toFixed(2)})`,
                  `| tile ${info.tileX}_${info.tileY} chunk ix=${info.ix} iy=${info.iy} r=${info.r} c=${info.c}`,
                  `| chunk posX=${chunk?.posX?.toFixed(2)} posY=${chunk?.posY?.toFixed(2)} posZ=${info.posZ?.toFixed(2)}`,
                  `| terrain=${info.height.toFixed(2)} VERSCHIL=+${diff.toFixed(2)}`
                );
              });
            }
            if (floating.length) {
              console.log('[SPAWN DEBUG] === ZWEVENDE spawns (spawn.z > terrein) ===');
              floating.forEach(({ s, info, diff }) => {
                const tile = tr.data.find(t => t.tileX === info.tileX && t.tileY === info.tileY);
                const chunk = tile?.chunks?.find(c => c?.ix === info.ix && c?.iy === info.iy);
                console.log(
                  ` guid=${s.guid} name=${s.name ?? '?'}`,
                  `| spawn WoW(x=${s.x?.toFixed(1)} y=${s.y?.toFixed(1)} z=${s.z.toFixed(2)})`,
                  `| tile ${info.tileX}_${info.tileY} chunk ix=${info.ix} iy=${info.iy} r=${info.r} c=${info.c}`,
                  `| chunk posX=${chunk?.posX?.toFixed(2)} posY=${chunk?.posY?.toFixed(2)} posZ=${info.posZ?.toFixed(2)}`,
                  `| terrain=${info.height.toFixed(2)} VERSCHIL=${diff.toFixed(2)}`
                );
              });
            }

            if (validResults.length) {
              const avg = validResults.reduce((acc, r) => acc + r.diff, 0) / validResults.length;

              // Mediaan (gesorteerd)
              const sorted = [...validResults].sort((a, b) => a.diff - b.diff);
              const mid    = Math.floor(sorted.length / 2);
              const median = sorted.length % 2 === 0
                ? (sorted[mid - 1].diff + sorted[mid].diff) / 2
                : sorted[mid].diff;

              // Gefilterd gemiddelde: alleen spawns waarbij |diff| < 50 (platte terreinen)
              const flat    = validResults.filter(r => Math.abs(r.diff) < 50);
              const flatAvg = flat.length
                ? flat.reduce((acc, r) => acc + r.diff, 0) / flat.length
                : null;

              console.log(`[SPAWN DEBUG] ${validResults.length} geldig | gemiddeld: ${avg.toFixed(2)} | mediaan: ${median.toFixed(2)} | vlak (<50): n=${flat.length} avg=${flatAvg?.toFixed(2) ?? 'n/a'} | begraven: ${validResults.filter(r=>r.diff>0).length} | zwevend: ${validResults.filter(r=>r.diff<0).length}`);

              // Histogram: spreiding van diff-waarden
              const bins = [-300,-100,-50,-20,-5,5,20,50,100,300];
              const counts = new Array(bins.length + 1).fill(0);
              validResults.forEach(({ diff }) => {
                let i = 0;
                while (i < bins.length && diff >= bins[i]) i++;
                counts[i]++;
              });
              const labels = [`<${bins[0]}`, ...bins.map((b, i) => i < bins.length-1 ? `${b}..${bins[i+1]}` : `>=${b}`), `>=${bins[bins.length-1]}`];
              console.log('[SPAWN DEBUG] histogram:', labels.map((l, i) => `${l}: ${counts[i]}`).join(' | '));
            }
            // ── END DEBUG ────────────────────────────────────────────────────
          }
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
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (cameraInput.flyActive && 'wasdeq'.includes(key)) return;
      if (key === 'q') setActiveTool('select');
      if (key === 'w') setActiveTool('move');
      if (key === 'e') setActiveTool('rotate');
      if (key === 'f' && selectedId) {
        e.preventDefault();
        setFocusTick(t => t + 1);
      }
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

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

  const focusTarget = useMemo(() => {
    if (!selectedSpawn) return null;
    return spawnThreePosition(selectedSpawn, transforms[selectedId]);
  }, [selectedSpawn, selectedId, transforms]);

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
              focusTarget={focusTarget}
              focusTick={focusTick}
              transforms={transforms}
              camPosRef={camPosRef}
            />
          </Editor3DErrorBoundary>
          <MinimapOverlay mapId={mapId} camPosRef={camPosRef} />
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
