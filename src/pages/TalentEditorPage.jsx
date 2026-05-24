import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, RotateCcw, GitBranch, X, Search, Copy } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import './TalentEditorPage.css';

const CLASSES = [
	{ id: 1, name: 'Warrior', color: '#C79C6E' },
	{ id: 2, name: 'Paladin', color: '#F58CBA' },
	{ id: 3, name: 'Hunter', color: '#ABD473' },
	{ id: 4, name: 'Rogue', color: '#FFF569' },
	{ id: 5, name: 'Priest', color: '#FFFFFF' },
	{ id: 6, name: 'Death Knight', color: '#C41E3A' },
	{ id: 7, name: 'Shaman', color: '#0070DE' },
	{ id: 8, name: 'Mage', color: '#69CCF0' },
	{ id: 9, name: 'Warlock', color: '#9482C9' },
	{ id: 11, name: 'Druid', color: '#FF7D0A' },
];

const CELL = 60;
const GAP = 10;

export default function TalentEditorPage() {
	const { readTalentTabs, readTalents, readSpells, readSpellIcons, saveTalent, getIcon, writeTalent, findNextTalentId, copyTalentDbc, idRanges } = useConnection();
	const [selectedClass, setSelectedClass] = useState(null);
	const [tabs, setTabs] = useState([]);
	const [activeTab, setActiveTab] = useState(null);
	const [talents, setTalents] = useState([]);
	const [spellNames, setSpellNames] = useState({});
	const [spellIcons, setSpellIcons] = useState({});
	const [iconToSpellId, setIconToSpellId] = useState({}); // reverse index: iconId → spellId
	const [selected, setSelected] = useState(null);
	const [form, setForm] = useState({});
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [committing, setCommitting] = useState(false);
	const [copying, setCopying] = useState(false);
	const [msg, setMsg] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [showSpellPicker, setShowSpellPicker] = useState(false);
	const [pickingRank, setPickingRank] = useState(null);
	const [spellSearchTerm, setSpellSearchTerm] = useState('');
	const [primarySpellIconId, setPrimarySpellIconId] = useState(null);

	const loadTabs = useCallback(async (cls) => {
		setLoadError(null);
		const result = await readTalentTabs();
		if (!result.success) {
			setLoadError(result.error);
			setTabs([]);
			return;
		}
		const allTabs = result.data || [];
		const classMask = 1 << (cls.id - 1);
		console.log(`Loading tabs for ${cls.name} (id=${cls.id}), classMask=${classMask} (binary: ${classMask.toString(2)})`);
		const data = allTabs.filter(t => {
			const match = (t.ClassMask & classMask) !== 0;
			if (match) console.log(`  ✓ Tab ${t.ID} "${t.Name_Lang_enUS}" ClassMask=${t.ClassMask}`);
			return match;
		}).sort((a, b) => (a.OrderIndex || 0) - (b.OrderIndex || 0));
		console.log(`Filtered to ${data.length} tabs for ${cls.name}`);
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
		if (!result.success) {
			setLoadError(result.error);
			setTalents([]);
			return;
		}
		const data = (result.data || []).sort((a, b) => {
			if ((a.TierID || 0) !== (b.TierID || 0)) return (a.TierID || 0) - (b.TierID || 0);
			return (a.ColumnIndex || 0) - (b.ColumnIndex || 0);
		});
		setTalents(data);
		setSelected(null);

		const ids = [];
		data.forEach(t => {
			for (let i = 1; i <= 9; i++) {
				const id = t[`SpellRank_${i}`];
				if (id > 0) ids.push(id);
			}
		});
		console.log(`[TalentEditorPage] TabID ${tabId}: found ${data.length} talents with ${new Set(ids).size} unique spell IDs`);

		if (ids.length) {
			const uniqueIds = Array.from(new Set(ids));
			console.log(`[TalentEditorPage] Loading spell data for spell IDs:`, uniqueIds.slice(0, 5));
			const spellsResult = await readSpells(uniqueIds);
			if (spellsResult.success) {
				// Extract spell names for display
				const names = {};
				const iconIds = new Set();
				const iconIndex = {}; // reverse index: iconId → spellId
				for (const spellId of uniqueIds) {
					const spell = spellsResult.data?.[spellId];
					if (spell) {
						names[spellId] = spell.name;
						console.log(`  Spell ${spellId}: "${spell.name}" iconId=${spell.spellIconId}`);
						if (spell.spellIconId) {
							iconIds.add(spell.spellIconId);
							// Build reverse index (only first spell per icon for now)
							if (!iconIndex[spell.spellIconId]) {
								iconIndex[spell.spellIconId] = spellId;
							}
						}
					}
				}
				setSpellNames(names);
				setIconToSpellId(iconIndex);

				// Load spell icon filenames
				if (iconIds.size > 0) {
					console.log(`[TalentEditorPage] Loading ${iconIds.size} icon filenames:`, Array.from(iconIds).slice(0, 5));
					const iconsResult = await readSpellIcons(Array.from(iconIds));
					if (iconsResult.success) {
						console.log(`[TalentEditorPage] Got icon filenames:`, iconsResult.data);
						const icons = {};
						for (const spellId of uniqueIds) {
							const spell = spellsResult.data?.[spellId];
							if (spell && spell.spellIconId) {
								const iconFilename = iconsResult.data?.[spell.spellIconId];
								if (iconFilename) {
									console.log(`  Loading icon file: ${iconFilename}`);
									const iconUrl = await getIcon(iconFilename);
									if (iconUrl) {
										icons[spellId] = iconUrl;
										console.log(`    ✓ Got data URL for ${iconFilename}`);
									} else {
										console.log(`    ✗ Failed to load ${iconFilename}`);
									}
								}
							}
						}
						console.log(`[TalentEditorPage] Loaded ${Object.keys(icons).length} icon images`);
						setSpellIcons(icons);
					}
				}
			}
		} else {
			setSpellNames({});
			setSpellIcons({});
		}
	}, [readTalents, readSpells, readSpellIcons, getIcon]);

	useEffect(() => { if (selectedClass) loadTabs(selectedClass); }, [selectedClass, loadTabs]);
	useEffect(() => { if (activeTab) loadTalents(activeTab.ID); }, [activeTab, loadTalents]);


	const selectTalent = (t) => {
		setSelected(t);
		setForm({ ...t });
		setDirty(false);
		setMsg(null);
	};

	const handleChange = (key, val) => {
		setForm(f => ({ ...f, [key]: val }));
		setDirty(true);
	};

	const handleSave = async () => {
		setSaving(true);
		setMsg(null);
		try {
			const result = await saveTalent(form);
			if (result.success) {
				setSelected(form);
				setDirty(false);
				setMsg({ type: 'success', text: `Talent ${form.ID} opgeslagen in DBC-bestanden.` });
				if (activeTab) {
					setTimeout(() => loadTalents(activeTab.ID), 300);
				}
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

	const handleCopy = async () => {
		if (!selected) return;
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

	const handleSaveAll = async () => {
		setCommitting(true);
		setMsg(null);
		try {
			for (const talent of talents) {
				const result = await writeTalent(talent);
				if (!result.success) {
					setMsg({ type: 'error', text: `Fout bij talent ${talent.ID}: ${result.error}` });
					setCommitting(false);
					return;
				}
			}
			setMsg({ type: 'success', text: 'Alle talents opgeslagen in DBC-bestanden!' });
		} catch (e) {
			setMsg({ type: 'error', text: e.message });
		}
		setCommitting(false);
	};

	const maxRow = talents.reduce((m, t) => Math.max(m, t.TierID || 0), 0);
	const maxCol = talents.reduce((m, t) => Math.max(m, t.ColumnIndex || 0), 3);
	const treeW = (maxCol + 1) * (CELL + GAP) - GAP;
	const treeH = (maxRow + 1) * (CELL + GAP) - GAP;

	// Get available spells for picker (all spellNames with icons)
	const availableSpells = Object.entries(spellNames)
		.map(([spellId, name]) => ({
			spellId: parseInt(spellId),
			name,
			icon: spellIcons[parseInt(spellId)],
		}))
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

	// Get primary spell (first filled rank)
	const primarySpellId = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(i => form[`SpellRank_${i}`] > 0)
		? form.SpellRank_1
		: null;

	// Get all ranks that have the primary spell
	const ranksWithPrimarySpell = primarySpellId
		? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(i => form[`SpellRank_${i}`] === primarySpellId)
		: [];

	// Handle primary spell change — update all ranks with that spell
	const handleChangePrimarySpell = (newSpellId) => {
		if (ranksWithPrimarySpell.length > 0) {
			ranksWithPrimarySpell.forEach(rank => {
				handleChange(`SpellRank_${rank}`, newSpellId);
			});
			// Update selected talent preview for live tree update
			if (selected) {
				setSelected(prev => ({
					...prev,
					SpellRank_1: newSpellId,
					SpellRank_2: prev.SpellRank_2 === primarySpellId ? newSpellId : prev.SpellRank_2,
					SpellRank_3: prev.SpellRank_3 === primarySpellId ? newSpellId : prev.SpellRank_3,
					SpellRank_4: prev.SpellRank_4 === primarySpellId ? newSpellId : prev.SpellRank_4,
					SpellRank_5: prev.SpellRank_5 === primarySpellId ? newSpellId : prev.SpellRank_5,
					SpellRank_6: prev.SpellRank_6 === primarySpellId ? newSpellId : prev.SpellRank_6,
					SpellRank_7: prev.SpellRank_7 === primarySpellId ? newSpellId : prev.SpellRank_7,
					SpellRank_8: prev.SpellRank_8 === primarySpellId ? newSpellId : prev.SpellRank_8,
					SpellRank_9: prev.SpellRank_9 === primarySpellId ? newSpellId : prev.SpellRank_9,
				}));
			}
		}
	};

	// Handle spell icon ID change — triggers on blur to allow editing without instant reset
	const handleBlurSpellIconId = async (newIconId) => {
		if (!newIconId) return;

		const iconIdNum = +newIconId;
		if (iconIdNum === primarySpellIconId) return; // No change

		// Reverse lookup: use iconToSpellId index to find a spell with this iconID
		const spellIdWithIcon = iconToSpellId[iconIdNum];
		if (!spellIdWithIcon || ranksWithPrimarySpell.length === 0) {
			// Icon not found or no ranks to update
			return;
		}

		// Update state
		setPrimarySpellIconId(iconIdNum);
		setDirty(true);

		// Load icon preview for this iconID
		const iconResult = await readSpellIcons([iconIdNum]);
		if (iconResult.success) {
			const iconFilename = iconResult.data?.[iconIdNum];
			if (iconFilename) {
				const iconUrl = await getIcon(iconFilename);
				if (iconUrl) {
					setSpellIcons(prev => ({ ...prev, [spellIdWithIcon]: iconUrl }));
				}
			}
		}

		// Update all ranks with the new spell
		ranksWithPrimarySpell.forEach(rank => {
			setForm(f => ({ ...f, [`SpellRank_${rank}`]: spellIdWithIcon }));
		});

		// Update selected talent preview
		if (selected) {
			setSelected(prev => ({
				...prev,
				SpellRank_1: spellIdWithIcon,
				SpellRank_2: prev.SpellRank_2 === primarySpellId ? spellIdWithIcon : prev.SpellRank_2,
				SpellRank_3: prev.SpellRank_3 === primarySpellId ? spellIdWithIcon : prev.SpellRank_3,
				SpellRank_4: prev.SpellRank_4 === primarySpellId ? spellIdWithIcon : prev.SpellRank_4,
				SpellRank_5: prev.SpellRank_5 === primarySpellId ? spellIdWithIcon : prev.SpellRank_5,
				SpellRank_6: prev.SpellRank_6 === primarySpellId ? spellIdWithIcon : prev.SpellRank_6,
				SpellRank_7: prev.SpellRank_7 === primarySpellId ? spellIdWithIcon : prev.SpellRank_7,
				SpellRank_8: prev.SpellRank_8 === primarySpellId ? spellIdWithIcon : prev.SpellRank_8,
				SpellRank_9: prev.SpellRank_9 === primarySpellId ? spellIdWithIcon : prev.SpellRank_9,
			}));
		}
	};

	// Auto-load spell icon ID and icon preview when primary spell changes
	useEffect(() => {
		if (primarySpellId) {
			// Fetch spell data to get spellIconId
			readSpells([primarySpellId]).then(result => {
				if (result.success) {
					const spellData = result.data?.[primarySpellId];
					if (spellData?.spellIconId) {
						setPrimarySpellIconId(spellData.spellIconId);

						// Load icon if not already cached
						if (!spellIcons[primarySpellId]) {
							readSpellIcons([spellData.spellIconId]).then(iconResult => {
								if (iconResult.success) {
									const iconFilename = iconResult.data?.[spellData.spellIconId];
									if (iconFilename) {
										getIcon(iconFilename).then(iconUrl => {
											if (iconUrl) {
												setSpellIcons(prev => ({ ...prev, [primarySpellId]: iconUrl }));
											}
										});
									}
								}
							});
						}
					}
				}
			});
		}
	}, [primarySpellId, readSpells, readSpellIcons, getIcon, spellIcons]);

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
					<div className="editor-msg error" style={{ margin: '16px', marginBottom: '24px' }}>
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
							{tabs.length === 0 && (
								<span className="talent-no-tabs">Geen talent tabs gevonden voor deze class</span>
							)}
						</div>

						<div className="talent-tree-scroll">
							{activeTab && talents.length > 0 && (
								<div className="talent-tree" style={{ width: treeW, height: treeH }}>
									{/* Grid cells (dashed borders for empty slots) */}
									{Array.from({ length: (maxRow + 1) * (maxCol + 1) }).map((_, idx) => {
										const col = idx % (maxCol + 1);
										const row = Math.floor(idx / (maxCol + 1));
										return (
											<div
												key={`grid-${col}-${row}`}
												className="talent-grid-cell"
												style={{
													left: col * (CELL + GAP),
													top: row * (CELL + GAP),
													width: CELL,
													height: CELL,
												}}
											/>
										);
									})}

									{/* Prerequisite lines (SVG arrows) */}
									<svg width={treeW} height={treeH} className="talent-arrows" style={{ overflow: 'visible' }}>
										<defs>
											<marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
												<path d="M0,0 L6,3 L0,6 Z" fill="#d32f2f" />
											</marker>
										</defs>

										{talents.map(t => {
											const prereqTalentId = t.PrereqTalent_1;
											if (!prereqTalentId) return null;

											const prereqTalent = talents.find(talent => talent.ID === prereqTalentId);
											if (!prereqTalent) return null;

											const x1 = (prereqTalent.ColumnIndex || 0) * (CELL + GAP) + CELL / 2;
											const y1 = (prereqTalent.TierID || 0) * (CELL + GAP) + CELL;
											const x2 = (t.ColumnIndex || 0) * (CELL + GAP) + CELL / 2;
											const y2 = (t.TierID || 0) * (CELL + GAP);

											return (
												<line
													key={`prereq-${prereqTalentId}-${t.ID}`}
													x1={x1}
													y1={y1}
													x2={x2}
													y2={y2}
													className="talent-prereq-line"
													markerEnd="url(#arrowhead)"
												/>
											);
										})}
									</svg>

									{talents.map(t => {
										const spellId = t.SpellRank_1;
										const name = spellNames[spellId] || `#${t.ID}`;
										const icon = spellIcons[spellId];
										const isActive = selected?.ID === t.ID;
										const maxRank = [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((max, i) => t[`SpellRank_${i}`] ? i : max, 0);
										return (
											<div
												key={t.ID}
												className={`talent-node ${isActive ? 'selected' : ''}`}
												style={{
													left: (t.ColumnIndex || 0) * (CELL + GAP),
													top: (t.TierID || 0) * (CELL + GAP),
													width: CELL, height: CELL,
													backgroundImage: icon ? `url(${icon})` : 'none',
													backgroundSize: 'cover',
													backgroundPosition: 'center',
												}}
												onClick={() => selectTalent(t)}
												title={`${name} (${maxRank} ranks)`}
											>
												<span className="talent-node-rank">{maxRank}</span>
												{!icon && <span className="talent-node-name">
													{name.length > 10 ? name.slice(0, 10) + '…' : name}
												</span>}
											</div>
										);
									})}
								</div>
							)}
							{activeTab && talents.length === 0 && (
								<div className="editor-empty"><p>Geen talents in deze boom</p></div>
							)}
						</div>
					</>
				)}
			</div>

			{/* ── Edit panel ── */}
			<div className="talent-edit-panel">
				{!selected ? (
					<div className="editor-empty"><p>Selecteer een talent om te bewerken</p></div>
				) : (
					<>
						<div className="panel-header">
							<GitBranch size={14} />
							<span>Talent #{selected.ID}{dirty && <span style={{ color: 'var(--gold)', marginLeft: '8px' }}>●</span>}</span>
						</div>

						<div className="talent-edit-actions">
							{dirty && (
								<button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}>
									<RotateCcw size={13} /> Reset
								</button>
							)}
							<button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon dit talent naar een nieuw ID">
								<Copy size={13} /> {copying ? 'Klonen...' : 'Copy'}
							</button>
							<button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
								<Save size={13} /> {saving ? 'Opslaan…' : 'Save'}
							</button>
							<button className="btn-secondary" onClick={handleSaveAll} disabled={committing} title="Alle talents in deze tab opslaan">
								<Save size={13} /> {committing ? 'Opslaan…' : 'Export DBC'}
							</button>
						</div>

						{msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}

						<div className="talent-edit-fields">
							{primarySpellId && (
								<>
									<div className="talent-edit-section">Spell Icon</div>
									<div className="field-group spell-icon-master">
										<label>
											Spell Icon ID
											{spellNames[primarySpellId] && <span className="field-spell-hint"> — {spellNames[primarySpellId]}</span>}
											<span className="spell-icon-ranks"> ({ranksWithPrimarySpell.length} rank{ranksWithPrimarySpell.length !== 1 ? 's' : ''})</span>
										</label>
										<div className="spell-icon-input-group">
											{(spellIcons[primarySpellId]) &&
												<img
													src={spellIcons[primarySpellId]}
													alt="icon"
													className="spell-icon-master-preview"
												/>
											}
											<input
												type="number"
												value={primarySpellIconId ?? 0}
												onChange={e => setPrimarySpellIconId(+e.target.value)}
												onBlur={e => handleBlurSpellIconId(+e.target.value)}
												placeholder="Icon ID"
												title="Typ icon ID en druk Tab/Enter, of klik ergens anders → laadt preview en updatet alle ranks"
											/>
										</div>
									</div>
								</>
							)}

							<div className="talent-edit-section">Positie</div>
							<div className="field-group">
								<label>Tier (Rij)</label>
								<input type="number" min="0" max="14" value={form.TierID ?? ''} onChange={e => handleChange('TierID', +e.target.value)} />
							</div>
							<div className="field-group">
								<label>Kolom</label>
								<input type="number" min="0" max="3" value={form.ColumnIndex ?? ''} onChange={e => handleChange('ColumnIndex', +e.target.value)} />
							</div>

							<div className="talent-edit-section">Prerequisite</div>
							<div className="field-group">
								<label>Prerequisite Talent 1</label>
								<input type="number" value={form.PrereqTalent_1 ?? 0} onChange={e => handleChange('PrereqTalent_1', +e.target.value)} />
							</div>
							<div className="field-group">
								<label>Prerequisite Rank 1</label>
								<input type="number" value={form.PrereqRank_1 ?? 0} onChange={e => handleChange('PrereqRank_1', +e.target.value)} />
							</div>

							<div className="talent-edit-section">Spell IDs per Rank</div>
							{[1, 2, 3, 4, 5].map(i => {
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

			{/* ── Spell Icon Picker Modal ── */}
			{showSpellPicker && (
				<div className="spell-picker-modal">
					<div className="spell-picker-overlay" onClick={() => setShowSpellPicker(false)} />
					<div className="spell-picker-panel">
						<div className="spell-picker-header">
							<h3>Selecteer Spell voor Rank {pickingRank}</h3>
							<button className="spell-picker-close" onClick={() => setShowSpellPicker(false)}>
								<X size={16} />
							</button>
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
								<div
									key={spell.spellId}
									className="spell-picker-item"
									onClick={() => handleSelectSpell(spell.spellId)}
									title={`Spell ID: ${spell.spellId}`}
								>
									{spell.icon && <img src={spell.icon} alt={spell.name} className="spell-picker-icon" />}
									<div className="spell-picker-info">
										<div className="spell-picker-name">{spell.name}</div>
										<div className="spell-picker-id">#{spell.spellId}</div>
									</div>
								</div>
							))}
							{availableSpells.length === 0 && (
								<div className="spell-picker-empty">Geen spells gevonden</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
