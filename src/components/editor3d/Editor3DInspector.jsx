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

function worldTypeLabel(type) {
  if (type === 'wmo-doodad-m2') return 'WMO doodad M2';
  if (type === 'adt-m2') return 'ADT M2 doodad';
  return 'WMO';
}

function WorldTransformEditor({ object, transform, onChange, onUndo, onRedo, canUndo, canRedo, onSave, saving, saveMessage, saveError, dirty }) {
  const initial = transform ?? {
    position: object.scenePosition ?? [0, 0, 0],
    rotation: object.sceneRotation ?? [0, 0, 0],
    scale: object.sceneScale ?? object.scale ?? 1,
  };
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    setDraft(transform ?? {
      position: object.scenePosition ?? [0, 0, 0],
      rotation: object.sceneRotation ?? [0, 0, 0],
      scale: object.sceneScale ?? object.scale ?? 1,
    });
  }, [object, transform]);

  const update = (group, index, value) => {
    const next = {
      ...draft,
      [group]: draft[group].map((entry, entryIndex) => entryIndex === index ? Number(value) : entry),
    };
    setDraft(next);
    onChange?.(next);
  };

  const updateScale = (value) => {
    const next = { ...draft, scale: Math.max(0.01, Number(value) || 0.01) };
    setDraft(next);
    onChange?.(next);
  };

  const vectorInput = (group, label, degrees = false) => (
    <div className="ed3-world-transform-row">
      <span>{label}</span>
      <div className="ed3-world-transform-fields">
        {draft[group].map((value, index) => (
          <label key={`${group}-${index}`}>
            <span className={`ed3-axis ${'xyz'[index]}`}>{'XYZ'[index]}</span>
            <input
              type="number"
              step={degrees ? '1' : '0.1'}
              value={degrees ? (value * RAD2DEG).toFixed(1) : Number(value).toFixed(3)}
              onChange={event => update(group, index, degrees ? Number(event.target.value) / RAD2DEG : event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <section className="ed3-inspector-section">
      <div className="ed3-inspector-label">Scene transform (draft)</div>
      {vectorInput('position', 'Pos')}
      {vectorInput('rotation', 'Rot °', true)}
      <div className="ed3-world-transform-row">
        <span>Scale</span>
        <input
          className="ed3-world-scale-input"
          type="number"
          min="0.01"
          step="0.05"
          value={Number(draft.scale).toFixed(3)}
          onChange={event => updateScale(event.target.value)}
        />
      </div>
        <div className="ed3-inspector-hint">Draft changes are staged to Output/World with a .bak backup; source client files stay untouched.</div>
      <div className="ed3-world-actions">
        <button type="button" onClick={onUndo} disabled={!canUndo}>Undo</button>
        <button type="button" onClick={onRedo} disabled={!canRedo}>Redo</button>
      </div>
      {dirty && (
        <button className="ed3-inspector-save-btn" type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Staging…' : 'Save world changes'}
        </button>
      )}
      {saveMessage && <div className="ed3-inspector-teleport-msg">{saveMessage}</div>}
      {saveError && <div className="ed3-hierarchy-db-error">{saveError}</div>}
    </section>
  );
}

export default function Editor3DInspector({ spawn, transform, dirty, onSave, saving, mapId, onTeleport, worldObject, worldTransform, onWorldTransform, onWorldUndo, onWorldRedo, canWorldUndo, canWorldRedo, onWorldSave, worldSaving, worldSaveMessage, worldSaveError, worldDirty }) {
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
      setTeleportMsg(res.success ? 'Teleported ✓' : `Error: ${res.error ?? res.result}`);
    } catch (e) {
      setTeleportMsg(`Error: ${e.message}`);
    } finally {
      setTeleporting(false);
      setTimeout(() => setTeleportMsg(null), 3000);
    }
  }

  if (!spawn) {
    if (worldObject) {
      return (
        <div className="ed3-inspector">
          <div className="ed3-panel-header">Inspector</div>
          <section className="ed3-inspector-section">
            <div className="ed3-inspector-title">{baseName(worldObject.modelPath) ?? 'World object'}</div>
            <div className="ed3-inspector-row"><span>Type</span><span>{worldTypeLabel(worldObject.type)}</span></div>
            <div className="ed3-inspector-row" title={worldObject.modelPath}><span>Model</span><span className="ed3-inspector-val">{worldObject.modelPath}</span></div>
            {worldObject.parentWmoPath && <div className="ed3-inspector-row" title={worldObject.parentWmoPath}><span>Parent WMO</span><span className="ed3-inspector-val">{baseName(worldObject.parentWmoPath)}</span></div>}
            <div className="ed3-inspector-row"><span>Tile</span><span>{worldObject.tileKey ?? '—'}</span></div>
            {worldObject.uniqueId != null && <div className="ed3-inspector-row"><span>Unique ID</span><span>{worldObject.uniqueId}</span></div>}
          </section>
          <section className="ed3-inspector-section">
            <div className="ed3-inspector-label">Source placement</div>
            <Vec3Row label="Pos" x={worldObject.placementPosition?.[0]} y={worldObject.placementPosition?.[1]} z={worldObject.placementPosition?.[2]} />
            <Vec3Row label="Rot" x={worldObject.placementRotation?.[0]} y={worldObject.placementRotation?.[1]} z={worldObject.placementRotation?.[2]} decimals={3} />
            <div className="ed3-inspector-row"><span>Scale</span><span>{fmt(worldObject.scale)}</span></div>
          </section>
          <WorldTransformEditor
            object={worldObject}
            transform={worldTransform}
            onChange={next => onWorldTransform?.(worldObject.key, next)}
            onUndo={onWorldUndo}
            onRedo={onWorldRedo}
            canUndo={canWorldUndo}
            canRedo={canWorldRedo}
            onSave={onWorldSave}
            saving={worldSaving}
            saveMessage={worldSaveMessage}
            saveError={worldSaveError}
            dirty={worldDirty}
          />
        </div>
      );
    }
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
                {m2State === 'failed' ? 'not found' : 'loading…'}
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
          {teleporting ? 'Teleporting…' : 'Teleport to spawn'}
        </button>
        {teleportMsg && (
          <div className="ed3-inspector-teleport-msg">{teleportMsg}</div>
        )}
      </section>

      {/* Save */}
      {dirty && (
        <section className="ed3-inspector-section">
          <button
            className="ed3-inspector-save-btn"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : '💾 Save changes'}
          </button>
        </section>
      )}
    </div>
  );
}
