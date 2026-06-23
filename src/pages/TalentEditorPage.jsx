import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, RotateCcw, GitBranch, GitCompare, X, Search, Copy, Trash2, Plus } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import './TalentEditorPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

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
const GAP = 19;
const MAX_TIERS = 11;
const MAX_COLS = 4;

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

// ─── Herbruikbare talent-grid (lokaal én compare, read-only voor compare) ──
function TalentTreeGrid({
	idPrefix = 'main', talents, spellNames, spellIcons, backgroundImage, treeW, treeH,
	readOnly = false, selected, isNew,
	dragTalentId, dragOver,
	onSelectTalent, onSelectEmpty, onDragStart, onDragOver, onDragLeave, onDrop,
}) {
	const talentAt = (row, col) => talents.find(t => (t.TierID || 0) === row && (t.ColumnIndex || 0) === col);

	return (
		<div className="talent-tree" style={{ width: treeW, height: treeH, backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none', backgroundSize: 'initial', backgroundRepeat: 'repeat' }}>
			<svg width={treeW} height={treeH} className="talent-arrows" style={{ overflow: 'visible' }}>
				<defs>
					<marker id={`arrowhead-${idPrefix}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
						<path d="M0,0 L8,4 L0,8 Z" fill="#ff4444" />
					</marker>
				</defs>
				{talents.map(t => {
					const pid = t.PrereqTalent_1;
					if (!pid) return null;
					const pre = talents.find(x => x.ID === pid);
					if (!pre) return null;

					const x1 = (pre.ColumnIndex || 0) * (CELL + GAP) + CELL / 2;
					const y1 = (pre.TierID || 0) * (CELL + GAP) + CELL / 2;
					const x2 = (t.ColumnIndex || 0) * (CELL + GAP) + CELL / 2;
					const y2 = (t.TierID || 0) * (CELL + GAP) + CELL / 2;

					const endX = x2;
					const endY = y2 - CELL / 2 - 4;

					let path = '';
					if (x1 === x2) {
						const startX = x1;
						const startY = y1 + CELL / 2;
						path = `M ${startX} ${startY} L ${endX} ${endY}`;
					} else if (y1 === y2) {
						const startX = x2 > x1 ? x1 + CELL / 2 : x1 - CELL / 2;
						const startY = y1;
						const adjustedEndX = x2 > x1 ? x2 - CELL / 2 - 4 : x2 + CELL / 2 + 4;
						path = `M ${startX} ${startY} L ${adjustedEndX} ${startY}`;
					} else {
						const startX = x1;
						const startY = y1 + CELL / 2;
						const midY = startY + GAP / 2;
						path = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
					}

					return (
						<path
							key={`arrow-${pid}-${t.ID}`}
							d={path}
							className="talent-prereq-line"
							markerEnd={`url(#arrowhead-${idPrefix})`}
						/>
					);
				})}
			</svg>

			{Array.from({ length: MAX_TIERS }).map((_, row) =>
				Array.from({ length: MAX_COLS }).map((_, col) => {
					const t = talentAt(row, col);
					const isDragSrc = t && dragTalentId === t.ID;
					const isDragDst = dragOver?.row === row && dragOver?.col === col;
					const isSelected = selected && (t ? selected.ID === t.ID : isNew && selected.TierID === row && selected.ColumnIndex === col);

					if (t) {
						const spellId = t.SpellRank_1;
						const name = spellNames[spellId] || `#${t.ID}`;
						const icon = spellIcons[spellId];
						const maxRank = [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((m, i) => t[`SpellRank_${i}`] ? i : m, 0);
						return (
							<div
								key={`node-${idPrefix}-${t.ID}`}
								className={`talent-node${isSelected ? ' selected' : ''}${isDragSrc ? ' dragging' : ''}${isDragDst ? ' drag-over' : ''}`}
								style={{
									left: col * (CELL + GAP),
									top: row * (CELL + GAP),
									width: CELL, height: CELL,
									backgroundImage: icon ? `url(${icon})` : 'none',
									backgroundSize: 'cover',
									backgroundPosition: 'center',
									cursor: onSelectTalent ? 'pointer' : 'default',
								}}
								draggable={!readOnly}
								onDragStart={readOnly ? undefined : e => onDragStart(e, t)}
								onDragOver={readOnly ? undefined : e => onDragOver(e, row, col)}
								onDragLeave={readOnly ? undefined : onDragLeave}
								onDrop={readOnly ? undefined : e => onDrop(e, row, col)}
								onClick={onSelectTalent ? () => onSelectTalent(t) : undefined}
								title={`${name} (${maxRank} ranks) — Tier ${row}, Kolom ${col}`}
							>
								<span className="talent-node-rank">{maxRank}</span>
								{!icon && <span className="talent-node-name">
									{name.length > 10 ? name.slice(0, 10) + '…' : name}
								</span>}
							</div>
						);
					} else {
						return (
							<div
								key={`empty-${idPrefix}-${row}-${col}`}
								className={`talent-grid-cell${isDragDst ? ' drag-over' : ''}${isSelected ? ' selected-empty' : ''}`}
								style={{
									left: col * (CELL + GAP),
									top: row * (CELL + GAP),
									width: CELL, height: CELL,
									cursor: readOnly ? 'default' : 'pointer',
								}}
								onDragOver={readOnly ? undefined : e => onDragOver(e, row, col)}
								onDragLeave={readOnly ? undefined : onDragLeave}
								onDrop={readOnly ? undefined : e => onDrop(e, row, col)}
								onClick={readOnly ? undefined : () => onSelectEmpty(row, col)}
								title={readOnly ? '' : `Leeg slot — Tier ${row}, Kolom ${col}`}
							>
								{!readOnly && <span className="grid-cell-plus">+</span>}
							</div>
						);
					}
				})
			)}
		</div>
	);
}

export default function TalentEditorPage() {
	const {
		dbcPath, readTalentTabs, readTalents, readSpells, readSpellIcons, readSpellFull,
		saveTalent, getIcon, deleteTalent, insertTalent,
		findNextTalentId, copyTalentDbc, idRanges,
	} = useConnection();

	const [selectedClass, setSelectedClass] = useState(null);
	const [tabs, setTabs] = useState([]);
	const [activeTab, setActiveTab] = useState(null);
	const [talents, setTalents] = useState([]);
	const [spellNames, setSpellNames] = useState({});
	const [spellIcons, setSpellIcons] = useState({});
	const [iconToSpellId, setIconToSpellId] = useState({});
	const [selected, setSelected] = useState(null);
	const [isNew, setIsNew] = useState(false);
	const [form, setForm] = useState({});
	const [dirty, setDirty] = useState(false);
	const unsavedGuard = useUnsavedGuard(dirty);
	const [saving, setSaving] = useState(false);
	const [copying, setCopying] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [msg, setMsg] = useState(null);
	const [loadError, setLoadError] = useState(null);
	const [showSpellPicker, setShowSpellPicker] = useState(false);
	const [pickingRank, setPickingRank] = useState(null);
	const [spellSearchTerm, setSpellSearchTerm] = useState('');
	const [primarySpellIconId, setPrimarySpellIconId] = useState(null);
	const [dragTalentId, setDragTalentId] = useState(null);
	const [dragOver, setDragOver] = useState(null);
	const [backgroundImage, setBackgroundImage] = useState(null);
	const [rankTooltips, setRankTooltips] = useState({});
	const [tooltipsLoading, setTooltipsLoading] = useState(false);

	// ─── Compare tegen extern Talent.dbc + Spell.dbc (read-only) ──────────
	// TalentTab.dbc (tree/tab-structuur) komt altijd van lokale dbcPath — die
	// wordt als identiek beschouwd. Talent.dbc én Spell.dbc komen apart uit
	// hun eigen externe bestand, want IDs verschillen tussen lokaal en Epoch:
	// zonder het externe Spell.dbc kunnen de externe talent-IDs niet aan een
	// naam gekoppeld worden. Geen Spell.dbc geselecteerd → namen blijven #ID.
	const [compareDbcFolder, setCompareDbcFolder] = useState(null);
	const [compareSpellFolder, setCompareSpellFolder] = useState(null);
	const [compareVisible, setCompareVisible] = useState(false);
	const [compareTalents, setCompareTalents] = useState([]);
	const [compareSpellNames, setCompareSpellNames] = useState({});
	const [compareSpellIcons, setCompareSpellIcons] = useState({});
	const [compareLoadError, setCompareLoadError] = useState(null);
	const [compareSpellSchemaWarning, setCompareSpellSchemaWarning] = useState(null);
	const [compareSelected, setCompareSelected] = useState(null);
	const [compareRankTooltips, setCompareRankTooltips] = useState({});
	const compareLoadIdRef = useRef(0);
	const [compareTooltipsLoading, setCompareTooltipsLoading] = useState(false);
	// Welke kant heeft het laatst geklikt — voorkomt infinite loop tussen de twee sync-effects hieronder.
	const selectionSourceRef = useRef(null);

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

	// ─── Gekoppelde selectie lokaal ↔ compare (zelfde Tier/ColumnIndex) ───────
	useEffect(() => {
		if (!compareVisible || selectionSourceRef.current !== 'local') return;
		if (!selected) { setCompareSelected(null); return; }
		const match = compareTalents.find(t => (t.TierID || 0) === (selected.TierID || 0) && (t.ColumnIndex || 0) === (selected.ColumnIndex || 0));
		setCompareSelected(match || null);
	}, [selected, compareVisible, compareTalents]);

	useEffect(() => {
		if (!compareVisible || selectionSourceRef.current !== 'compare') return;
		if (!compareSelected) { setSelected(null); return; }
		const match = talents.find(t => (t.TierID || 0) === (compareSelected.TierID || 0) && (t.ColumnIndex || 0) === (compareSelected.ColumnIndex || 0));
		if (match) selectTalent(match); else setSelected(null);
	}, [compareSelected, compareVisible, talents]);

	// ─── Compare laden ────────────────────────────────────────────────────────
	// Tab-structuur (TalentTab.dbc) komt van de lokale dbcPath — zelfde tabId
	// als de actieve lokale tree-tab wordt gebruikt om Talent.dbc uit
	// compareDbcFolder te lezen. Voor spellnamen/icons wordt eerst het externe
	// Spell.dbc geprobeerd; ontbreekt die, dan valt het terug op de lokale.
	const loadCompareTalents = useCallback(async (tabId, talentFolder, spellFolder) => {
		const loadId = ++compareLoadIdRef.current;
		const isStale = () => compareLoadIdRef.current !== loadId;

		setCompareLoadError(null);
		setCompareSelected(null);
		const result = await window.azeroth.dbc.readTalents(talentFolder, tabId);
		if (isStale()) return;
		if (!result.success) { setCompareLoadError(result.error); setCompareTalents([]); return; }
		const data = (result.data || []).sort((a, b) =>
			(a.TierID || 0) !== (b.TierID || 0)
				? (a.TierID || 0) - (b.TierID || 0)
				: (a.ColumnIndex || 0) - (b.ColumnIndex || 0)
		);
		setCompareTalents(data);

		const ids = [];
		data.forEach(t => {
			for (let i = 1; i <= 9; i++) { if (t[`SpellRank_${i}`] > 0) ids.push(t[`SpellRank_${i}`]); }
		});
		if (!ids.length) { setCompareSpellNames({}); setCompareSpellIcons({}); return; }

		// Externe talent-IDs verwijzen naar externe spell-IDs (andere build, andere
		// numbering) — dus zonder een expliciet gekozen extern Spell.dbc kunnen
		// namen niet betrouwbaar worden opgelost. Val dan terug op lokaal als beste
		// gok, maar het echte Spell.dbc van dezelfde build geeft de juiste namen.
		const uniqueIds = [...new Set(ids)];
		const spellsSource = spellFolder || dbcPath;

		// Spell.dbc veldoffsets zijn hardcoded (server build 3.3.5a-layout) — als
		// het externe Spell.dbc een ander recordSize heeft (custom client met
		// extra/andere velden, bijv. Project Epoch) kloppen de offsets niet en
		// lezen we garbage namen/tooltips. Detecteer dit en waarschuw expliciet
		// i.p.v. stilzwijgend foute data te tonen.
		if (spellFolder) {
			const [extInfo, localInfo] = await Promise.all([
				window.azeroth.dbc.getSpellDbcInfo(spellFolder),
				window.azeroth.dbc.getSpellDbcInfo(dbcPath),
			]);
			if (isStale()) return;
			if (extInfo.success && localInfo.success && extInfo.recordSize !== localInfo.recordSize) {
				setCompareSpellSchemaWarning(
					`Extern Spell.dbc heeft een ander recordformaat (recordSize ${extInfo.recordSize} vs lokaal ${localInfo.recordSize}) — veldoffsets komen niet overeen, namen en tooltips kunnen fout of leeg zijn.`
				);
			} else if (!extInfo.success) {
				setCompareSpellSchemaWarning(`Extern Spell.dbc kon niet gelezen worden: ${extInfo.error}`);
			} else {
				setCompareSpellSchemaWarning(null);
			}
		} else {
			setCompareSpellSchemaWarning(null);
		}

		const spellsResult = await window.azeroth.dbc.readSpells(spellsSource, uniqueIds);
		if (isStale()) return;
		const spellsData = spellsResult.data || {};

		const names = {};
		const iconIds = new Set();
		for (const spellId of uniqueIds) {
			const spell = spellsData[spellId];
			if (spell) {
				names[spellId] = spell.name;
				if (spell.spellIconId) iconIds.add(spell.spellIconId);
			}
		}
		setCompareSpellNames(names);
		if (!iconIds.size) { setCompareSpellIcons({}); return; }

		// SpellIcon.dbc ontbreekt vaak in een los geëxtraheerd compare-mapje —
		// val per ontbrekende icon-ID terug op lokaal.
		const extIcons = await window.azeroth.dbc.readSpellIcons(spellsSource, [...iconIds]);
		if (isStale()) return;
		let iconFilenames = extIcons.data || {};
		const missingIconIds = [...iconIds].filter(id => !iconFilenames[id]);
		if (missingIconIds.length && spellsSource !== dbcPath) {
			const localIcons = await window.azeroth.dbc.readSpellIcons(dbcPath, missingIconIds);
			if (isStale()) return;
			iconFilenames = { ...iconFilenames, ...(localIcons.data || {}) };
		}

		const icons = {};
		for (const spellId of uniqueIds) {
			const spell = spellsData[spellId];
			if (spell?.spellIconId) {
				const filename = iconFilenames[spell.spellIconId];
				if (filename) {
					const url = await window.azeroth.icons.get(dbcPath, filename);
					if (isStale()) return;
					if (url) icons[spellId] = url;
				}
			}
		}
		if (!isStale()) setCompareSpellIcons(icons);
	}, [dbcPath]);

	useEffect(() => {
		if (activeTab && compareDbcFolder) loadCompareTalents(activeTab.ID, compareDbcFolder, compareSpellFolder);
	}, [activeTab, compareDbcFolder, compareSpellFolder, loadCompareTalents]);

	const handlePickCompareFile = async () => {
		const filePath = await window.azeroth.dialog.openFile({
			title: 'Select external Talent.dbc',
			filters: [{ name: 'DBC files', extensions: ['dbc'] }],
		});
		if (!filePath) return;
		const folder = filePath.replace(/[\\/][^\\/]*$/, '');
		setCompareDbcFolder(folder);
		setCompareVisible(true);
	};

	const handlePickCompareSpellFile = async () => {
		const filePath = await window.azeroth.dialog.openFile({
			title: 'Select external Spell.dbc',
			filters: [{ name: 'DBC files', extensions: ['dbc'] }],
		});
		if (!filePath) return;
		setCompareSpellFolder(filePath.replace(/[\\/][^\\/]*$/, ''));
	};

	const toggleCompare = () => {
		if (!compareDbcFolder) { handlePickCompareFile(); return; }
		setCompareVisible(v => !v);
	};

	const handleClearCompareFile = () => {
		setCompareDbcFolder(null);
		setCompareSpellFolder(null);
		setCompareVisible(false);
		setCompareTalents([]);
		setCompareSpellNames({});
		setCompareSpellIcons({});
		setCompareLoadError(null);
		setCompareSpellSchemaWarning(null);
		setCompareSelected(null);
	};

	useEffect(() => {
		if (!activeTab) { setBackgroundImage(null); return; }
		loadBackgroundImage(activeTab);
	}, [activeTab]);

	const loadBackgroundImage = async (tab) => {
		try {
			const bgFile = tab.BackgroundFile;
			console.log('🎨 loadBackgroundImage called:', { bgFile, hasTab: !!tab });
			if (!bgFile) {
				console.log('🎨 No BackgroundFile in tab');
				setBackgroundImage(null);
				return;
			}

			console.log('🎨 Calling window.azeroth.talents.getBackground...');
			const result = await window.azeroth.talents.getBackground(bgFile);

			if (result && result.TopLeft && result.TopRight && result.BottomLeft && result.BottomRight) {
				// Composite the 4 tiles on a client-side canvas
				const tileSize = 256;
				const canvas = document.createElement('canvas');
				canvas.width = tileSize * 2;
				canvas.height = tileSize * 2;
				const ctx = canvas.getContext('2d');

				const tiles = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];
				const positions = [
					{ x: 0, y: 0 },
					{ x: tileSize, y: 0 },
					{ x: 0, y: tileSize },
					{ x: tileSize, y: tileSize }
				];

				for (let i = 0; i < tiles.length; i++) {
					const tileKey = tiles[i];
					const img = new Image();
					img.src = result[tileKey];
					await new Promise((resolve, reject) => {
						img.onload = resolve;
						img.onerror = reject;
					});
					ctx.drawImage(img, positions[i].x, positions[i].y, tileSize, tileSize);
				}

				setBackgroundImage(canvas.toDataURL());
				console.log(`🎨 ✓ Background loaded and composited: ${bgFile}`);
			} else {
				setBackgroundImage(null);
				console.log(`🎨 Background not found or incomplete: ${bgFile}`);
			}
		} catch (e) {
			console.error('🎨 Background load error:', e.message);
			setBackgroundImage(null);
		}
	};

	// ─── selectie ────────────────────────────────────────────────────────────
	const selectTalent = (t) => {
		selectionSourceRef.current = 'local';
		setSelected(t);
		setIsNew(false);
		setForm({ ...t });
		setDirty(false);
		setMsg(null);
		setConfirmDelete(false);
	};

	const selectEmpty = (row, col) => {
		selectionSourceRef.current = 'local';
		const blank = {
			ID: 0,
			TabID: activeTab?.ID || 0,
			TierID: row,
			ColumnIndex: col,
			SpellRank_1: 0, SpellRank_2: 0, SpellRank_3: 0, SpellRank_4: 0,
			SpellRank_5: 0, SpellRank_6: 0, SpellRank_7: 0, SpellRank_8: 0, SpellRank_9: 0,
			PrereqTalent_1: 0, PrereqTalent_2: 0, PrereqTalent_3: 0,
			PrereqRank_1: 0, PrereqRank_2: 0, PrereqRank_3: 0,
		};
		setSelected(blank);
		setIsNew(true);
		setForm(blank);
		setDirty(false);
		setMsg(null);
		setConfirmDelete(false);
	};

	const selectCompareTalent = (t) => {
		selectionSourceRef.current = 'compare';
		setCompareSelected(t);
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
				return;
			}
			if (e.key === 'Delete' && !isNew && selected && !confirmDelete) {
				const tag = e.target?.tagName;
				if (tag === 'INPUT' || tag === 'TEXTAREA') return;
				e.preventDefault();
				setConfirmDelete(true);
			}
		};
		window.addEventListener('keydown', down);
		return () => window.removeEventListener('keydown', down);
	}, [dirty, selected, isNew, confirmDelete, handleSave]);

	// ─── verwijderen ──────────────────────────────────────────────────────────
	const handleDelete = async () => {
		if (!selected || isNew) return;
		setDeleting(true);
		setMsg(null);
		setConfirmDelete(false);
		try {
			const result = await deleteTalent(selected.ID);
			if (result.success) {
				setMsg({ type: 'success', text: `✓ Talent #${selected.ID} verwijderd uit DBC.` });
				setSelected(null);
				setIsNew(false);
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

		const occupied = talents.find(t => t.ID !== src.ID && (t.TierID || 0) === dstRow && (t.ColumnIndex || 0) === dstCol);
		if (occupied) {
			setMsg({ type: 'error', text: `Positie (rij ${dstRow}, kolom ${dstCol}) is al bezet door talent #${occupied.ID}.` });
			return;
		}

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

	const primarySpellId = form.SpellRank_1 > 0 ? form.SpellRank_1 : null;
	const ranksWithPrimarySpell = primarySpellId
		? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(i => form[`SpellRank_${i}`] === primarySpellId)
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

	// ─── tooltips per rank (Description_Lang_enUS uit Spell.dbc) ──────────────
	useEffect(() => {
		if (!selected) { setRankTooltips({}); return; }
		const rankIds = [1, 2, 3, 4, 5, 6, 7, 8, 9]
			.map(i => form[`SpellRank_${i}`])
			.filter(id => id > 0);
		if (!rankIds.length) { setRankTooltips({}); return; }

		let cancelled = false;
		setTooltipsLoading(true);
		(async () => {
			const entries = {};
			for (const id of [...new Set(rankIds)]) {
				const result = await readSpellFull(id);
				if (cancelled) return;
				if (result.success) {
					entries[id] = {
						name: result.data.Name_Lang_enUS,
						subtext: result.data.NameSubtext_Lang_enUS,
						description: result.data.Description_Lang_enUS,
						auraDescription: result.data.AuraDescription_Lang_enUS,
					};
				}
			}
			if (!cancelled) { setRankTooltips(entries); setTooltipsLoading(false); }
		})();
		return () => { cancelled = true; };
	}, [selected?.ID, form.SpellRank_1, form.SpellRank_2, form.SpellRank_3, form.SpellRank_4, form.SpellRank_5, form.SpellRank_6, form.SpellRank_7, form.SpellRank_8, form.SpellRank_9, readSpellFull]);

	// ─── tooltips per rank voor compare-selectie (zelfde bron als de namen) ──
	const compareSpellsSource = compareSpellFolder || dbcPath;
	useEffect(() => {
		if (!compareSelected) { setCompareRankTooltips({}); return; }
		const rankIds = [1, 2, 3, 4, 5, 6, 7, 8, 9]
			.map(i => compareSelected[`SpellRank_${i}`])
			.filter(id => id > 0);
		if (!rankIds.length) { setCompareRankTooltips({}); return; }

		let cancelled = false;
		setCompareTooltipsLoading(true);
		(async () => {
			const entries = {};
			for (const id of [...new Set(rankIds)]) {
				let result = await window.azeroth.dbc.readSpellFull(compareSpellsSource, id);
				if (!result.success && compareSpellsSource !== dbcPath) {
					result = await window.azeroth.dbc.readSpellFull(dbcPath, id);
				}
				if (cancelled) return;
				entries[id] = result.success
					? {
						name: result.data.Name_Lang_enUS,
						subtext: result.data.NameSubtext_Lang_enUS,
						description: result.data.Description_Lang_enUS,
						auraDescription: result.data.AuraDescription_Lang_enUS,
					}
					: { error: result.error || 'Niet gevonden' };
			}
			if (!cancelled) { setCompareRankTooltips(entries); setCompareTooltipsLoading(false); }
		})();
		return () => { cancelled = true; };
	}, [compareSelected, compareSpellsSource, dbcPath]);

	const comparePrimarySpellId = compareSelected?.SpellRank_1 > 0 ? compareSelected.SpellRank_1 : null;
	const compareRanksWithPrimary = comparePrimarySpellId
		? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(i => compareSelected[`SpellRank_${i}`] === comparePrimarySpellId)
		: [];
	const compareRanksAny = compareSelected
		? [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(i => compareSelected[`SpellRank_${i}`] > 0)
		: [];

	// ─── grid hulpdata ───────────────────────────────────────────────────────
	const treeW = MAX_COLS * (CELL + GAP) - GAP;
	const treeH = MAX_TIERS * (CELL + GAP) - GAP;

	// ─── render ──────────────────────────────────────────────────────────────
	return (
		<>
			{unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
			{confirmDelete && selected && (
				<DeleteConfirmModal
					title="Talent verwijderen"
					message={`Talent #${selected.ID} verwijderen uit Talent.dbc? Dit kan niet ongedaan worden gemaakt.`}
					onConfirm={handleDelete}
					onCancel={() => setConfirmDelete(false)}
				/>
			)}
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

							<div className="talent-compare-toggle">
								<button
									className={`talent-tab-btn ${compareVisible ? 'active' : ''}`}
									onClick={toggleCompare}
									title={compareDbcFolder ? 'Compare paneel tonen/verbergen' : 'Selecteer extern Talent.dbc om te vergelijken'}
								>
									<GitCompare size={13} /> Compare
								</button>
								{compareDbcFolder && (
									<span className="compare-file-label">
										Talent: {compareDbcFolder.split(/[\\/]/).pop()}
										<button type="button" className="btn-ghost" style={{ fontSize: '10px', padding: '1px 5px' }} title="Compare bestanden wissen" onClick={handleClearCompareFile}>
											<X size={11} />
										</button>
									</span>
								)}
								{compareDbcFolder && (
									<button
										type="button"
										className={`talent-tab-btn ${compareSpellFolder ? 'active' : ''}`}
										onClick={handlePickCompareSpellFile}
										title="Selecteer extern Spell.dbc (nodig om externe talent-IDs aan namen te koppelen)"
									>
										Spell: {compareSpellFolder ? compareSpellFolder.split(/[\\/]/).pop() : '— selecteer —'}
									</button>
								)}
							</div>
						</div>

						<div className="talent-panes">
							<div className="talent-tree-scroll">
								{activeTab && (
									<TalentTreeGrid
										talents={talents}
										spellNames={spellNames}
										spellIcons={spellIcons}
										backgroundImage={backgroundImage}
										treeW={treeW}
										treeH={treeH}
										selected={selected}
										isNew={isNew}
										dragTalentId={dragTalentId}
										dragOver={dragOver}
										onSelectTalent={selectTalent}
										onSelectEmpty={selectEmpty}
										onDragStart={handleDragStart}
										onDragOver={handleDragOver}
										onDragLeave={handleDragLeave}
										onDrop={handleDrop}
									/>
								)}
								{!activeTab && <div className="editor-empty"><p>Geen talent tab geselecteerd</p></div>}
							</div>

							{compareDbcFolder && compareVisible && (
								<div className="compare-pane">
									<div className="talent-tabs compare-tabs-row">
										<span className="talent-no-tabs">Compare: {activeTab?.Name_Lang_enUS || '—'} ({compareDbcFolder.split(/[\\/]/).pop()})</span>
									</div>
									{compareLoadError && (
										<div className="editor-msg error" style={{ margin: '8px 12px 0' }}>
											Compare laad error: {compareLoadError}
										</div>
									)}
									{compareSpellSchemaWarning && (
										<div className="editor-msg error" style={{ margin: '8px 12px 0' }}>
											{compareSpellSchemaWarning}
										</div>
									)}
									<div className="compare-body">
										<div className="talent-tree-scroll">
											{activeTab && !compareLoadError ? (
												<TalentTreeGrid
													idPrefix="cmp"
													readOnly
													talents={compareTalents}
													spellNames={compareSpellNames}
													spellIcons={compareSpellIcons}
													backgroundImage={null}
													treeW={treeW}
													treeH={treeH}
													selected={compareSelected}
													onSelectTalent={selectCompareTalent}
												/>
											) : !compareLoadError && <div className="editor-empty"><p>Geen talent tab geselecteerd</p></div>}
										</div>

										<div className="talent-edit-panel">
											{!compareSelected ? (
												<div className="editor-empty"><p>Klik op een talent om te bekijken</p></div>
											) : (
												<>
													<div className="panel-header">
														<GitCompare size={14} />
														<span>Talent #{compareSelected.ID}</span>
													</div>

													{comparePrimarySpellId > 0 && (
														<>
															<div className="talent-edit-section">Spell Icon</div>
															<div className="field-group spell-icon-master">
																<label>
																	{compareSpellNames[comparePrimarySpellId] || `#${comparePrimarySpellId}`}
																	<span className="spell-icon-ranks"> ({compareRanksWithPrimary.length} rank{compareRanksWithPrimary.length !== 1 ? 's' : ''})</span>
																</label>
																<div className="spell-icon-input-group">
																	{compareSpellIcons[comparePrimarySpellId] && (
																		<img src={compareSpellIcons[comparePrimarySpellId]} alt="icon" className="spell-icon-master-preview" />
																	)}
																</div>
															</div>
														</>
													)}

													<div className="talent-edit-fields">
														<div className="talent-edit-section">Positie</div>
														<div className="field-group">
															<label>Tier (Rij)</label>
															<span>{compareSelected.TierID ?? 0}</span>
														</div>
														<div className="field-group">
															<label>Kolom</label>
															<span>{compareSelected.ColumnIndex ?? 0}</span>
														</div>

														{compareSelected.PrereqTalent_1 > 0 && (
															<>
																<div className="talent-edit-section">Prerequisite</div>
																<div className="field-group">
																	<label>Prereq Talent</label>
																	<span>#{compareSelected.PrereqTalent_1}</span>
																</div>
																<div className="field-group">
																	<label>Prereq Rank</label>
																	<span>{compareSelected.PrereqRank_1 ?? 0}</span>
																</div>
															</>
														)}

														<div className="talent-edit-section">Spell IDs per Rank</div>
														{[1, 2, 3, 4, 5].map(i => {
															const spellId = compareSelected[`SpellRank_${i}`];
															if (!spellId) return null;
															const hint = compareSpellNames[spellId];
															return (
																<div key={i} className="field-group">
																	<label>
																		Rank {i}
																		{hint && <span className="field-spell-hint"> — {hint}</span>}
																	</label>
																	<span>#{spellId}</span>
																</div>
															);
														})}

														{compareRanksAny.length > 0 && (
															<>
																<div className="talent-edit-section">Tooltip{compareTooltipsLoading ? ' (laden…)' : ''}</div>
																{compareRanksAny.map(i => {
																	const spellId = compareSelected[`SpellRank_${i}`];
																	const tt = compareRankTooltips[spellId];
																	if (!tt) return null;
																	return (
																		<div key={`cmp-tt-${i}`} className="field-group" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
																			<label>
																				Rank {i}{tt.name ? ` — ${tt.name}` : ''}{tt.subtext ? ` (${tt.subtext})` : ''}
																			</label>
																			<div style={{
																				fontSize: '12px',
																				lineHeight: 1.4,
																				color: 'var(--text-secondary, #ccc)',
																				background: 'var(--bg-inset, rgba(0,0,0,0.2))',
																				border: '1px solid var(--border)',
																				borderRadius: 4,
																				padding: '6px 8px',
																				whiteSpace: 'pre-wrap',
																			}}>
																				{tt.error
																					? <em>Geen tooltip gevonden in extern Spell.dbc ({tt.error})</em>
																					: (tt.description || <em>Geen description tekst</em>)}
																				{tt.auraDescription && (
																					<div style={{ marginTop: 4, opacity: 0.8 }}>{tt.auraDescription}</div>
																				)}
																			</div>
																		</div>
																	);
																})}
															</>
														)}
													</div>
												</>
											)}
										</div>
									</div>
								</div>
							)}
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
						{!isNew && (
							<div className="panel-talent-id" style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontFamily: 'monospace' }}>
								ID: <span style={{ color: 'var(--gold)' }}>{selected.ID}</span>
							</div>
						)}

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
									<button className="btn-ghost" onClick={() => setConfirmDelete(true)} title="Delete this talent (Delete-toets)">
										<Trash2 size={13} /> Delete
									</button>
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

							{/* Tooltips per rank */}
							{Object.keys(rankTooltips).length > 0 && (
								<>
									<div className="talent-edit-section">Tooltip{tooltipsLoading ? ' (laden…)' : ''}</div>
									{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => {
										const spellId = form[`SpellRank_${i}`];
										const tt = spellId > 0 ? rankTooltips[spellId] : null;
										if (!tt) return null;
										return (
											<div key={`tt-${i}`} className="field-group" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
												<label>
													Rank {i} — {tt.name}{tt.subtext ? ` (${tt.subtext})` : ''}
												</label>
												<div style={{
													fontSize: '12px',
													lineHeight: 1.4,
													color: 'var(--text-secondary, #ccc)',
													background: 'var(--bg-inset, rgba(0,0,0,0.2))',
													border: '1px solid var(--border)',
													borderRadius: 4,
													padding: '6px 8px',
													whiteSpace: 'pre-wrap',
												}}>
													{tt.description || <em>Geen description tekst</em>}
													{tt.auraDescription && (
														<div style={{ marginTop: 4, opacity: 0.8 }}>{tt.auraDescription}</div>
													)}
												</div>
											</div>
										);
									})}
								</>
							)}
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
		</>
	);
}