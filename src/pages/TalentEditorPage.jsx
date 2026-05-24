import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, RotateCcw, GitBranch, X, Search, Copy, Trash2, Plus } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import './TalentEditorPage.css';

const CLASSES = [
	{ id: 1,  name: 'Warrior',     color: '#C79C6E' },
	{ id: 2,  name: 'Paladin',     color: '#F58CBA' },
	{ id: 3,  name: 'Hunter',      color: '#ABD473' },
	{ id: 4,  name: 'Rogue',       color: '#FFF569' },
	{ id: 5,  name: 'Priest',      color: '#FFFFFF' },
	{ id: 6,  name: 'Death Knight',color: '#C41E3A' },
	{ id: 7,  name: 'Shaman',      color: '#0070DE' },
	{ id: 8,  name: 'Mage',        color: '#69CCF0' },
	{ id: 9,  name: 'Warlock',     color: '#9482C9' },
	{ id: 11, name: 'Druid',       color: '#FF7D0A' },
];

const CELL       = 60;
const GAP        = 10;
const MAX_TIERS  = 15;
const MAX_COLS   = 4;

// ─── Prereq validatie ──────────────────────────────────────────────────────
function canMoveTalent(talent, newTier, allTalents) {
	for (let i = 1; i <= 3; i++) {
		const prereqId = talent[`PrereqTalent_${i}`];
		if (!prereqId) continue;
		const prereq = allTalents.find(t => t.ID === prereqId);
		if (prereq && (prereq.TierID || 0) >= newTier)
			return { ok: false, reason: `Prereq talent #${prereqId} staat op rij ${prereq.TierID}, moet lager zijn dan rij ${newTier}.` };
	}
	for (const other of allTalents) {
		if (other.ID === talent.ID) continue;
		for (let i = 1; i <= 3; i++) {
			if (other[`PrereqTalent_${i}`] === talent.ID && (other.TierID || 0) <= newTier)
				return { ok: false, reason: `Talent #${other.ID} gebruikt dit als prereq en staat op rij ${other.TierID} (moet hoger zijn dan rij ${newTier}).` };
		}
	}
	return { ok: true };
}

export default function TalentEditorPage() {
	const {
		readTalentTabs, readTalents, readSpells, readSpellIcons,
		saveTalent, getIcon, deleteTalent, insertTalent,
		findNextTalentId, copyTalentDbc, idRanges,
	} = useConnection();

	const [selectedClass,      setSelectedClass]      = useState(null);
	const [tabs,               setTabs]               = useState([]);
	const [activeTab,          setActiveTab]          = useState(null);
	const [talents,            setTalents]            = useState([]);
	const [spellNames,         setSpellNames]         = useState({});
	const [spellIcons,         setSpellIcons]         = useState({});
	const [iconToSpellId,      setIconToSpellId]      = useState({});
	const [selected,           setSelected]           = useState(null);
	const [isNew,              setIsNew]              = useState(false);
	const [form,               setForm]               = useState({});
	const [dirty,              setDirty]              = useState(false);
	const [saving,             setSaving]             = useState(false);
	const [copying,            setCopying]            = useState(false);
	const [deleting,           setDeleting]           = useState(false);
	const [confirmDelete,      setConfirmDelete]      = useState(false);
	const [msg,                setMsg]                = useState(null);
	const [loadError,          setLoadError]          = useState(null);
	const [showSpellPicker,    setShowSpellPicker]    = useState(false);
	const [pickingRank,        setPickingRank]        = useState(null);
	const [spellSearchTerm,    setSpellSearchTerm]    = useState('');
	const [primarySpellIconId, setPrimarySpellIconId] = useState(null);
	const [dragTalentId,       setDragTalentId]       = useState(null);
	const [dragOver,           setDragOver]           = useState(null); // { row, col }

	// ─── laden ───────────────────────────────────────────────────────────────
	const loadTabs = useCallback(async (cls) => {
		setLoadError(null);
		const result = await readTalentTabs();
		if (!result.success) { setLoadError(result.error); setTabs([]); return; }
		const allTabs = result.data || [];
		const classMask = 1 << (cls.id - 1);
		const data = allTabs
			.filter(t => (t.ClassMask & classMask) !== 0)
			.sort((a, b) => (a.OrderIndex || 0) - (b.OrderIndex || 0));
		setTabs(data);
		setActiveTab(data[0] ?? null);
		setTalents([]);
		setSelected(null);
		setSpellNames({});
		setSpellIcons({});
	}, [readTalentTabs]);

	const loadTalents = useCallback(async (tabId) => {
		setLoadError(null);
		const result = await readTalents(tabId);
		if (!result.success) { setLoadError(result.error); setTalents([]); return; }
		const data = (result.data || []).sort((a, b) =>
			(a.TierID || 0) !== (b.TierID || 0)
				? (a.TierID || 0) - (b.TierID || 0)
				: (a.ColumnIndex || 0) - (b.ColumnIndex || 0)
		);
		setTalents(data);
		setSelected(null);
		setIsNew(false);

		const ids = [];
		data.forEach(t => {
			for (let i = 1; i <= 9; i++) { if (t[`SpellRank_${i}`] > 0) ids.push(t[`SpellRank_${i}`]); }
		});
		if (!ids.length) { setSpellNames({}); setSpellIcons({}); return; }

		const uniqueIds = [...new Set(ids)];
		const spellsResult = await readSpells(uniqueIds);
		if (!spellsResult.success) return;

		const names = {};
		const iconIds = new Set();
		const iconIndex = {};
		for (const spellId of uniqueIds) {
			const spell = spellsResult.data?.[spellId];
			if (spell) {
				names[spellId] = spell.name;
				if (spell.spellIconId) {
					iconIds.add(spell.spellIconId);
					if (!iconIndex[spell.spellIconId]) iconIndex[spell.spellIconId] = spellId;
				}
			}
		}
		setSpellNames(names);
		setIconToSpellId(iconIndex);

		if (!iconIds.size) return;
		const iconsResult = await readSpellIcons([...iconIds]);
		if (!iconsResult.success) return;

		const icons = {};
		for (const spellId of uniqueIds) {
			const spell = spellsResult.data?.[spellId];
			if (spell?.spellIconId) {
				const filename = iconsResult.data?.[spell.spellIconId];
				if (filename) {
					const url = await getIcon(filename);
					if (url) icons[spellId] = url;
				}
			}
		}
		setSpellIcons(icons);
	}, [readTalents, readSpells, readSpellIcons, getIcon]);

	useEffect(() => { if (selectedClass) loadTabs(selectedClass); }, [selectedClass, loadTabs]);
	useEffect(() => { if (activeTab) loadTalents(activeTab.ID); }, [activeTab, loadTalents]);

	// ─── selectie ────────────────────────────────────────────────────────────
	const selectTalent = (t) => {
		setSelected(t);
		setIsNew(false);
		setForm({ ...t });
		setDirty(false);
		setMsg(null);
		setConfirmDelete(false);
	};

	const selectEmpty = (row, col) => {
		const blank = {
			ID: 0,
			TabID: activeTab?.ID || 0,
			TierID: row,
			ColumnIndex: col,
			SpellRank_1: 0, SpellRank_2: 0, SpellRank_3: 0, SpellRank_4: 0,
			SpellRank_5: 0, SpellRank_6: 0, SpellRank_7: 0, SpellRank_8: 0, SpellRank_9: 0,
			PrereqTalent_1: 0, PrereqTalent_2: 0, PrereqTalent_3: 0,
			PrereqRank_1: 0,   PrereqRank_2: 0,   PrereqRank_3: 0,
		};
		setSelected(blank);
		setIsNew(true);
		setForm(blank);
		setDirty(false);
		setMsg(null);
		setConfirmDelete(false);
	};

	const handleChange = (key, val) => {
		setForm(f => ({ ...f, [key]: val }));
		setDirty(true);
	};

	// ─── opslaan ─────────────────────────────────────────────────────────────
	const handleSave = useCallback(async () => {
		setSaving(true);
		setMsg(null);
		try {
			let result;
			if (isNew) {
				// Nieuw talent: eerst vrij ID ophalen
				const idResult = await findNextTalentId(idRanges.talent);
				if (!idResult.success) throw new Error(idResult.error);
				const newId = idResult.nextId;
				const newTalent = { ...form, ID: newId };
				result = await insertTalent(newTalent);
				if (result.success) {
					setMsg({ type: 'success', text: `✓ Nieuw talent #${newId} aangemaakt in DBC.` });
					await loadTalents(activeTab.ID);
					setIsNew(false);
				}
			} else {
				result = await saveTalent(form);
				if (result.success) {
					setSelected(form);
					setDirty(false);
					setMsg({ type: 'success', text: `✓ Talent #${form.ID} opgeslagen in Talent.dbc.` });
					if (activeTab) setTimeout(() => loadTalents(activeTab.ID), 300);
				}
			}
			if (!result.success) setMsg({ type: 'error', text: result.error });
		} catch (e) {
			setMsg({ type: 'error', text: e.message });
		}
		setSaving(false);
	}, [form, isNew, saveTalent, insertTalent, findNextTalentId, idRanges, activeTab, loadTalents]);

	useEffect(() => {
		const down = (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 's') {
				e.preventDefault();
				if (dirty && selected) handleSave();
			}
		};
		window.addEventListener('keydown', down);
		return () => window.removeEventListener('keydown', down);
	}, [dirty, selected, handleSave]);

	// ─── verwijderen ──────────────────────────────────────────────────────────
	const handleDelete = async () => {
		if (!selected || isNew) return;
		setDeleting(true);
		setMsg(null);
		try {
			const result = await deleteTalent(selected.ID);
			if (result.success) {
				setMsg({ type: 'success', text: `✓ Talent #${selected.ID} verwijderd uit DBC.` });
				setSelected(null);
				setIsNew(false);
				setConfirmDelete(false);
				if (activeTab) await loadTalents(activeTab.ID);
			} else {
				setMsg({ type: 'error', text: result.error });
			}
		} catch (e) {
			setMsg({ type: 'error', text: e.message });
		}
		setDeleting(false);
	};

	// ─── kopiëren ────────────────────────────────────────────────────────────
	const handleCopy = async () => {
		if (!selected || isNew) return;
		setCopying(true);
		setMsg(null);
		try {
			const idResult = await findNextTalentId(idRanges.talent);
			if (!idResult.success) throw new Error(idResult.error);
			const newId = idResult.nextId;
			const result = await copyTalentDbc(selected.ID, newId);
			if (!result.success) throw new Error(result.error);
			setMsg({ type: 'success', text: `✓ Talent gekloond naar ID #${newId}` });
			if (activeTab) {
				await loadTalents(activeTab.ID);
				selectTalent({ ...selected, ID: newId });
			}
		} catch (e) {
			setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
		}
		setCopying(false);
	};

	// ─── drag & drop ─────────────────────────────────────────────────────────
	const handleDragStart = (e, talent) => {
		setDragTalentId(talent.ID);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = (e, row, col) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setDragOver({ row, col });
	};

	const handleDragLeave = () => setDragOver(null);

	const handleDrop = async (e, dstRow, dstCol) => {
		e.preventDefault();
		setDragOver(null);
		if (dragTalentId == null) return;

		const src = talents.find(t => t.ID === dragTalentId);
		setDragTalentId(null);
		if (!src) return;
		if (src.TierID === dstRow && src.ColumnIndex === dstCol) return;

		// Bezet?
		const occupied = talents.find(t => t.ID !== src.ID && (t.TierID || 0) === dstRow && (t.ColumnIndex || 0) === dstCol);
		if (occupied) {
			setMsg({ type: 'error', text: `Positie (rij ${dstRow}, kolom ${dstCol}) is al bezet door talent #${occupied.ID}.` });
			return;
		}

		// Prereq-validatie
		const { ok, reason } = canMoveTalent(src, dstRow, talents);
		if (!ok) { setMsg({ type: 'error', text: reason }); return; }

		const updated = { ...src, TierID: dstRow, ColumnIndex: dstCol };
		const result = await saveTalent(updated);
		if (result.success) {
			setMsg({ type: 'success', text: `✓ Talent #${src.ID} verplaatst naar rij ${dstRow}, kolom ${dstCol}.` });
			await loadTalents(activeTab.ID);
		} else {
			setMsg({ type: 'error', text: result.error });
		}
	};

	// ─── spell picker ────────────────────────────────────────────────────────
	const availableSpells = Object.entries(spellNames)
		.map(([id, name]) => ({ spellId: parseInt(id), name, icon: spellIcons[parseInt(id)] }))
		.filter(s => s.name.toLowerCase().includes(spellSearchTerm.toLowerCase()) || s.spellId.toString().includes(spellSearchTerm))
		.sort((a, b) => a.spellId - b.spellId);

	const handleSelectSpell = (spellId) => {
		if (pickingRank) {
			handleChange(`SpellRank_${pickingRank}`, spellId);
			setShowSpellPicker(false);
			setSpellSearchTerm('');
			setPickingRank(null);
		}
	};

	// ─── primaire spell iconID helper ────────────────────────────────────────
	const primarySpellId = form.SpellRank_1 > 0 ? form.SpellRank_1 : null;
	const ranksWithPrimarySpell = primarySpellId
		? [1,2,3,4,5,6,7,8,9].filter(i => form[`SpellRank_${i}`] === primarySpellId)
		: [];

	const handleChangePrimarySpell = (newSpellId) => {
		ranksWithPrimarySpell.forEach(r => handleChange(`SpellRank_${r}`, newSpellId));
	};

	const handleBlurSpellIconId = async (newIconId) => {
		if (!newIconId || newIconId === primarySpellIconId) return;
		const spellIdWithIcon = iconToSpellId[newIconId];
		if (!spellIdWithIcon || !ranksWithPrimarySpell.length) return;
		setPrimarySpellIconId(newIconId);
		setDirty(true);
		const iconResult = await readSpellIcons([newIconId]);
		if (iconResult.success) {
			const filename = iconResult.data?.[newIconId];
			if (filename) {
				const url = await getIcon(filename);
				if (url) setSpellIcons(prev => ({ ...prev, [spellIdWithIcon]: url }));
			}
		}
		ranksWithPrimarySpell.forEach(r => setForm(f => ({ ...f, [`SpellRank_${r}`]: spellIdWithIcon })));
	};

	useEffect(() => {
		if (!primarySpellId) return;
		readSpells([primarySpellId]).then(result => {
			if (!result.success) return;
			const spell = result.data?.[primarySpellId];
			if (!spell?.spellIconId) return;
			setPrimarySpellIconId(spell.spellIconId);
			if (!spellIcons[primarySpellId]) {
				readSpellIcons([spell.spellIconId]).then(ir => {
					if (!ir.success) return;
					const filename = ir.data?.[spell.spellIconId];
					if (filename) getIcon(filename).then(url => {
						if (url) setSpellIcons(prev => ({ ...prev, [primarySpellId]: url }));
					});
				});
			}
		});
	}, [primarySpellId]); // eslint-disable-line

	// ─── grid hulpdata ───────────────────────────────────────────────────────
	const talentAt = (row, col) => talents.find(t => (t.TierID || 0) === row && (t.ColumnIndex || 0) === col);
	const treeW = MAX_COLS * (CELL + GAP) - GAP;
	const treeH = MAX_TIERS * (CELL + GAP) - GAP;

	// ─── render ──────────────────────────────────────────────────────────────
	return (
		<div className="talent-layout fade-in">
			{/* ── Class sidebar ── */}
			<div className="talent-class-list">
				<div className="talent-section-label">Classes</div>
				{CLASSES.map(cls => (
					<div
						key={cls.id}
						className={`talent-class-item ${selectedClass?.id === cls.id ? 'active' : ''}`}
						style={{ '--cls-color': cls.color }}
						onClick={() => setSelectedClass(cls)}
					>
						<span className="talent-class-dot" />
						<span>{cls.name}</span>
					</div>
				))}
			</div>

			{/* ── Tree canvas ── */}
			<div className="talent-tree-area">
				{loadError && (
					<div className="editor-msg error" style={{ margin: '16px 16px 0' }}>
						Laad Error: {loadError}
					</div>
				)}
				{!selectedClass ? (
					<div className="editor-empty"><p>Selecteer een class</p></div>
				) : (
					<>
						<div className="talent-tabs">
							{tabs.map(tab => (
								<button
									key={tab.ID}
									className={`talent-tab-btn ${activeTab?.ID === tab.ID ? 'active' : ''}`}
									onClick={() => setActiveTab(tab)}
								>
									{tab.Name_Lang_enUS}
								</button>
							))}
							{tabs.length === 0 && <span className="talent-no-tabs">Geen talent tabs gevonden</span>}
						</div>

						<div className="talent-tree-scroll">
							{activeTab && (
								<div className="talent-tree" style={{ width: treeW, height: treeH }}>
									{/* ── SVG prereq pijlen ── */}
									<svg width={treeW} height={treeH} className="talent-arrows" style={{ overflow: 'visible' }}>
										<defs>
											<marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
												<path d="M0,0 L6,3 L0,6 Z" fill="#d32f2f" />
											</marker>
										</defs>
										{talents.map(t => {
											const pid = t.PrereqTalent_1;
											if (!pid) return null;
											const pre = talents.find(x => x.ID === pid);
											if (!pre) return null;
											return (
												<line
													key={`arrow-${pid}-${t.ID}`}
													x1={(pre.ColumnIndex || 0) * (CELL + GAP) + CELL / 2}
													y1={(pre.TierID || 0) * (CELL + GAP) + CELL}
													x2={(t.ColumnIndex || 0) * (CELL + GAP) + CELL / 2}
													y2={(t.TierID || 0) * (CELL + GAP)}
													className="talent-prereq-line"
													markerEnd="url(#arrowhead)"
												/>
											);
										})}
									</svg>

									{/* ── Volledige 15×4 grid (lege + gevulde cellen) ── */}
									{Array.from({ length: MAX_TIERS }).map((_, row) =>
										Array.from({ length: MAX_COLS }).map((_, col) => {
											const t = talentAt(row, col);
											const isDragSrc  = t && dragTalentId === t.ID;
											const isDragDst  = dragOver?.row === row && dragOver?.col === col;
											const isSelected = selected && (t ? selected.ID === t.ID : isNew && selected.TierID === row && selected.ColumnIndex === col);

											if (t) {
												// Gevulde cel — talent node
												const spellId = t.SpellRank_1;
												const name    = spellNames[spellId] || `#${t.ID}`;
												const icon    = spellIcons[spellId];
												const maxRank = [1,2,3,4,5,6,7,8,9].reduce((m, i) => t[`SpellRank_${i}`] ? i : m, 0);
												return (
													<div
														key={`node-${t.ID}`}
														className={`talent-node${isSelected ? ' selected' : ''}${isDragSrc ? ' dragging' : ''}${isDragDst ? ' drag-over' : ''}`}
														style={{
															left: col * (CELL + GAP),
															top: row * (CELL + GAP),
															width: CELL, height: CELL,
															backgroundImage: icon ? `url(${icon})` : 'none',
															backgroundSize: 'cover',
															backgroundPosition: 'center',
														}}
														draggable
														onDragStart={e => handleDragStart(e, t)}
														onDragOver={e => handleDragOver(e, row, col)}
														onDragLeave={handleDragLeave}
														onDrop={e => handleDrop(e, row, col)}
														onClick={() => selectTalent(t)}
														title={`${name} (${maxRank} ranks) — Tier ${row}, Kolom ${col}`}
													>
														<span className="talent-node-rank">{maxRank}</span>
														{!icon && <span className="talent-node-name">
															{name.length > 10 ? name.slice(0, 10) + '…' : name}
														</span>}
													</div>
												);
											} else {
												// Lege cel
												return (
													<div
														key={`empty-${row}-${col}`}
														className={`talent-grid-cell${isDragDst ? ' drag-over' : ''}${isSelected ? ' selected-empty' : ''}`}
														style={{
															left: col * (CELL + GAP),
															top: row * (CELL + GAP),
															width: CELL, height: CELL,
														}}
														onDragOver={e => handleDragOver(e, row, col)}
														onDragLeave={handleDragLeave}
														onDrop={e => handleDrop(e, row, col)}
														onClick={() => selectEmpty(row, col)}
														title={`Leeg slot — Tier ${row}, Kolom ${col}`}
													>
														<span className="grid-cell-plus">+</span>
													</div>
												);
											}
										})
									)}
								</div>
							)}
							{!activeTab && <div className="editor-empty"><p>Geen talent tab geselecteerd</p></div>}
						</div>
					</>
				)}
			</div>

			{/* ── Edit panel ── */}
			<div className="talent-edit-panel">
				{!selected ? (
					<div className="editor-empty"><p>Klik op een talent of leeg slot om te bewerken</p></div>
				) : (
					<>
						<div className="panel-header">
							{isNew ? <Plus size={14} /> : <GitBranch size={14} />}
							<span>
								{isNew
									? `Nieuw talent (rij ${form.TierID}, kol ${form.ColumnIndex})`
									: `Talent #${selected.ID}${dirty ? ' ●' : ''}`}
							</span>
						</div>

						<div className="talent-edit-actions">
							{!isNew && (
								<button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }} disabled={!dirty}>
									<RotateCcw size={13} /> Reset
								</button>
							)}
							{!isNew && (
								<button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Clone this talent to a new ID">
									<Copy size={13} /> {copying ? 'Cloning...' : 'Copy'}
								</button>
							)}
							<button className="btn-primary" onClick={handleSave} disabled={saving || (!dirty && !isNew)}>
								<Save size={13} /> {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
							</button>

							{/* Delete — uiterst rechts */}
							{!isNew && (
								<div className="talent-delete-inline">
									{!confirmDelete ? (
										<button className="btn-ghost" onClick={() => setConfirmDelete(true)} title="Delete this talent">
											<Trash2 size={13} /> Delete
										</button>
									) : (
										<>
											<span className="delete-confirm-label">Sure?</span>
											<button className="btn-ghost btn-ghost-confirm" onClick={handleDelete} disabled={deleting}>
												{deleting ? '...' : 'Yes'}
											</button>
											<button className="btn-ghost" onClick={() => setConfirmDelete(false)}>No</button>
										</>
									)}
								</div>
							)}
						</div>

						{msg && <div className={`editor-msg ${msg.type}`} style={{ margin: '0 14px 4px' }}>{msg.text}</div>}

						<div className="talent-edit-fields">
							{/* Spell Icon */}
							{primarySpellId > 0 && (
								<>
									<div className="talent-edit-section">Spell Icon</div>
									<div className="field-group spell-icon-master">
										<label>
											Spell Icon ID
											{spellNames[primarySpellId] && <span className="field-spell-hint"> — {spellNames[primarySpellId]}</span>}
											<span className="spell-icon-ranks"> ({ranksWithPrimarySpell.length} rank{ranksWithPrimarySpell.length !== 1 ? 's' : ''})</span>
										</label>
										<div className="spell-icon-input-group">
											{spellIcons[primarySpellId] && (
												<img src={spellIcons[primarySpellId]} alt="icon" className="spell-icon-master-preview" />
											)}
											<input
												type="number"
												value={primarySpellIconId ?? 0}
												onChange={e => setPrimarySpellIconId(+e.target.value)}
												onBlur={e => handleBlurSpellIconId(+e.target.value)}
												placeholder="Icon ID"
											/>
										</div>
									</div>
								</>
							)}

							{/* Positie */}
							<div className="talent-edit-section">Positie</div>
							<div className="field-group">
								<label>Tier (Rij)</label>
								<input type="number" min="0" max="14" value={form.TierID ?? ''} onChange={e => handleChange('TierID', +e.target.value)} />
							</div>
							<div className="field-group">
								<label>Kolom</label>
								<input type="number" min="0" max="3" value={form.ColumnIndex ?? ''} onChange={e => handleChange('ColumnIndex', +e.target.value)} />
							</div>

							{/* Prerequisite */}
							<div className="talent-edit-section">Prerequisite</div>
							<div className="field-group">
								<label>Prereq Talent 1</label>
								<input type="number" value={form.PrereqTalent_1 ?? 0} onChange={e => handleChange('PrereqTalent_1', +e.target.value)} />
							</div>
							<div className="field-group">
								<label>Prereq Rank 1</label>
								<input type="number" value={form.PrereqRank_1 ?? 0} onChange={e => handleChange('PrereqRank_1', +e.target.value)} />
							</div>

							{/* Spell IDs */}
							<div className="talent-edit-section">Spell IDs per Rank</div>
							{[1,2,3,4,5].map(i => {
								const spellId = form[`SpellRank_${i}`];
								const hint = spellNames[spellId];
								return (
									<div key={i} className="field-group">
										<label>
											Rank {i}
											{hint && <span className="field-spell-hint"> — {hint}</span>}
										</label>
										<input
											type="number"
											value={spellId ?? 0}
											onChange={e => handleChange(`SpellRank_${i}`, +e.target.value)}
											placeholder="Spell ID"
										/>
									</div>
								);
							})}
						</div>
					</>
				)}
			</div>

			{/* ── Spell Picker Modal ── */}
			{showSpellPicker && (
				<div className="spell-picker-modal">
					<div className="spell-picker-overlay" onClick={() => setShowSpellPicker(false)} />
					<div className="spell-picker-panel">
						<div className="spell-picker-header">
							<h3>Selecteer Spell voor Rank {pickingRank}</h3>
							<button className="spell-picker-close" onClick={() => setShowSpellPicker(false)}><X size={16} /></button>
						</div>
						<div className="spell-picker-search">
							<Search size={14} />
							<input
								type="text"
								placeholder="Zoek op naam of spell ID..."
								value={spellSearchTerm}
								onChange={e => setSpellSearchTerm(e.target.value)}
								autoFocus
							/>
						</div>
						<div className="spell-picker-list">
							{availableSpells.map(spell => (
								<div key={spell.spellId} className="spell-picker-item" onClick={() => handleSelectSpell(spell.spellId)}>
									{spell.icon && <img src={spell.icon} alt={spell.name} className="spell-picker-icon" />}
									<div className="spell-picker-info">
										<div className="spell-picker-name">{spell.name}</div>
										<div className="spell-picker-id">#{spell.spellId}</div>
									</div>
								</div>
							))}
							{availableSpells.length === 0 && <div className="spell-picker-empty">Geen spells gevonden</div>}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
