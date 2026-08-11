import { useEffect, useState } from 'react';

const RAD2DEG = 180 / Math.PI;

function fmt(v, decimals = 3) {
  return typeof v === 'number' ? v.toFixed(decimals) : '—';
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
      {saveMessage && <div className="ed3-inline-message">{saveMessage}</div>}
      {saveError && <div className="ed3-inline-error">{saveError}</div>}
    </section>
  );
}

export default function Editor3DInspector({ worldObject, worldTransform, onWorldTransform, onWorldUndo, onWorldRedo, canWorldUndo, canWorldRedo, onWorldSave, worldSaving, worldSaveMessage, worldSaveError, worldDirty }) {
  if (!worldObject) {
    return (
      <div className="ed3-inspector">
        <div className="ed3-panel-header">Inspector</div>
        <div className="ed3-inspector-empty">Niets geselecteerd</div>
      </div>
    );
  }

  return (
    <div className="ed3-inspector">
      <div className="ed3-panel-header">Inspector</div>
      <section className="ed3-inspector-section">
        <div className="ed3-inspector-title">{baseName(worldObject.modelPath) ?? 'World object'}</div>
        <div className="ed3-inspector-row"><span>Type</span><span>{worldTypeLabel(worldObject.type)}</span></div>
        <div className="ed3-inspector-row" title={worldObject.modelPath}><span>Model</span><span className="ed3-inspector-val">{worldObject.modelPath}</span></div>
        {worldObject.parentWmoPath && <div className="ed3-inspector-row" title={worldObject.parentWmoPath}><span>Parent WMO</span><span className="ed3-inspector-val">{baseName(worldObject.parentWmoPath)}</span></div>}
        <div className="ed3-inspector-row"><span>Tile</span><span>{worldObject.tileKey ?? '?'}</span></div>
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
