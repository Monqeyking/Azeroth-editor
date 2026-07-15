import { useEffect, useMemo, useState, useRef } from 'react';
import { Plus, Save, RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import CharM2Viewer from '../components/char/CharM2Viewer';
import SubmeshDebugger from '../components/char/SubmeshDebugger';
import './EditorPage.css';

const empty = { id: 0, extraId: 0, modelId: 0, race: 12, gender: 0, skin: 0, face: 0, hairStyle: 0, hairColor: 0, facialHair: 0, npcItemDisplays: Array(11).fill(0), scale: 1, alpha: 255, geosetData: 0 };
const number = (v) => Number(v) || 0;
const PLAYER_RACES = [{ id:1,label:'Human',path:'Human' },{ id:2,label:'Orc',path:'Orc' },{ id:3,label:'Dwarf',path:'Dwarf' },{ id:4,label:'Night Elf',path:'NightElf' },{ id:5,label:'Undead',path:'Scourge' },{ id:6,label:'Tauren',path:'Tauren' },{ id:7,label:'Gnome',path:'Gnome' },{ id:8,label:'Troll',path:'Troll' },{ id:10,label:'Blood Elf',path:'BloodElf' },{ id:11,label:'Draenei',path:'Draenei' },{ id:12,label:'Worgen',path:'Worgen' }];

export default function CreatureDisplaysPage() {
  const { dbcPath, worldmapMpqPath, idRanges, query: dbQuery, readItemDisplayInfos, readCreatureDisplayCreator, findNextCreatureDisplayId, createCreatureDisplay } = useConnection();
  const [data, setData] = useState({ displays: [], models: [], charSections: [] });
  const [itemAssets, setItemAssets] = useState({});
  const [equipmentOffsets, setEquipmentOffsets] = useState({});
  const [form, setForm] = useState(empty); const [query, setQuery] = useState(''); const [pathFilter, setPathFilter] = useState('all'); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [notice, setNotice] = useState('');
  const load = async () => { if (!dbcPath) return; setLoading(true); const r = await readCreatureDisplayCreator(); if (r.success) { setData(r); setNotice(''); } else setNotice(r.error); setLoading(false); };
  useEffect(() => { load(); }, [dbcPath]);  useEffect(() => {
    const ids = [...new Set((form.npcItemDisplays || []).map(number).filter(Boolean))];
    if (!worldmapMpqPath || !ids.length) return setItemAssets({});
    let cancelled = false;
    readItemDisplayInfos(worldmapMpqPath, ids, { race: number(form.race), gender: number(form.gender) }).then(result => {
      if (!cancelled && result.success) setItemAssets(result.data || {});
    });
    return () => { cancelled = true; };
  }, [worldmapMpqPath, form.npcItemDisplays?.join('|'), form.race, form.gender, readItemDisplayInfos]);
  const filtered = useMemo(() => data.displays.filter(d => {
    const modelPath = d.modelPath || '';
    const matchesType = pathFilter === 'all' || (pathFilter === 'player' ? /^character\\/i.test(modelPath) : /^creature\\/i.test(modelPath));
    return matchesType && `${d.id} ${d.modelId} ${modelPath}`.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 500), [data.displays, query, pathFilter]);
  const models = useMemo(() => data.models.filter(m => /^character\\/i.test(m.path)).sort((a,b) => a.path.localeCompare(b.path)), [data.models]);
  const raceForModel = (model) => {
    const lower = (model?.path || '').toLowerCase();
    const race = PLAYER_RACES.find(r => lower.includes(`character\\${r.path.toLowerCase()}\\`));
    return race ? { race: race.id, gender: /\\female\\/i.test(model.path) ? 1 : 0 } : null;
  };
  const selectModel = (modelId) => {
    const model = data.models.find(m => String(m.id) === String(modelId));
    const appearance = raceForModel(model);
    setForm(f => ({ ...f, modelId, ...(appearance || { race: 12, gender: 0 }) }));
  };
  const changeCharacterIdentity = (raceValue, genderValue) => setForm(f => {
    const race = number(raceValue), gender = number(genderValue);
    const model = models.find(m => { const identity = raceForModel(m); return identity?.race === race && identity?.gender === gender; });
    return { ...f, race, gender, modelId: model?.id || f.modelId, skin: 0, face: 0, hairStyle: 0, hairColor: 0, facialHair: 0 };
  });  const currentModel = useMemo(() => data.models.find(m => m.id === form.modelId), [data.models, form.modelId]);
  const isPlayerModel = currentModel ? raceForModel(currentModel) !== null : false;
  const equipmentIdentity = `${number(form.race)}:${number(form.gender)}`;
  const defaultHelmOffset = [0, 0, 0];
  const helmOffset = equipmentOffsets[equipmentIdentity] || defaultHelmOffset;
  const attachedModels = useMemo(() => {
    const rows = [];
    const add = (slot, attachmentId, asset, key) => {
      const modelPath = asset?.[`${key}Path`];
      if (modelPath) rows.push({ slot, attachmentId, modelPath, texturePath: asset?.[`${key.replace('model', 'texture')}Path`] || '', offset: slot === 'helm' ? helmOffset : [0, 0, 0] });
    };
    const helm = itemAssets[number(form.npcItemDisplays?.[0])];
    add('helm', 11, helm, 'model1');
    const shoulders = itemAssets[number(form.npcItemDisplays?.[1])];
    add('shoulder-left', 6, shoulders, 'model1');
    add('shoulder-right', 5, shoulders, 'model2');
    const belt = itemAssets[number(form.npcItemDisplays?.[4])];
    add('belt-buckle', 53, belt, 'model1'); // ATT_BELT_BUCKLE; model2 is the optional collection model.
    const cape = itemAssets[number(form.npcItemDisplays?.[10])];
    add('cape', 12, cape, 'model1');
    return rows;
  }, [itemAssets, form.npcItemDisplays, helmOffset]);  const itemGeosets = useMemo(() => {
    const selected = {};
    const use = (slot, mappings) => {
      const row = itemAssets[number(form.npcItemDisplays?.[slot])];
      if (!row) return;
      mappings.forEach(([group, index, transform]) => {
        const value = row.geosets?.[index];
        if (Number.isFinite(value)) selected[group] = transform ? transform(value) : value;
      });
    };
    use(10, [[15, 0]]);                         // cape
    use(8, [[4, 0], [23, 1]]);                  // gloves
    use(6, [[5, 0], [20, 1, value => value === 0 ? 1 : value - 1]]); // boots
    use(4, [[18, 0]]);                          // belt
    use(5, [[11, 0], [9, 1], [13, 2]]);         // legs
    use(2, [[8, 0], [10, 1], [13, 2], [22, 3], [28, 4]]); // shirt
    use(3, [[8, 0], [10, 1], [13, 2], [22, 3], [28, 4]]); // cuirass overrides shirt
    use(9, [[12, 0]]);                          // tabard
    return selected;
  }, [itemAssets, form.npcItemDisplays]);  const modelDir = useMemo(() => {
    const p = currentModel?.path || '';
    const last = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return last > 0 ? p.substring(0, last + 1) : '';
  }, [currentModel?.path]);
  const DK_FLAG = 0x04;
  const restrictToModelDir = number(form.race) === 12;
  const skins = useMemo(() => {
    let filtered = data.charSections.filter(s => s.race === number(form.race) && s.gender === number(form.gender) && s.baseSection === 0 && s.variation === 0 && !(s.flags & DK_FLAG));
    if (restrictToModelDir && modelDir) filtered = filtered.filter(s => s.texture && s.texture.toLowerCase().startsWith(modelDir.toLowerCase()));
    return filtered;
  }, [data.charSections, form.race, form.gender, modelDir, restrictToModelDir]);
  const faceLayers = useMemo(() => {
    let row = data.charSections.find(s => s.race === number(form.race) && s.gender === number(form.gender) && s.baseSection === 1 && s.variation === number(form.face) && s.color === number(form.skin) && !(s.flags & DK_FLAG));
    if (restrictToModelDir && modelDir && row?.texture && !row.texture.toLowerCase().startsWith(modelDir.toLowerCase())) {
      row = data.charSections.find(s => s.race === number(form.race) && s.gender === number(form.gender) && s.baseSection === 1 && s.variation === number(form.face) && s.color === number(form.skin) && s.texture && s.texture.toLowerCase().startsWith(modelDir.toLowerCase()) && !(s.flags & DK_FLAG));
    }
    return [row?.texture && { path: row.texture, region: 'face-lower' }, row?.texture2 && { path: row.texture2, region: 'face-upper' }].filter(Boolean);
  }, [data.charSections, form.race, form.gender, form.face, form.skin, modelDir, restrictToModelDir]);
  const skinLayers = useMemo(() => {
    if (number(form.race) !== 12) return [];
    const row = skins.find(s => s.color === number(form.skin));
    return [row?.texture2].filter(Boolean);
  }, [skins, form.race, form.skin]);
  const appearanceOptions = useMemo(() => {
    let rows = data.charSections.filter(s => s.race === number(form.race) && s.gender === number(form.gender) && !(s.flags & DK_FLAG));
    if (restrictToModelDir && modelDir) rows = rows.filter(s => s.texture && s.texture.toLowerCase().startsWith(modelDir.toLowerCase()));
    const values = (section, filter = () => true, field = 'variation') => [...new Set(rows.filter(s => s.baseSection === section && filter(s)).map(s => s[field]))].sort((a, b) => a - b);
    return {
      faces: values(1, s => s.color === number(form.skin)),
      hairStyles: values(3),
      hairColors: values(3, s => s.variation === number(form.hairStyle), 'color'),
      facialStyles: values(2),
    };
  }, [data.charSections, form.race, form.gender, form.skin, form.hairStyle, modelDir, restrictToModelDir]);
  const hairLayers = useMemo(() => {
    const row = data.charSections.find(s => s.race === number(form.race) && s.gender === number(form.gender) && s.baseSection === 3 && s.variation === number(form.hairStyle) && s.color === number(form.hairColor) && !(s.flags & DK_FLAG));
    return [row?.texture && { path: row.texture, region: 'hair-primary' }, row?.texture2 && { path: row.texture2, region: 'face-lower' }, row?.texture3 && { path: row.texture3, region: 'face-upper' }].filter(Boolean);
  }, [data.charSections, form.race, form.gender, form.hairStyle, form.hairColor]);
  const facialLayers = useMemo(() => {
    const hairColor = number(form.hairColor);
    const facialColor = hairColor;
    const row = data.charSections.find(s => s.race === number(form.race) && s.gender === number(form.gender) && s.baseSection === 2 && s.variation === number(form.facialHair) && s.color === facialColor && !(s.flags & DK_FLAG));
    return [row?.texture && { path: row.texture, region: 'face-lower' }, row?.texture2 && { path: row.texture2, region: 'face-upper' }].filter(Boolean);
  }, [data.charSections, form.race, form.gender, form.facialHair, form.hairColor]);
  // WMV's SLOT_LAYERS: components sharing a region must compose by equipment priority, not NPC slot order.
  const itemTextureLayers = useMemo(() => {
    const priorities = [11, 13, 10, 13, 18, 10, 11, 19, 20, 17, 23];
    return (form.npcItemDisplays || []).flatMap((id, slot) => Object.entries(itemAssets[number(id)]?.componentTexturePaths || {})
      .filter(([, path]) => path)
      .map(([region, path]) => ({ path, region, priority: priorities[slot] || 0 })))
      .sort((a, b) => a.priority - b.priority);
  }, [form.npcItemDisplays, itemAssets]);
  const fallbackSkin = number(form.race) === 12
    ? `Character\\Worgen\\${number(form.gender) ? 'Female' : 'Male'}\\worgen${number(form.gender) ? 'female' : 'male'}skin00_00.blp`
    : null;
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setNpcItemDisplay = (slot, value) => setForm(f => { const npcItemDisplays = [...(f.npcItemDisplays || Array(11).fill(0))]; npcItemDisplays[slot] = number(value); return { ...f, npcItemDisplays }; });
  const open = (d) => { const model = data.models.find(m => m.id === d.modelId); const derived = raceForModel(model); setForm({ id:d.id, extraId:d.extraId, modelId:d.modelId, scale:d.scale, alpha:d.alpha, geosetData:d.geosetData, npcItemDisplays:Array.from({ length:11 }, (_, i) => d.extra?.npcItemDisplays?.[i] || 0), ...(derived || { race:12, gender:0 }), ...(d.extra || { skin:0, face:0, hairStyle:0, hairColor:0, facialHair:0 }) }); };
  const create = async () => { const ids = await findNextCreatureDisplayId(idRanges.display); if (!ids.success) return setNotice(ids.error); const worgen = data.models.find(m => /WorgenMale\.m2/i.test(m.path)) || models[0]; const skin = Math.floor(Math.random() * 8); setForm({ ...empty, id: ids.displayId, extraId: ids.extraId, modelId: worgen?.id || 0, skin, face: Math.floor(Math.random() * 8), hairStyle: Math.floor(Math.random() * 6), hairColor: Math.floor(Math.random() * 5), facialHair: Math.floor(Math.random() * 5) }); setNotice('New display has a randomized Worgen appearance.'); };
  const save = async () => { if (!form.modelId) return setNotice('Select a valid CreatureModelData model first.'); setSaving(true); const r = await createCreatureDisplay({ ...Object.fromEntries(Object.entries(form).filter(([key]) => key !== 'npcItemDisplays').map(([k,v]) => [k, number(v)])), npcItemDisplays: Array.from({ length:11 }, (_, i) => number(form.npcItemDisplays?.[i])), startId:idRanges.display }); setSaving(false); if (!r.success) return setNotice(r.error); setNotice(`Saved Display ${r.displayId} with Extra ${r.extraId}. Saved to the configured server DBC folder. Copy both DBC files to the client manually when you want to test the visual in-game.`); await load(); setForm(f => ({ ...f, id:r.displayId, extraId:r.extraId })); };
  return <div className="editor-page creature-display-page">
    <div className="page-header"><div><h1>Creature Displays</h1><p>Create a character display, preview it from client assets, and save its DBC records to the configured server data folder.</p></div><div className="header-actions"><button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14}/> Reload</button><button className="btn-primary" onClick={create}><Plus size={14}/> New display</button></div></div>
    {notice && <div className="alert alert-info">{notice}</div>}
    <div className="creature-display-workspace">
      <aside className="editor-card creature-display-library"><div className="field-group"><label><Search size={13}/> Search display ID, model ID or path</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="4000000 or Worgen"/></div><div className="field-group"><label>Model type</label><select value={pathFilter} onChange={e=>setPathFilter(e.target.value)}><option value="all">All models</option><option value="player">Player characters</option><option value="creature">Creature models</option></select></div><div className="creature-display-results">{filtered.map(d=><button key={d.id} className="list-row creature-display-result" onClick={()=>open(d)}><strong>{d.id} Â· Model {d.modelId}</strong><small>{d.modelPath || 'Unknown model'} Â· Extra {d.extraId}</small></button>)}{!loading&&!filtered.length&&<p>No displays found.</p>}</div></aside>
      <section className="editor-card creature-display-stage"><div className="creature-display-preview"><div className="creature-display-base">Base: {skins.find(s=>s.color===number(form.skin))?.texture || fallbackSkin || 'none'}</div><CharM2Viewer race={number(form.race)} gender={number(form.gender)} skinBlp={skins.find(s=>s.color===number(form.skin))?.texture || fallbackSkin} appearance={form} textureLayers={[...skinLayers, ...faceLayers, ...hairLayers, ...facialLayers, ...itemTextureLayers]} active={!!worldmapMpqPath} modelPath={!isPlayerModel && currentModel?.path ? currentModel.path : null} attachedModels={attachedModels} itemGeosets={itemGeosets}/></div></section>
      <aside className="editor-card creature-display-controls">
  <div className="creature-display-target"><span>{data.displays.some(d=>d.id===number(form.id)) ? 'Editing display' : 'New NPC display'}</span><strong>Display #{form.id || '—'}</strong><small>Extra #{form.extraId || '—'}</small></div>
  <h2>Character appearance</h2>
  <div className="wmv-identity"><label className="field-group"><span>Race</span><select value={form.race} onChange={e=>changeCharacterIdentity(e.target.value, form.gender)}>{PLAYER_RACES.map(r=><option key={r.id} value={r.id}>{r.label} ({r.id})</option>)}</select></label><label className="field-group"><span>Gender</span><select value={form.gender} onChange={e=>changeCharacterIdentity(form.race, e.target.value)}><option value="0">Male</option><option value="1">Female</option></select></label></div>
  <div className="wmv-appearance"><AppearanceStepper label="Skin color" value={form.skin} options={[...new Set(skins.map(s=>s.color))].sort((a,b)=>a-b)} set={v=>set('skin',v)} /><AppearanceStepper label="Face type" value={form.face} options={appearanceOptions.faces} set={v=>set('face',v)} /><AppearanceStepper label="Hair style" value={form.hairStyle} options={appearanceOptions.hairStyles} set={v=>set('hairStyle',v)} /><AppearanceStepper label="Hair color" value={form.hairColor} options={appearanceOptions.hairColors} set={v=>set('hairColor',v)} /><AppearanceStepper label="Facial feature" value={form.facialHair} options={appearanceOptions.facialStyles} set={v=>set('facialHair',v)} /></div>
  <details className="creature-display-data"><summary>Equipment (NPC item displays)</summary><EquipmentEditor values={form.npcItemDisplays} assets={itemAssets} onChange={setNpcItemDisplay} query={dbQuery} setNotice={setNotice}/>{number(form.npcItemDisplays?.[0]) > 0 && <EquipmentOffsetEditor value={helmOffset} onChange={value => setEquipmentOffsets(current => ({ ...current, [equipmentIdentity]: value }))}/>}</details>
  <details className="creature-display-data"><summary>Display data</summary><div className="form-grid"><Field label="Display ID" value={form.id} set={v=>set('id',v)} /><Field label="Extra ID" value={form.extraId} set={v=>set('extraId',v)} /><label className="field-group"><span>Creature model</span><select value={form.modelId} onChange={e=>selectModel(e.target.value)}><option value="">Select model</option>{[...(currentModel && !data.models.find(m=>m.id===currentModel.id) ? [currentModel] : []), ...data.models.filter(m => !currentModel || m.id !== currentModel.id)].slice(0, 500).map(m=><option key={m.id} value={m.id}>{m.id} - {m.path}</option>)}</select></label><Field label="Scale" value={form.scale} set={v=>set('scale',v)} step="0.01"/><Field label="Alpha" value={form.alpha} set={v=>set('alpha',v)} /><Field label="Geoset data" value={form.geosetData} set={v=>set('geosetData',v)} /></div></details>
  <button className="btn-primary creature-display-save" onClick={save} disabled={saving}><Save size={14}/>{saving?'Saving...':'Save Creature Display'}</button>
</aside>
    </div>
  </div>;
}
function AppearanceStepper({ label, value, options, set }) {
  const values = [...new Set([number(value), ...options])].sort((a, b) => a - b);
  const index = Math.max(0, values.indexOf(number(value)));
  const move = (amount) => set(values[(index + amount + values.length) % values.length]);
  return <div className="appearance-stepper"><span>{label}</span><button type="button" onClick={()=>move(-1)} aria-label={`Previous ${label}`}><ChevronLeft size={14}/></button><strong>{index + 1} / {values.length}</strong><button type="button" onClick={()=>move(1)} aria-label={`Next ${label}`}><ChevronRight size={14}/></button></div>;
}function Field({label,value,set,step}) { return <label className="field-group"><span>{label}</span><input type="number" step={step||1} value={value} onChange={e=>set(e.target.value)}/></label>; }

function EquipmentOffsetEditor({ value, onChange }) {
  const update = (axis, next) => onChange(value.map((current, index) => index === axis ? Number(next) : current));
  return <div className="creature-display-item-offsets">
    <strong>Helm placement (preview only)</strong>
    <small>Use the values below to place the helmet, then send the final X / Y / Z values to me.</small>
    {['X', 'Y', 'Z'].map((label, axis) => <label key={label}><span>{label}: {Number(value[axis] || 0).toFixed(2)}</span><input type="range" min="-1" max="1" step="0.01" value={value[axis] || 0} onChange={event => update(axis, event.target.value)}/><input type="number" min="-1" max="1" step="0.01" value={value[axis] || 0} onChange={event => update(axis, event.target.value)}/></label>)}
  </div>;
}
const NPC_ITEM_SLOTS = ['Helm', 'Shoulder', 'Shirt', 'Cuirass', 'Belt', 'Legs', 'Boots', 'Wrist', 'Gloves', 'Tabard', 'Cape'];
function EquipmentEditor({ values, assets, onChange, query, setNotice }) {
  const [entries, setEntries] = useState(Array(11).fill(''));
  const resolve = async (slot) => {
    const entry = number(entries[slot]);
    if (!entry) return onChange(slot, 0);
    const result = await query('SELECT entry, name, displayid FROM item_template WHERE entry = ? LIMIT 1', [entry]);
    const item = result.data?.[0];
    if (!item?.displayid) return setNotice(`Item ${entry} has no usable displayid.`);
    onChange(slot, item.displayid);
    setNotice(`${NPC_ITEM_SLOTS[slot]}: ${item.name} (display ${item.displayid})`);
  };
  return <><p className="muted">Enter a normal <strong>item_template</strong> ID and click Use item. The editor automatically saves its ItemDisplayInfo ID in the correct NPC slot.</p><div className="form-grid">{NPC_ITEM_SLOTS.map((slotName, slot) => { const displayId = number(values?.[slot]); const asset = assets?.[displayId]; const components = Object.entries(asset?.componentTextures || {}).filter(([, value]) => value); return <div className="field-group" key={slot}><span>{slotName} <small>(NPCItemDisplay_{slot})</small></span><div style={{display:'flex',gap:6}}><input type="number" value={entries[slot]} placeholder="item_template entry" onChange={e=>setEntries(current => current.map((value, i) => i === slot ? e.target.value : value))}/><button type="button" className="btn-secondary" onClick={()=>resolve(slot)}>Use item</button></div>{displayId > 0 && <details className="creature-display-item-assets"><summary>Resolved ItemDisplayInfo #{displayId}</summary>{asset ? <small>Models: {asset.model1 || '—'}{asset.model2 ? ` / ${asset.model2}` : ''}<br/>Textures: {asset.texture1 || '—'}{asset.texture2 ? ` / ${asset.texture2}` : ''}<br/>{components.length ? `Components: ${components.map(([name, value]) => `${name}=${value}`).join(', ')}` : 'No body component textures'}</small> : <small>Reading client ItemDisplayInfoâ€¦</small>}</details>}<details><summary>Advanced: direct ItemDisplayInfo ID</summary><input type="number" value={values?.[slot] || ''} placeholder="ItemDisplayInfo ID" onChange={e=>onChange(slot, e.target.value)}/></details></div>; })}</div></>;
}