import { useState, useEffect } from 'react';
import { Navigation } from 'lucide-react';
import { getCachedM2Asset, getM2AssetState, subscribeM2Cache } from './m2Loader';

const RAD2DEG = 180 / Math.PI;

function fmt(v, decimals = 3) {
  return typeof v === 'number' ? v.toFixed(decimals) : '—';
}

function threeToWow(tx, ty, tz) {
  return { x: -tz, y: tx, z: ty };
}

function Vec3Row({ label, x, y, z, decimals = 3 }) {
  return (
    <div className="ed3-inspector-vec3">
      <span className="ed3-inspector-vec3-label">{label}</span>
      <div className="ed3-inspector-vec3-vals">
        <span className="ed3-axis x">X</span><span>{fmt(x, decimals)}</span>
        <span className="ed3-axis y">Y</span><span>{fmt(y, decimals)}</span>
        <span className="ed3-axis z">Z</span><span>{fmt(z, decimals)}</span>
      </div>
    </div>
  );
}

function baseName(p) {
  if (!p) return null;
  return p.split(/[\\/]/).pop();
}

export default function Editor3DInspector({ spawn, transform, dirty, onSave, saving, mapId, onTeleport }) {
  const [teleporting, setTeleporting] = useState(false);
  const [teleportMsg, setTeleportMsg] = useState(null);
  const [m2Asset,  setM2Asset]  = useState(null);
  const [m2State,  setM2State]  = useState('none');

  useEffect(() => {
    const id = spawn?.type === 'creature' ? spawn.displayId : null;
    if (!id) { setM2Asset(null); setM2State('none'); return; }
    setM2Asset(getCachedM2Asset(id));
    setM2State(getM2AssetState(id));
    return subscribeM2Cache(() => {
      setM2Asset(getCachedM2Asset(id));
      setM2State(getM2AssetState(id));
    });
  }, [spawn?.displayId, spawn?.type]);

  async function handleTeleport() {
    if (!spawn || !onTeleport) return;
    setTeleporting(true);
    setTeleportMsg(null);

    const target = transform?.pos
      ? threeToWow(transform.pos.x, transform.pos.y, transform.pos.z)
      : { x: spawn.x, y: spawn.y, z: spawn.z };
    const cmd = `.go xyz ${target.x} ${target.y} ${target.z} ${mapId ?? 0}`;
    console.log('[3D Teleport] spawn:', {
      guid: spawn.guid,
      entry: spawn.entry ?? spawn.id,
      type: spawn.type,
      name: spawn.name,
      mapId,
      original: { x: spawn.x, y: spawn.y, z: spawn.z },
      target,
      command: cmd,
      usingLiveTransform: Boolean(transform?.pos),
    });
    try {
      const res = await onTeleport(cmd);
      setTeleportMsg(res.success ? 'Geteleporteerd ✓' : `Fout: ${res.error ?? res.result}`);
    } catch (e) {
      setTeleportMsg(`Fout: ${e.message}`);
    } finally {
      setTeleporting(false);
      setTimeout(() => setTeleportMsg(null), 3000);
    }
  }

  if (!spawn) {
    return (
      <div className="ed3-inspector">
        <div className="ed3-panel-header">Inspector</div>
        <div className="ed3-inspector-empty">Niets geselecteerd</div>
      </div>
    );
  }

  const pos = transform?.pos ?? null;
  const rot = transform?.rot ?? null;

  return (
    <div className="ed3-inspector">
      <div className="ed3-panel-header">Inspector</div>

      {/* Spawn info */}
      <section className="ed3-inspector-section">
        <div className="ed3-inspector-title">
          {spawn.name ?? `Entry ${spawn.entry}`}
        </div>
        <div className="ed3-inspector-row">
          <span>GUID</span><span>{spawn.guid}</span>
        </div>
        <div className="ed3-inspector-row">
          <span>Entry</span><span>{spawn.entry ?? spawn.id}</span>
        </div>
        <div className="ed3-inspector-row">
          <span>Type</span><span>{spawn.type ?? 'creature'}</span>
        </div>
        {spawn.faction != null && (
          <div className="ed3-inspector-row">
            <span>Faction</span><span>{spawn.faction}</span>
          </div>
        )}
      </section>

      {/* WoW originele waarden */}
      <section className="ed3-inspector-section">
        <div className="ed3-inspector-label">Origineel (WoW DB)</div>
        <Vec3Row label="Pos" x={spawn.x} y={spawn.y} z={spawn.z} />
        {spawn.orientation != null && (
          <div className="ed3-inspector-row">
            <span>Ori</span><span>{fmt(spawn.orientation)} rad</span>
          </div>
        )}
      </section>

      {/* Live 3D positie */}
      {pos && (
        <section className="ed3-inspector-section">
          <div className="ed3-inspector-label">Positie (scene)</div>
          <Vec3Row label="Pos" x={pos.x} y={pos.y} z={pos.z} />
        </section>
      )}

      {/* Live 3D rotatie */}
      {rot && (
        <section className="ed3-inspector-section">
          <div className="ed3-inspector-label">Rotatie (graden)</div>
          <Vec3Row
            label="Rot"
            x={rot.x * RAD2DEG}
            y={rot.y * RAD2DEG}
            z={rot.z * RAD2DEG}
            decimals={1}
          />
        </section>
      )}

      {/* M2 debug */}
      {spawn.type === 'creature' && (
        <section className="ed3-inspector-section">
          <div className="ed3-inspector-label">Model debug</div>
          <div className="ed3-inspector-row">
            <span>displayId</span><span>{spawn.displayId ?? '—'}</span>
          </div>
          {m2Asset ? (
            <>
              <div className="ed3-inspector-row" title={m2Asset.modelPath ?? ''}>
                <span>model</span>
                <span className="ed3-inspector-val">{baseName(m2Asset.modelPath) ?? '—'}</span>
              </div>
              <div className="ed3-inspector-row" title={m2Asset.texturePath ?? ''}>
                <span>texture</span>
                <span className="ed3-inspector-val">
                  {m2Asset.texturePath ? baseName(m2Asset.texturePath) : m2Asset.texture ? '(gecached)' : '—'}
                </span>
              </div>
              {m2Asset.texture && (
                <div className="ed3-inspector-row">
                  <span>res</span>
                  <span>{m2Asset.texture.image?.width ?? '?'}×{m2Asset.texture.image?.height ?? '?'}</span>
                </div>
              )}
            </>
          ) : spawn.displayId ? (
            <div className="ed3-inspector-row">
              <span>model</span>
              <span style={{ color: m2State === 'failed' ? '#e74c3c' : undefined }}>
                {m2State === 'failed' ? 'niet gevonden' : 'laden…'}
              </span>
            </div>
          ) : null}
        </section>
      )}

      {/* Teleport */}
      <section className="ed3-inspector-section">
        <button
          className="ed3-inspector-teleport-btn"
          onClick={handleTeleport}
          disabled={teleporting}
        >
          <Navigation size={12} />
          {teleporting ? 'Teleporteren…' : 'Teleport naar spawn'}
        </button>
        {teleportMsg && (
          <div className="ed3-inspector-teleport-msg">{teleportMsg}</div>
        )}
      </section>

      {/* Save knop */}
      {dirty && (
        <section className="ed3-inspector-section">
          <button
            className="ed3-inspector-save-btn"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Opslaan…' : '💾 Wijzigingen opslaan'}
          </button>
        </section>
      )}
    </div>
  );
}
