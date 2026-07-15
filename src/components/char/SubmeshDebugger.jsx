import { useMemo, useState } from 'react';

const GROUP_NAMES = {
  '-1': 'Body',
  '1': 'Face',
  '2': 'Ears',
  '3': 'Facial Hair',
  '4': 'Arms',
  '5': 'Boots',
  '6': 'Hair (alt)',
  '7': 'Belt',
  '8': 'Leg Acc L',
  '9': 'Leg Acc R',
  '10': 'Waist',
  '11': 'Leg Armor',
  '12': 'Tabard Low',
  '13': 'Legs',
  '14': 'Bracers',
  '15': 'Cape',
  '17': 'Eyelids',
  '18': 'Belt',
};

const GROUP_COLORS = {
  '-1': '#888',
  '1': '#e74c3c',
  '2': '#f39c12',
  '3': '#f1c40f',
  '4': '#2ecc71',
  '5': '#1abc9c',
  '6': '#f39c12',
  '7': '#27ae60',
  '8': '#3498db',
  '9': '#9b59b6',
  '10': '#e67e22',
  '11': '#1a5276',
  '12': '#8e44ad',
  '13': '#c0392b',
  '14': '#7f8c8d',
  '15': '#2c3e50',
  '17': '#d35400',
  '18': '#7d3c98',
};

function geosetGroup(id) {
  if (id === 0) return -1;
  if (id < 100) return 0;
  return Math.floor(id / 100);
}

export default function SubmeshDebugger({ submeshes = [], enabledIndices, onToggle, onToggleAll, onReset, onSolo, colorDebug, onColorDebug }) {
  const [filterGroup, setFilterGroup] = useState('all');
  const [soloMode, setSoloMode] = useState(null);

  const enabledSet = useMemo(() => new Set(enabledIndices || []), [enabledIndices]);

  const groups = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < submeshes.length; i++) {
      const sm = submeshes[i];
      const g = geosetGroup(sm.id);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push({ ...sm, index: i });
    }
    return map;
  }, [submeshes]);

  const sortedGroups = useMemo(() => [...groups.keys()].sort((a, b) => a - b), [groups]);

  const totalTris = submeshes.reduce((sum, sm) => sum + (sm.triangles || 0), 0);
  const visibleTris = submeshes.filter((_, i) => enabledSet.has(i)).reduce((sum, sm) => sum + (sm.triangles || 0), 0);

  return (
    <div style={{ fontSize: 11, border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--bg-secondary, #1a1d24)', borderBottom: '1px solid var(--border-color)' }}>
        <strong>Submesh Debugger</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{visibleTris}/{totalTris} tris</span>
          <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => onReset?.()}>Reset</button>
          <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => onToggleAll?.([])}>Hide All</button>
          <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => onToggleAll?.(submeshes.map((_, i) => i))}>Show All</button>
          <button className="btn-secondary" style={{ padding: '2px 6px', fontSize: 10, background: colorDebug ? 'var(--accent, #3498db)' : undefined, color: colorDebug ? '#fff' : undefined }} onClick={() => onColorDebug?.(!colorDebug)}>Color</button>
        </div>
      </div>

      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          style={{ padding: '1px 6px', fontSize: 10, borderRadius: 3, border: '1px solid var(--border-color)', background: filterGroup === 'all' ? 'var(--accent, #3498db)' : 'transparent', color: filterGroup === 'all' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
          onClick={() => setFilterGroup('all')}
        >All</button>
        {sortedGroups.map(g => {
          const name = GROUP_NAMES[String(g)] || `Grp ${g}`;
          const count = groups.get(g).length;
          return (
            <button
              key={g}
              style={{ padding: '1px 6px', fontSize: 10, borderRadius: 3, border: `1px solid ${GROUP_COLORS[String(g)] || '#555'}`, background: filterGroup === g ? (GROUP_COLORS[String(g)] || '#555') : 'transparent', color: filterGroup === g ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => setFilterGroup(filterGroup === g ? 'all' : g)}
            >{name} ({count})</button>
          );
        })}
      </div>

      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #1a1d24)', zIndex: 1 }}>
              <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>On</th>
              <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>#</th>
              <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>Group</th>
              <th style={{ textAlign: 'right', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>Tris</th>
              <th style={{ textAlign: 'center', padding: '3px 6px', borderBottom: '1px solid var(--border-color)' }}>Solo</th>
            </tr>
          </thead>
          <tbody>
            {sortedGroups.filter(g => filterGroup === 'all' || g === filterGroup).map(g => {
              const sms = groups.get(g);
              const name = GROUP_NAMES[String(g)] || `Group ${g}`;
              const color = GROUP_COLORS[String(g)] || '#888';
              return sms.map((sm, i) => (
                <tr
                  key={sm.index}
                  style={{
                    background: enabledSet.has(sm.index)
                      ? `${color}15`
                      : 'transparent',
                    opacity: enabledSet.has(sm.index) ? 1 : 0.5,
                  }}
                >
                  <td style={{ padding: '2px 6px' }}>
                    <input
                      type="checkbox"
                      checked={enabledSet.has(sm.index)}
                      onChange={() => onToggle?.(sm.index)}
                    />
                  </td>
                  <td style={{ padding: '2px 6px', color: 'var(--text-secondary)' }}>{sm.index}</td>
                  <td style={{ padding: '2px 6px' }}>
                    <span style={{ color, fontWeight: i === 0 ? 700 : 400 }}>{sm.id}</span>
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    {i === 0 && <span style={{ color, fontSize: 10 }}>{name}</span>}
                  </td>
                  <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>{sm.triangles}</td>
                  <td style={{ padding: '2px 6px', textAlign: 'center' }}>
                    <button
                      style={{ padding: '0 4px', fontSize: 9, border: '1px solid var(--border-color)', borderRadius: 3, background: soloMode === sm.index ? 'var(--accent, #3498db)' : 'transparent', color: soloMode === sm.index ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
                      onClick={() => {
                        if (soloMode === sm.index) {
                          setSoloMode(null);
                          onReset?.();
                        } else {
                          setSoloMode(sm.index);
                          onSolo?.(sm.index);
                        }
                      }}
                    >S</button>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
