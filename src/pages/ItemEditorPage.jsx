import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Plus, Save, RotateCcw, ChevronRight, MousePointerClick, Copy } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

const ITEM_FIELDS = [
	{ key: 'entry', label: 'Entry', type: 'number', readonly: true },
	{ key: 'name', label: 'Name', type: 'text', required: true },
	{ key: 'description', label: 'Description', type: 'text' },
	{ key: 'class', label: 'Class', type: 'select', options: ['0:Consumable', '1:Container', '2:Weapon', '3:Gem', '4:Armor', '5:Reagent', '6:Projectile', '7:Trade Goods', '8:Generic', '9:Recipe', '10:Money', '11:Quiver', '12:Quest', '13:Key', '14:Permanent', '15:Misc'] },
	{ key: 'subclass', label: 'Subclass', type: 'number' },
	{ key: 'displayid', label: 'Display ID', type: 'number' },
	{ key: 'Quality', label: 'Quality', type: 'select', options: ['0:Poor', '1:Common', '2:Uncommon', '3:Rare', '4:Epic', '5:Legendary', '6:Artifact', '7:Heirloom'] },
	{ key: 'Flags', label: 'Flags', type: 'number' },
	{ key: 'BuyCount', label: 'Buy Count', type: 'number' },
	{ key: 'BuyPrice', label: 'Buy Price', type: 'number' },
	{ key: 'SellPrice', label: 'Sell Price', type: 'number' },
	{ key: 'InventoryType', label: 'Inventory Type', type: 'number' },
	{ key: 'AllowableClass', label: 'Allowable Class', type: 'number' },
	{ key: 'AllowableRace', label: 'Allowable Race', type: 'number' },
	{ key: 'ItemLevel', label: 'Item Level', type: 'number' },
	{ key: 'RequiredLevel', label: 'Req Level', type: 'number' },
	{ key: 'MaxCount', label: 'Max Count', type: 'number' },
	{ key: 'stackable', label: 'Stackable', type: 'number' },
	{ key: 'dmg_min1', label: 'Min Damage', type: 'decimal' },
	{ key: 'dmg_max1', label: 'Max Damage', type: 'decimal' },
	{ key: 'armor', label: 'Armor', type: 'number' },
	{ key: 'spellid_1', label: 'Spell ID 1', type: 'number' },
	{ key: 'bonding', label: 'Bonding', type: 'select', options: ['0:No Bind', '1:Bind on Pickup', '2:Bind on Equip', '3:Bind on Use', '4:Quest Item'] },
	{ key: 'PageText', label: 'Page Text', type: 'number' },
	{ key: 'stat_type1', label: 'Stat Type 1', type: 'number' },
	{ key: 'stat_value1', label: 'Stat Value 1', type: 'number' },
	{ key: 'stat_type2', label: 'Stat Type 2', type: 'number' },
	{ key: 'stat_value2', label: 'Stat Value 2', type: 'number' },
	{ key: 'ScriptName', label: 'Script Name', type: 'text' },
];

const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e55c3c', '#e6cc80'];
const QUALITY_LABELS = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];

export default function ItemEditorPage() {
	const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
	const [search, setSearch] = useState('');
	const [items, setItems] = useState([]);
	const [selected, setSelected] = useState(null);
	const [form, setForm] = useState({});
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState(null);
	const [loading, setLoading] = useState(false);
	const [copying, setCopying] = useState(false);
	const searchRef = useRef(null);

	const searchItems = useCallback(async (term) => {
		setLoading(true);
		const isNum = /^\d+$/.test(term);
		let sql, params;
		if (!term) {
			sql = 'SELECT entry, `name`, `class`, Quality, ItemLevel, RequiredLevel FROM item_template ORDER BY entry DESC LIMIT 50';
			params = [];
		} else if (isNum) {
			sql = 'SELECT entry, `name`, `class`, Quality, ItemLevel, RequiredLevel FROM item_template WHERE entry = ? LIMIT 50';
			params = [term];
		} else {
			sql = 'SELECT entry, `name`, `class`, Quality, ItemLevel, RequiredLevel FROM item_template WHERE `name` LIKE ? LIMIT 50';
			params = [`%${term}%`];
		}
		const result = await query(sql, params);
		setItems(result.data || []);
		setLoading(false);
	}, [query]);

	useEffect(() => { searchItems(''); }, []);


	useEffect(() => { searchRef.current?.focus(); }, []);

	const selectItem = async (entry) => {
		const result = await query('SELECT * FROM item_template WHERE entry = ?', [entry]);
		if (result.data?.[0]) {
			setSelected(result.data[0]);
			setForm(result.data[0]);
			setDirty(false);
			setMsg(null);
		}
	};

	const handleChange = (key, value) => {
		setForm(f => ({ ...f, [key]: value }));
		setDirty(true);
	};

	const handleCopy = async () => {
		if (!selected) return;
		setCopying(true);
		setMsg(null);
		try {
			const idResult = await findNextId({ table: 'item_template', idColumn: 'entry', startId: idRanges.item });
			if (!idResult.success) throw new Error(idResult.error);
			const newId = idResult.nextId;
			const fields = Object.keys(selected);
			const cols = fields.map(k => `\`${k}\``).join(', ');
			const vals = fields.map(k => k === 'entry' ? newId : selected[k]);
			const placeholders = fields.map(() => '?').join(', ');
			const result = await query(`INSERT INTO item_template (${cols}) VALUES (${placeholders})`, vals);
			if (!result.success) throw new Error(result.error);
			await searchItems(search);
			await selectItem(newId);
			setMsg({ type: 'success', text: `✓ Gekloond naar entry #${newId}` });
		} catch (e) {
			setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
		}
		setCopying(false);
	};

	const getFieldSections = () => [
		{ title: 'Basis Info', keys: ['entry', 'name', 'description'] },
		{ title: 'Classification', keys: ['class', 'subclass', 'Quality', 'InventoryType'] },
		{ title: 'Display', keys: ['displayid'] },
		{ title: 'Pricing', keys: ['BuyPrice', 'SellPrice', 'BuyCount'] },
		{ title: 'Requirements', keys: ['RequiredLevel', 'AllowableClass', 'AllowableRace'] },
		{ title: 'Stats', keys: ['ItemLevel', 'armor', 'dmg_min1', 'dmg_max1'] },
		{ title: 'Properties', keys: ['stackable', 'MaxCount', 'Flags', 'bonding'] },
		{ title: 'Bonuses', keys: ['stat_type1', 'stat_value1', 'stat_type2', 'stat_value2'] },
		{ title: 'Spells & Scripts', keys: ['spellid_1', 'PageText', 'ScriptName'] },
	];

	const handleSave = async () => {
		setSaving(true);
		setMsg(null);
		try {
			const fields = Object.keys(form).filter(k => k !== 'entry');
			const sets = fields.map(k => `\`${k}\` = ?`).join(', ');
			const vals = [...fields.map(k => form[k]), form.entry];
			const result = await query(`UPDATE item_template SET ${sets} WHERE entry = ?`, vals);
			if (result.success) {
				setSelected(form);
				setDirty(false);
				if (soapConfig.user) {
					await soapCommand(`.reload item_template`);
					setMsg({ type: 'success', text: `Saved & reloaded item ${form.entry}` });
				} else {
					setMsg({ type: 'success', text: `Saved item ${form.entry}.` });
				}
				searchItems(search);
			} else {
				setMsg({ type: 'error', text: result.error });
			}
		} catch (e) {
			setMsg({ type: 'error', text: e.message });
		}
		setSaving(false);
	};

	useEffect(() => {
		const handleKeyDown = (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 's') {
				e.preventDefault();
				if (dirty && selected) handleSave();
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [dirty, selected, handleSave]);

	return (
		<>
			<div className="editor-page-header">
				<h2 className="editor-page-title">Item Editor</h2>
				<p className="editor-page-subtitle">Manage item templates and properties</p>
			</div>
			<div className="editor-layout">
				<div className="editor-list">
					<div className="editor-list-header">
						<div className="search-box">
							<Search size={13} />
							<input
								ref={searchRef}
								placeholder="Search name or entry..."
								value={search}
								onChange={e => { setSearch(e.target.value); searchItems(e.target.value); }}
							/>
						</div>
					</div>
					<div className="list-items">
						{loading && <div className="loading-text">Searching...</div>}
						{!loading && items.map(item => (
							<div
								key={item.entry}
								className={`list-item ${selected?.entry === item.entry ? 'active' : ''}`}
								onClick={() => selectItem(item.entry)}
							>
								<div className="list-item-main">
									<span className="list-item-name" style={{ color: QUALITY_COLORS[item.Quality] || '#fff' }}>
										{item.name}
									</span>
									<ChevronRight size={12} className="list-item-arrow" />
								</div>
								<div className="list-item-meta">
									<span className="mono">#{item.entry}</span>
									<span>iLvl {item.ItemLevel}</span>
									<span style={{ color: QUALITY_COLORS[item.Quality] }}>
										{QUALITY_LABELS[item.Quality] || '?'}
									</span>
								</div>
							</div>
						))}
						{!loading && items.length === 0 && <div className="loading-text">No results</div>}
					</div>
				</div>

				<div className="editor-form">
					{!selected ? (
						<div className="editor-empty">
							<MousePointerClick />
							<p>Select an item to edit</p>
						</div>
					) : (
						<>
							<div className="page-header">
								<div>
									<h1 className="page-title" style={{ color: QUALITY_COLORS[selected.Quality] || 'var(--gold-bright)' }}>
										{selected.name}{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}
									</h1>
									<p className="page-sub">Entry #{selected.entry} · item_template</p>
								</div>
								<div className="header-actions">
									{dirty && <button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}><RotateCcw size={13} /> Reset</button>}
									<button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon dit record naar een nieuw ID">
										<Copy size={13} /> {copying ? 'Klonen...' : 'Copy'}
									</button>
									<button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
										<Save size={13} /> {saving ? 'Saving...' : 'Save & Reload'}
									</button>
								</div>
							</div>
							{msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
							<div className="form-fields">
								{getFieldSections().map((section, idx) => (
									<div key={idx}>
										<h4 className="field-section-title">{section.title}</h4>
										{section.keys.map(key => {
											const f = ITEM_FIELDS.find(fld => fld.key === key);
											if (!f) return null;
											return (
												<div key={f.key} className="field-group">
													<label>{f.label}</label>
													{f.type === 'select' ? (
														<select value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)}>
															{f.options.map(o => {
																const [val, lbl] = o.split(':');
																return <option key={val} value={val}>{lbl}</option>;
															})}
														</select>
													) : (
														<input
															type={f.type === 'decimal' ? 'number' : f.type}
															step={f.type === 'decimal' ? '0.01' : undefined}
															value={form[f.key] ?? ''}
															onChange={e => handleChange(f.key, e.target.value)}
															readOnly={f.readonly}
														/>
													)}
												</div>
											);
										})}
									</div>
								))}
							</div>
						</>
					)}
				</div>
			</div>
		</>
	);
}
