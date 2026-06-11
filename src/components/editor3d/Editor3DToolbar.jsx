import { MousePointer2, Move, RotateCcw, Map, Loader, Eye, EyeOff } from 'lucide-react';

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Select (Q)' },
  { id: 'move',   icon: Move,          label: 'Move (W)'   },
  { id: 'rotate', icon: RotateCcw,     label: 'Rotate (E)' },
];

const MAPS = [
  { id: 0,   name: 'Eastern Kingdoms' },
  { id: 1,   name: 'Kalimdor'         },
  { id: 530, name: 'Outland'          },
  { id: 571, name: 'Northrend'        },
];

export default function Editor3DToolbar({ activeTool, onToolChange, mapId, onMapChange, loading, spawnCount, spawnsVisible, onToggleSpawns }) {
  return (
    <div className="ed3-toolbar">
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={`ed3-tool-btn ${activeTool === id ? 'active' : ''}`}
          onClick={() => onToolChange(id)}
          title={label}
        >
          <Icon size={15} />
          <span>{id.charAt(0).toUpperCase() + id.slice(1)}</span>
        </button>
      ))}

      <div className="ed3-toolbar-sep" />

      <Map size={13} style={{ color: '#555577', flexShrink: 0 }} />
      <select
        className="ed3-map-select"
        value={mapId}
        onChange={e => onMapChange(Number(e.target.value))}
        disabled={loading}
      >
        {MAPS.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      <button
        className={`ed3-tool-btn ${spawnsVisible ? 'active' : ''}`}
        onClick={onToggleSpawns}
        title="Spawns tonen/verbergen"
      >
        {spawnsVisible ? <Eye size={15} /> : <EyeOff size={15} />}
        <span>Spawns</span>
      </button>

      {loading
        ? <Loader size={13} className="ed3-loading-spin" />
        : spawnCount != null && <span className="ed3-spawn-count">{spawnCount} spawns</span>
      }

      <span
        className="ed3-camera-hint"
        title="Rechtermuis: roteren · Middel/Alt+links: pannen · Scroll: zoomen · Rechtermuis+WASD/QE: vliegen · F: focus op selectie"
      >
        RMB draaien · MMB/Alt+LMB pan · RMB+WASD vliegen · F focus
      </span>
    </div>
  );
}
