import { useMemo, useState } from 'react';
import { ClipboardList, FileOutput, ShieldCheck } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';

const slug = value => String(value || 'variant').trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'variant';
const sqlValue = value => value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;

export default function TextureWorkshopGenerator({ sourceSet, rows, exportedTextures }) {
  const { query, findNextItemSetId, dbcPath } = useConnection();
  const [settings, setSettings] = useState({ name: '', suffix: '', description: '', quality: '', itemLevel: '', requiredLevel: '', classMask: '-1', itemStart: '4000000', displayStart: '4000000' });
  const [plan, setPlan] = useState(null), [status, setStatus] = useState('');
  const update = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  const sourceRows = useMemo(() => rows.filter(row => Number(row.entry) && Number(row.displayid)), [rows]);
  const buildPlan = async () => {
    if (!sourceSet || !sourceRows.length) { setStatus('Select a source set with resolvable items first.'); return; }
    if (!settings.name.trim() || !settings.suffix.trim()) { setStatus('Variant set name and item suffix are required.'); return; }
    const max = await query('SELECT MAX(entry) AS id FROM item_template');
    const firstItem = Math.max(Number(settings.itemStart) || 4000000, Number(max.data?.[0]?.id || 0) + 1);
    const setIdResult = await findNextItemSetId();
    const displayIds = [...new Set(sourceRows.map(row => Number(row.displayid)))];
    const firstDisplay = Number(settings.displayStart) || 4000000;
    setPlan({ setId: setIdResult.success ? Number(setIdResult.id) : 0, items: sourceRows.map((row, index) => ({ ...row, newItemId: firstItem + index, newDisplayId: firstDisplay + displayIds.indexOf(Number(row.displayid)) })), displayIds });
    setStatus('Review the planned IDs before staging the SQL.');
  };
  const stageSql = async () => {
    if (!plan) return;
    const requiredTextures = [...new Set(sourceRows.flatMap(row => row.textures || []))];
    const exported = new Set((exportedTextures || []).map(row => String(row.source).toLowerCase()));
    const missingTextures = requiredTextures.filter(texture => !exported.has(String(texture).toLowerCase()));
    if (missingTextures.length) { setStatus(`Export all ${requiredTextures.length} resolved set textures before staging. ${missingTextures.length} still missing.`); return; }
    const columns = await query('SHOW COLUMNS FROM item_template');
    const fields = (columns.data || []).map(row => row.Field).filter(Boolean);
    if (!fields.length) { setStatus('Could not read item_template columns.'); return; }
    const setName = settings.name.trim(), itemSuffix = settings.suffix.trim();
    const statements = ['-- Texture Workshop staged item-set variant', 'START TRANSACTION;', 'CREATE TABLE IF NOT EXISTS item_set_names (entry INT UNSIGNED NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL DEFAULT \'\', patch INT NOT NULL DEFAULT 0);', `INSERT INTO item_set_names (entry, name, patch) VALUES (${plan.setId}, ${sqlValue(setName)}, 0) ON DUPLICATE KEY UPDATE name=VALUES(name), patch=VALUES(patch);`];
    for (const item of plan.items) {
      const values = fields.map(field => {
        if (field === 'entry') return String(item.newItemId);
        if (field === 'displayid') return String(item.newDisplayId);
        if (field.toLowerCase() === 'itemset') return String(plan.setId);
        if (field === 'name') return `CONCAT(\`name\`, ' ${itemSuffix.replace(/'/g, "''")}')`;
        if (field === 'description' && settings.description) return sqlValue(settings.description);
        if (field === 'Quality' && settings.quality !== '') return String(Number(settings.quality));
        if (field === 'ItemLevel' && settings.itemLevel !== '') return String(Number(settings.itemLevel));
        if (field === 'RequiredLevel' && settings.requiredLevel !== '') return String(Number(settings.requiredLevel));
        if (field === 'AllowableClass') return String(Number(settings.classMask));
        return `\`${field}\``;
      });
      statements.push(`INSERT INTO \`item_template\` (${fields.map(field => `\`${field}\``).join(', ')}) SELECT ${values.join(', ')} FROM \`item_template\` WHERE \`entry\` = ${Number(item.entry)};`);
    }
    statements.push('COMMIT;');
    const saved = await window.azeroth.textureWorkshop.writeSql(slug(setName), statements.join('\n\n'));
    if (!saved.success) { setStatus(saved.error || 'Could not stage SQL.'); return; }
    const textureMap = Object.fromEntries((exportedTextures || []).map(row => [row.source, row.output]));
    const dbc = await window.azeroth.textureWorkshop.stageDbc(dbcPath, { sourceSetId: sourceSet.id, newSetId: plan.setId, newSetName: setName, textureMap, items: plan.items.map(item => ({ sourceItemId: item.entry, newItemId: item.newItemId, sourceDisplayId: item.displayid, newDisplayId: item.newDisplayId })) });
    setStatus(dbc.success ? `Staged SQL plus ${dbc.displayCount} ItemDisplayInfo records and ItemSet #${dbc.setId} in output.` : `SQL staged, but DBC staging failed: ${dbc.error}`);
  };
  return <section className="tw-generator"><div className="tw-panel-title"><ClipboardList size={15} /> Phase 3 / Generate variant</div><div className="tw-generator-fields"><label>New set name<input value={settings.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Frost Valor" /></label><label>Item suffix<input value={settings.suffix} onChange={e => update('suffix', e.target.value)} placeholder="e.g. Frost" /></label><label>Description<input value={settings.description} onChange={e => update('description', e.target.value)} placeholder="Optional" /></label><label>Quality<select value={settings.quality} onChange={e => update('quality', e.target.value)}><option value="">Keep source</option>{['Poor','Common','Uncommon','Rare','Epic','Legendary'].map((name, id) => <option key={name} value={id}>{name}</option>)}</select></label><label>Item level<input value={settings.itemLevel} onChange={e => update('itemLevel', e.target.value)} placeholder="Keep source" /></label><label>Required level<input value={settings.requiredLevel} onChange={e => update('requiredLevel', e.target.value)} placeholder="Keep source" /></label><label>Class mask<input value={settings.classMask} onChange={e => update('classMask', e.target.value)} /></label><label>First item ID<input value={settings.itemStart} onChange={e => update('itemStart', e.target.value)} /></label><label>First display ID<input value={settings.displayStart} onChange={e => update('displayStart', e.target.value)} /></label></div><button className="tw-generate" onClick={buildPlan}><ClipboardList size={14} /> Build generation plan</button>{plan && <><div className="tw-generator-plan"><b>New ItemSet #{plan.setId}</b>{plan.items.map(item => <span key={item.entry}>#{item.entry} → #{item.newItemId} / display #{item.newDisplayId}</span>)}</div><button className="tw-generate" onClick={stageSql}><FileOutput size={14} /> Stage import SQL</button></>}<small><ShieldCheck size={12} /> SQL is written to output only. No database records are changed automatically.</small>{status && <div className="tw-generator-status">{status}</div>}</section>;
}
