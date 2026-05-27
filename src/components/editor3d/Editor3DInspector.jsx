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

export default function Editor3DInspector({ spawn, transform }) {
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
    </div>
  );
}
