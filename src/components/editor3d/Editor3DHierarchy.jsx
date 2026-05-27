import { User, Box } from 'lucide-react';

export default function Editor3DHierarchy({ spawns, selectedId, onSelect }) {
  return (
    <div className="ed3-hierarchy">
      <div className="ed3-panel-header">Scene ({spawns.length})</div>
      <div className="ed3-hierarchy-list">
        {spawns.map(spawn => (
          <div
            key={spawn.guid}
            className={`ed3-hierarchy-item ${spawn.guid === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(spawn.guid === selectedId ? null : spawn.guid)}
          >
            {spawn.type === 'gameobject'
              ? <Box size={12} />
              : <User size={12} />
            }
            <span className="ed3-hi-name">{spawn.name ?? `#${spawn.entry}`}</span>
            <span className="ed3-hi-guid">{spawn.guid}</span>
          </div>
        ))}
        {spawns.length === 0 && (
          <div className="ed3-hierarchy-empty">Geen spawns geladen</div>
        )}
      </div>
    </div>
  );
}
