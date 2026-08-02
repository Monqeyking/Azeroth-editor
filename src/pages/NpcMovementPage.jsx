import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Search, Trash2 } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import CreatureModelPreview from '../components/creature/CreatureModelPreview';
import './EditorPage.css';
import './NpcMovementPage.css';

const MODES = ['Idle', 'Random', 'Waypoint'];
const MAPS = { 0: 'Eastern Kingdoms', 1: 'Kalimdor', 530: 'Outland', 571: 'Northrend' };
const n = v => Number(v) || 0;
const blankPoint = point => ({ point, position_x: 0, position_y: 0, position_z: 0, orientation: 0, delay: 0, move_type: 0, action: 0, action_chance: 100, wpguid: 0 });

function zoneOf(spawn, areas) {
  const hits = areas.filter(a => Number(a.mapId) === Number(spawn.map) && spawn.position_x >= Math.min(a.locTop, a.locBottom) && spawn.position_x <= Math.max(a.locTop, a.locBottom) && spawn.position_y >= Math.min(a.locLeft, a.locRight) && spawn.position_y <= Math.max(a.locLeft, a.locRight));
  if (!hits.length) return 'Outside mapped zones';
  hits.sort((a, b) => Math.abs((a.locTop - a.locBottom) * (a.locLeft - a.locRight)) - Math.abs((b.locTop - b.locBottom) * (b.locLeft - b.locRight)));
  return hits[0].internalName || `Area ${hits[0].areaId}`;
}

export default function NpcMovementPage() {
  const { query, dbcPath } = useConnection();
  const [term, setTerm] = useState(''); const [spawns, setSpawns] = useState([]); const [areas, setAreas] = useState([]);
  const [map, setMap] = useState(''); const [zone, setZone] = useState(''); const [selected, setSelected] = useState(null); const [form, setForm] = useState(null); const [points, setPoints] = useState([]);
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('Search for an NPC name or template entry to list its individual world spawns.');
  useEffect(() => { if (dbcPath) window.azeroth.worldmap.readWorldMapAreas(dbcPath).then(r => { if (r.success) setAreas(r.areas || []); }); }, [dbcPath]);
  const search = useCallback(async () => {
    const value = term.trim(); if (value.length < 2) return setMessage('Enter at least two characters, or a numeric template entry.');
    setBusy(true); setSelected(null); setForm(null); setPoints([]); setMap(''); setZone(''); const numeric = /^\d+$/.test(value);
    try {
      const res = await query(`SELECT c.guid, c.id1 AS entry, c.map, c.zoneId, c.areaId, c.position_x, c.position_y, c.position_z, c.orientation, c.wander_distance AS spawndist, c.MovementType, ct.name, ct.subname, ct.minlevel, ct.maxlevel, m.CreatureDisplayID, ca.path_id FROM creature c JOIN creature_template ct ON ct.entry = c.id1 LEFT JOIN creature_template_model m ON m.CreatureID = ct.entry AND m.Idx = 0 LEFT JOIN creature_addon ca ON ca.guid = c.guid WHERE ${numeric ? 'CAST(ct.entry AS CHAR) LIKE ?' : 'ct.name LIKE ?'} ORDER BY c.map, c.zoneId, ct.name, c.guid LIMIT 1000`, [`%${value}%`]);
      if (!res.success) throw new Error(res.error || 'Database query failed');
      const rows = (res.data || []).map(row => ({ ...row, zoneName: zoneOf(row, areas) })); setSpawns(rows); setMessage(rows.length ? `${rows.length} spawns found. Narrow by map and zone before selecting one.` : 'No spawns found.');
    } catch (e) { setMessage(`Search failed: ${e.message}`); } finally { setBusy(false); }
  }, [areas, query, term]);
  const maps = useMemo(() => [...new Set(spawns.map(s => String(s.map)))], [spawns]);
  const zones = useMemo(() => [...new Set(spawns.filter(s => !map || String(s.map) === map).map(s => s.zoneName))].sort(), [spawns, map]);
  const visible = useMemo(() => spawns.filter(s => (!map || String(s.map) === map) && (!zone || s.zoneName === zone)), [spawns, map, zone]);
  const choose = useCallback(async spawn => {
    setSelected(spawn); const pathId = n(spawn.path_id) || n(spawn.guid); setForm({ ...spawn, path_id: pathId });
    const res = await query('SELECT point, position_x, position_y, position_z, orientation, delay, move_type, action, action_chance, wpguid FROM waypoint_data WHERE id = ? ORDER BY point', [pathId]);
    setPoints(res.data || []); setMessage(`Editing GUID ${spawn.guid}. ${res.data?.length || 0} waypoints loaded from path ${pathId}.`);
  }, [query]);
  const change = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const pointChange = (row, key, value) => setPoints(prev => prev.map((p, i) => i === row ? { ...p, [key]: value } : p));
  const save = async () => {
    if (!form) return; setSaving(true);
    try {
      const mode = n(form.MovementType); const pathId = n(form.path_id) || n(form.guid);
      const run = async (sql, params) => { const result = await query(sql, params); if (!result.success) throw new Error(result.error || 'Database write failed'); };
      await run('UPDATE creature SET position_x=?, position_y=?, position_z=?, orientation=?, wander_distance=?, MovementType=? WHERE guid=?', [n(form.position_x), n(form.position_y), n(form.position_z), n(form.orientation), n(form.spawndist), mode, n(form.guid)]);
      if (mode === 2) {
        await run('INSERT INTO creature_addon (guid, path_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE path_id = VALUES(path_id)', [n(form.guid), pathId]);
        await run('DELETE FROM waypoint_data WHERE id = ?', [pathId]);
        for (const [i, p] of points.entries()) await run('INSERT INTO waypoint_data (id, point, position_x, position_y, position_z, orientation, delay, move_type, action, action_chance, wpguid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [pathId, i + 1, n(p.position_x), n(p.position_y), n(p.position_z), n(p.orientation), n(p.delay), n(p.move_type), n(p.action), n(p.action_chance) || 100, n(p.wpguid)]);
      }
      const saved = { ...form, MovementType: mode, path_id: mode === 2 ? pathId : 0 };
      setSpawns(prev => prev.map(spawn => Number(spawn.guid) === Number(saved.guid) ? { ...spawn, ...saved } : spawn));
      setForm(saved); setSelected(saved); setMessage('Saved. Restart the worldserver or reload the affected spawn data before validating movement in-game.');
    } catch (e) { setMessage(`Save failed: ${e.message}`); } finally { setSaving(false); }
  };
  return <div className="npcmove-page"><header className="editor-page-header npcmove-header"><div><h2 className="editor-page-title">NPC Movement</h2><p className="editor-page-subtitle">Find an individual creature spawn, validate its model, then edit its position and movement path.</p></div>{form && <button className="btn-primary" onClick={save} disabled={saving}><Save size={14}/> {saving ? 'Saving...' : 'Save spawn & path'}</button>}</header><section className="npcmove-search"><div className="search-box"><Search size={15}/><input value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="NPC name or template entry..."/></div><button className="btn-primary" onClick={search} disabled={busy}>{busy ? 'Searching...' : 'Find spawns'}</button></section>{spawns.length > 0 && <section className="npcmove-filters"><label>Map<select value={map} onChange={e => { setMap(e.target.value); setZone(''); }}><option value="">All maps ({spawns.length})</option>{maps.map(id => <option key={id} value={id}>{MAPS[id] || `Map ${id}`}</option>)}</select></label><label>Zone<select value={zone} onChange={e => setZone(e.target.value)}><option value="">All zones</option>{zones.map(item => <option key={item} value={item}>{item}</option>)}</select></label><span>{visible.length} matching spawns</span></section>}<p className="npcmove-message">{message}</p><div className="npcmove-layout"><aside className="npcmove-results">{visible.map(spawn => <button key={spawn.guid} className={`npcmove-result ${selected?.guid === spawn.guid ? 'active' : ''}`} onClick={() => choose(spawn)}><strong>{spawn.name}</strong><span>GUID {spawn.guid}  /  Entry {spawn.entry}</span><small>{MAPS[spawn.map] || `Map ${spawn.map}`}  /  {spawn.zoneName}</small></button>)}{spawns.length > 0 && !visible.length && <p className="npcmove-empty">No spawns match these filters.</p>}</aside><main className="npcmove-editor">{!form ? <div className="npcmove-empty">Select a single spawn after filtering its location.</div> : <><div className="npcmove-summary"><div><span>Selected spawn</span><strong>{form.name}</strong><small>GUID {form.guid}  /  Entry {form.entry}  /  {form.zoneName}</small></div><div><span>Movement</span><strong>{MODES[n(form.MovementType)] || 'Unknown'}</strong><small>Path ID {n(form.path_id) || '-'}</small></div><div><span>Level</span><strong>{form.minlevel}-{form.maxlevel}</strong><small>Map {form.map}</small></div></div><div className="npcmove-detail-grid"><section className="npcmove-card"><h3>Spawn transform</h3><div className="npcmove-fields">{[['position_x','X'],['position_y','Y'],['position_z','Z'],['orientation','Orientation']].map(([key,label]) => <label key={key}>{label}<input type="number" step="0.001" value={form[key] ?? 0} onChange={e => change(key, e.target.value)}/></label>)}</div><h3>Movement</h3><div className="npcmove-fields"><label>Mode<select value={form.MovementType} onChange={e => change('MovementType', e.target.value)}>{MODES.map((name, i) => <option key={name} value={i}>{i}: {name}</option>)}</select></label><label>Wander radius<input type="number" min="0" step="0.1" value={form.spawndist ?? 0} onChange={e => change('spawndist', e.target.value)}/></label>{n(form.MovementType) === 2 && <label>Path ID<input type="number" value={form.path_id} onChange={e => change('path_id', e.target.value)}/></label>}</div><p className="field-hint">Random uses the wander radius. Waypoint uses creature_addon path ID; zero falls back to this spawn GUID.</p></section><section className="npcmove-preview"><CreatureModelPreview displayId={form.CreatureDisplayID}/></section></div>{n(form.MovementType) === 2 && <section className="npcmove-waypoints"><div className="npcmove-waypoint-head"><div><h3>Waypoint path</h3><p>Points are saved in order. Delay is milliseconds; move type 0 is walk and 1 is run.</p></div><button className="btn-ghost" onClick={() => setPoints(prev => [...prev, blankPoint(prev.length + 1)])}><Plus size={14}/> Add point</button></div><div className="npcmove-waypoint-table"><div className="npcmove-waypoint-row head"><span>#</span><span>X</span><span>Y</span><span>Z</span><span>Orientation</span><span>Delay</span><span>Move</span><span/></div>{points.map((point, i) => <div className="npcmove-waypoint-row" key={`${point.point}-${i}`}><span>{i + 1}</span>{['position_x','position_y','position_z','orientation','delay','move_type'].map(key => <input key={key} type="number" step={key === 'move_type' || key === 'delay' ? '1' : '0.001'} value={point[key] ?? 0} onChange={e => pointChange(i, key, e.target.value)}/>)}<button className="icon-btn" title="Remove waypoint" onClick={() => setPoints(prev => prev.filter((_, index) => index !== i))}><Trash2 size={14}/></button></div>)}</div>{!points.length && <p className="npcmove-empty">This spawn has no waypoint rows yet. Add the first point, then save.</p>}</section>}</>}</main></div></div>;
}
