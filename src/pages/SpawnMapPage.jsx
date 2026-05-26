import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Loader } from 'lucide-react';
import './SpawnMapPage.css';

const IMG_W = 2048, IMG_H = 1536;

const CONTINENTS = [
	{ mapId: 0, name: 'Eastern Kingdoms', folder: 'Azeroth', base: 'Azeroth' },
	{ mapId: 1, name: 'Kalimdor', folder: 'Kalimdor', base: 'Kalimdor' },
	{ mapId: 530, name: 'Outland', folder: 'Expansion01', base: 'Expansion01' },
	{ mapId: 571, name: 'Northrend', folder: 'Northrend', base: 'Northrend' },
];

const CONTINENT_CAL_KEY  = 'azeroth-continent-cal';
const DEFAULT_CAL        = { x: 0, y: 0, sx: 1, sy: 1 };
const CAL_VERSION        = 2;

function loadCal() {
	try {
		const raw = JSON.parse(localStorage.getItem(CONTINENT_CAL_KEY)) || {};
		if (raw._v !== CAL_VERSION) return { _v: CAL_VERSION };
		return raw;
	} catch { return { _v: CAL_VERSION }; }
}
function saveCal(cal) {
	localStorage.setItem(CONTINENT_CAL_KEY, JSON.stringify(cal));
}

const RANK_NAMES = ['Normal', 'Elite', 'Rare Elite', 'Boss', 'Rare'];
const MOVE_NAMES = ['Idle', 'Random', 'Waypoint'];

const CLUSTER_PX = 64;
const CLUSTER_MAX_SCALE = 1.5;

const HORDE_FACTIONS = new Set([
	2, 5, 6, 29, 68, 72, 76, 80, 85, 104, 105, 106, 107, 108, 109,
	530, 911, 1049, 1064, 1085, 1171, 1172, 1173, 1174, 1177, 1178,
	1602, 1604, 1708,
]);
const ALLIANCE_FACTIONS = new Set([
	11, 47, 54, 55, 57, 349, 469, 509, 577, 730, 890, 891,
	1037, 1059, 1073, 1600, 1605,
]);
const NEUTRAL_FACTIONS = new Set([
	69, 21, 470, 189, 474,
	35, 534, 734, 1011, 1012, 1375,
]);

function creatureClass(spawn) {
	if (spawn.type === 8) return 'critter';
	if (HORDE_FACTIONS.has(spawn.faction)) return 'horde';
	if (ALLIANCE_FACTIONS.has(spawn.faction)) return 'alliance';
	if (NEUTRAL_FACTIONS.has(spawn.faction)) return 'neutral';
	return 'hostile';
}

function worldToZonePx(wx, wy, area) {
	return {
		px: (area.locLeft - wy) / (area.locLeft - area.locRight) * IMG_W,
		py: (area.locTop - wx) / (area.locTop - area.locBottom) * IMG_H,
	};
}

function zonePxToWorld(px, py, area) {
	return {
		wx: area.locTop - (py / IMG_H) * (area.locTop - area.locBottom),
		wy: area.locLeft - (px / IMG_W) * (area.locLeft - area.locRight),
	};
}

function inBounds({ px, py }) {
	return px > -20 && px < IMG_W + 20 && py > -20 && py < IMG_H + 20;
}

function matchesSearch(spawn, term) {
	if (!term.trim()) return true;
	const t = term.toLowerCase();
	return spawn.name?.toLowerCase().includes(t) || spawn.entry?.toString() === term;
}

function clusterSpawns(spawns, show, zone, scale, forceFlat) {
	if (!show || !zone) return { clusters: [], singles: [] };

	if (scale >= CLUSTER_MAX_SCALE || forceFlat) {
		const singles = [];
		for (const spawn of spawns) {
			const pos = worldToZonePx(spawn.wx, spawn.wy, zone);
			if (inBounds(pos)) singles.push({ spawn, px: pos.px, py: pos.py });
		}
		return { clusters: [], singles };
	}

	const cellSize = CLUSTER_PX / scale;
	const cells = new Map();
	for (const spawn of spawns) {
		const pos = worldToZonePx(spawn.wx, spawn.wy, zone);
		if (!inBounds(pos)) continue;
		const key = `${Math.floor(pos.px / cellSize)},${Math.floor(pos.py / cellSize)}`;
		if (!cells.has(key)) cells.set(key, []);
		cells.get(key).push({ spawn, px: pos.px, py: pos.py });
	}
	const clusters = [], singles = [];
	for (const items of cells.values()) {
		if (items.length === 1) {
			singles.push(items[0]);
		} else {
			const px = items.reduce((s, i) => s + i.px, 0) / items.length;
			const py = items.reduce((s, i) => s + i.py, 0) / items.length;
			clusters.push({ px, py, count: items.length });
		}
	}
	return { clusters, singles };
}

export default function SpawnMapPage() {
	const { query, dbcPath, worldmapMpqPath, soapCommand } = useConnection();

	const [worldAreas, setWorldAreas] = useState([]);
	const [areasError, setAreasError] = useState('');

	const [continent, setContinent] = useState(CONTINENTS[0]);
	const [zone, setZone] = useState(null);

	const [bgImage, setBgImage] = useState(null);
	const [imgLoading, setImgLoading] = useState(false);

	const [creatures, setCreatures] = useState([]);
	const [gameobjects, setGameobjects] = useState([]);
	const [waypoints, setWaypoints] = useState([]);
	const [showCreatures, setShowCreatures] = useState(true);
	const [showGOs, setShowGOs] = useState(true);
	const [spawnLoading, setSpawnLoading] = useState(false);

	const [creatureFilter, setCreatureFilter] = useState(
		new Set(['hostile', 'horde', 'alliance', 'neutral', 'critter'])
	);
	const [filterOpen, setFilterOpen] = useState(false);
	const filterRef = useRef(null);

	const [searchTerm, setSearchTerm] = useState('');
	const [searchOpen, setSearchOpen] = useState(false);
	const searchRef = useRef(null);

	const [selected, setSelected] = useState(null);

	const [hoveredZone, setHoveredZone] = useState(null);
	const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

	const [continentCal, setContinentCal] = useState(loadCal);
	const [calOpen, setCalOpen] = useState(false);
	const calRef = useRef(null);

	const getCal = useCallback((mapId) =>
		continentCal[mapId] ?? DEFAULT_CAL,
	[continentCal]);

	const updateCal = useCallback((mapId, field, val) => {
		setContinentCal(prev => {
			const next = { ...prev, _v: CAL_VERSION, [mapId]: { ...(prev[mapId] ?? DEFAULT_CAL), [field]: val } };
			saveCal(next);
			return next;
		});
	}, []);

	const resetCal = useCallback((mapId) => {
		setContinentCal(prev => {
			const next = { ...prev, _v: CAL_VERSION, [mapId]: { ...DEFAULT_CAL } };
			saveCal(next);
			return next;
		});
	}, []);

	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [scale, setScale] = useState(1);
	const viewRef = useRef(null);
	const panRef = useRef({ active: false, sx: 0, sy: 0, px: 0, py: 0 });
	const scaleRef = useRef(1);
	const zoneRef = useRef(null);

	const dragRef = useRef(null);
	const [dragPos, setDragPos] = useState(null);
	const dragPosRef = useRef(null);
	const DRAG_THRESHOLD = 5;

	const [contextMenu, setContextMenu] = useState(null);
	const contextMenuRef = useRef(null);
	const [addModal, setAddModal] = useState(null);
	const [addEntry, setAddEntry] = useState('');
	const [addType, setAddType] = useState('creature');

	useEffect(() => { scaleRef.current = scale; }, [scale]);
	useEffect(() => { zoneRef.current = zone; }, [zone]);

	useEffect(() => {
		if (!filterOpen) return;
		const h = (e) => { if (!filterRef.current?.contains(e.target)) setFilterOpen(false); };
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, [filterOpen]);

	useEffect(() => {
		if (!searchOpen) return;
		const h = (e) => { if (!searchRef.current?.contains(e.target)) setSearchOpen(false); };
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, [searchOpen]);

	useEffect(() => {
		if (!calOpen) return;
		const h = (e) => { if (!calRef.current?.contains(e.target)) setCalOpen(false); };
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, [calOpen]);

	useEffect(() => {
		if (!contextMenu) return;
		const h = (e) => { if (!contextMenuRef.current?.contains(e.target)) setContextMenu(null); };
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, [contextMenu]);

	const toggleCreatureType = (type) => {
		setCreatureFilter(prev => {
			const next = new Set(prev);
			if (next.has(type)) next.delete(type); else next.add(type);
			return next;
		});
	};

	useEffect(() => {
		if (!dbcPath) return;
		window.azeroth.worldmap.readWorldMapAreas(dbcPath).then(res => {
			if (res.success) setWorldAreas(res.areas);
			else setAreasError(res.error);
		});
	}, [dbcPath]);

	useEffect(() => {
		const folder = zone ? zone.internalName : continent.folder;
		const base = zone ? zone.internalName : continent.base;
		setImgLoading(true);
		setBgImage(null);
		window.azeroth.worldmap.getZoneImage(folder, base, worldmapMpqPath).then(res => {
			if (res.success) setBgImage(res.data);
			setImgLoading(false);
		});
		const vp = viewRef.current?.getBoundingClientRect();
		if (vp && vp.width > 0) {
			const ns = Math.min(10, Math.max(0.1, Math.min(vp.width / IMG_W, vp.height / IMG_H) * 0.95));
			setScale(ns);
			setPan({ x: (vp.width - IMG_W * ns) / 2, y: (vp.height - IMG_H * ns) / 2 });
		} else {
			setScale(1);
			setPan({ x: 0, y: 0 });
		}
		setSelected(null);
		setDragPos(null);
		dragRef.current = null;
		setSearchTerm('');
	}, [continent, zone]);

	useEffect(() => {
		if (!zone) { setCreatures([]); setGameobjects([]); setWaypoints([]); return; }
		setSpawnLoading(true);
		const xMin = Math.min(zone.locTop, zone.locBottom);
		const xMax = Math.max(zone.locTop, zone.locBottom);
		const yMin = Math.min(zone.locLeft, zone.locRight);
		const yMax = Math.max(zone.locLeft, zone.locRight);
		Promise.all([
			query(
				`SELECT c.guid, c.id1 AS entry, c.position_x AS wx, c.position_y AS wy,
				        c.position_z AS wz, c.orientation, c.MovementType,
				        ct.name, ct.minlevel, ct.maxlevel, ct.faction, ct.rank,
				        ct.DamageModifier, ct.AIName, ct.ScriptName, ct.type
				 FROM creature c
				 JOIN creature_template ct ON ct.entry = c.id1
				 WHERE c.map = ?
				   AND c.position_x BETWEEN ? AND ?
				   AND c.position_y BETWEEN ? AND ?
				 LIMIT 5000`,
				[zone.mapId, xMin, xMax, yMin, yMax]
			),
			query(
				`SELECT g.guid, g.id AS entry, g.position_x AS wx, g.position_y AS wy,
				        g.position_z AS wz, g.orientation, gt.name
				 FROM gameobject g
				 JOIN gameobject_template gt ON gt.entry = g.id
				 WHERE g.map = ?
				   AND g.position_x BETWEEN ? AND ?
				   AND g.position_y BETWEEN ? AND ?
				 LIMIT 5000`,
				[zone.mapId, xMin, xMax, yMin, yMax]
			),
		]).then(([c, g]) => {
			setCreatures(c?.data || []);
			setGameobjects(g?.data || []);
			setSpawnLoading(false);
		});
	}, [zone]);

	useEffect(() => {
		if (!selected || selected.type !== 'creature' || selected.spawn.MovementType !== 2) {
			setWaypoints([]);
			return;
		}
		query(
			`SELECT point, position_x AS wx, position_y AS wy, position_z AS wz, delay, move_type
			 FROM waypoint_data WHERE id = ? ORDER BY point`,
			[selected.spawn.guid]
		).then(res => setWaypoints(res?.data || []));
	}, [selected]);

	useEffect(() => {
		const onMove = (e) => {
			const p = panRef.current;
			if (p.active) {
				setPan({ x: p.px + e.clientX - p.sx, y: p.py + e.clientY - p.sy });
			}
			if (dragRef.current) {
				if (!(e.buttons & 1)) {
					dragRef.current = null; dragPosRef.current = null; setDragPos(null); return;
				}
				const { startX, startY, origPx, origPy, guid, active } = dragRef.current;
				const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2);
				if (!active && dist >= DRAG_THRESHOLD) dragRef.current.active = true;
				if (active) {
					const curPx = origPx + (e.clientX - startX) / scaleRef.current;
					const curPy = origPy + (e.clientY - startY) / scaleRef.current;
					const pos = { guid, px: curPx, py: curPy };
					dragPosRef.current = pos;
					setDragPos({ ...pos });
				}
			}
		};

		const onUp = async () => {
			panRef.current.active = false;
			if (dragRef.current && dragPosRef.current) {
				const { guid, type } = dragRef.current;
				const { px, py } = dragPosRef.current;
				const area = zoneRef.current;
				if (area) {
					const { wx, wy } = zonePxToWorld(px, py, area);
					try {
						if (type === 'creature') {
							const res = await query('UPDATE creature SET position_x=?, position_y=? WHERE guid=?', [wx, wy, guid]);
							if (res.success) setCreatures(prev => prev.map(c => c.guid === guid ? { ...c, wx, wy } : c));
							else console.error('Failed to update creature position:', res.error);
						} else {
							const res = await query('UPDATE gameobject SET position_x=?, position_y=? WHERE guid=?', [wx, wy, guid]);
							if (res.success) setGameobjects(prev => prev.map(g => g.guid === guid ? { ...g, wx, wy } : g));
							else console.error('Failed to update gameobject position:', res.error);
						}
					} catch (err) { console.error('Error updating spawn position:', err); }
				}
				dragRef.current = null; dragPosRef.current = null; setDragPos(null);
			}
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
	}, [query]);

	const onViewMouseDown = useCallback((e) => {
		if (e.button !== 0 || e.target.closest('.spawn-marker,.wp-node-group')) return;
		panRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
		e.preventDefault();
	}, [pan]);

	const onWheel = useCallback((e) => {
		e.preventDefault();
		const vp = viewRef.current?.getBoundingClientRect();
		if (!vp) return;
		const cx = e.clientX - vp.left;
		const cy = e.clientY - vp.top;
		const delta = e.deltaY > 0 ? 0.85 : 1.15;
		const ns = Math.min(10, Math.max(0.1, scaleRef.current * delta));
		const ratio = ns / scaleRef.current;
		setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
		setScale(ns);
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.addEventListener('wheel', onWheel, { passive: false });
		return () => view.removeEventListener('wheel', onWheel);
	}, [onWheel]);

	const startDrag = useCallback((e, spawn, type) => {
		if (!zoneRef.current) return;
		e.stopPropagation();
		const { px, py } = worldToZonePx(spawn.wx, spawn.wy, zoneRef.current);
		dragRef.current = { guid: spawn.guid, type, startX: e.clientX, startY: e.clientY, origPx: px, origPy: py, active: false };
		dragPosRef.current = null;
	}, []);

	const onViewContextMenu = useCallback((e) => {
		e.preventDefault();
		if (!zone) return;
		const vp = viewRef.current?.getBoundingClientRect();
		if (!vp) return;
		const px = (e.clientX - vp.left - pan.x) / scale;
		const py = (e.clientY - vp.top - pan.y) / scale;
		const { wx, wy } = zonePxToWorld(px, py, zone);
		setContextMenu({ x: e.clientX, y: e.clientY, wx, wy, spawn: null, spawnType: null });
	}, [zone, pan, scale]);

	const onMarkerContextMenu = useCallback((e, spawn, spawnType) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({ x: e.clientX, y: e.clientY, wx: spawn.wx, wy: spawn.wy, wz: spawn.wz, spawn, spawnType });
	}, []);

	const ctxCopyCoords = useCallback(() => {
		const { wx, wy, wz } = contextMenu;
		navigator.clipboard.writeText(`${wx.toFixed(4)} ${wy.toFixed(4)} ${(wz ?? 0).toFixed(4)}`);
		setContextMenu(null);
	}, [contextMenu]);

	const ctxTeleport = useCallback(async () => {
		const { wx, wy, wz } = contextMenu;
		await soapCommand(`.go xyz ${wx.toFixed(4)} ${wy.toFixed(4)} ${(wz ?? 0).toFixed(4)} ${zone.mapId}`);
		setContextMenu(null);
	}, [contextMenu, zone, soapCommand]);

	const ctxDelete = useCallback(async () => {
		const { spawn, spawnType } = contextMenu;
		if (!spawn) return;
		if (spawnType === 'creature') {
			await query('DELETE FROM creature WHERE guid=?', [spawn.guid]);
			setCreatures(prev => prev.filter(c => c.guid !== spawn.guid));
		} else {
			await query('DELETE FROM gameobject WHERE guid=?', [spawn.guid]);
			setGameobjects(prev => prev.filter(g => g.guid !== spawn.guid));
		}
		if (selected?.spawn?.guid === spawn.guid) setSelected(null);
		setContextMenu(null);
	}, [contextMenu, query, selected]);

	const ctxOpenAdd = useCallback(() => {
		setAddModal({ wx: contextMenu.wx, wy: contextMenu.wy });
		setAddEntry('');
		setAddType('creature');
		setContextMenu(null);
	}, [contextMenu]);

	const ctxConfirmAdd = useCallback(async () => {
		const entry = parseInt(addEntry);
		if (!entry || !addModal || !zone) return;
		const table = addType === 'creature' ? 'creature' : 'gameobject';
		const res = await window.azeroth.db.findNextId({ table, idColumn: 'guid', startId: 1 });
		if (!res.success) return;
		const guid = res.nextId;
		const { wx, wy } = addModal;
		if (addType === 'creature') {
			await query(
				'INSERT INTO creature (guid, id1, map, position_x, position_y, position_z, orientation, spawnMask, phaseMask) VALUES (?,?,?,?,?,?,?,?,?)',
				[guid, entry, zone.mapId, wx, wy, 0, 0, 1, 1]
			);
			const tpl = await query(
				'SELECT name, minlevel, maxlevel, faction, rank, type, DamageModifier, AIName, ScriptName, MovementType FROM creature_template WHERE entry=?',
				[entry]
			);
			const tmpl = tpl?.data?.[0] || {};
			setCreatures(prev => [...prev, { guid, entry, wx, wy, wz: 0, orientation: 0, ...tmpl }]);
		} else {
			await query(
				'INSERT INTO gameobject (guid, id, map, position_x, position_y, position_z, orientation, rotation0, rotation1, rotation2, rotation3, spawntimesecs, animprogress, state, spawnMask, phaseMask) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
				[guid, entry, zone.mapId, wx, wy, 0, 0, 0, 0, 0, 1, 300, 0, 1, 1, 1]
			);
			const tpl = await query('SELECT name FROM gameobject_template WHERE entry=?', [entry]);
			const name = tpl?.data?.[0]?.name || 'GO ' + entry;
			setGameobjects(prev => [...prev, { guid, entry, wx, wy, wz: 0, orientation: 0, name }]);
		}
		setAddModal(null);
	}, [addModal, addType, addEntry, zone, query]);

	const zonesForContinent = worldAreas
		.filter(a => a.mapId === continent.mapId && a.areaId > 0 && a.internalName && a.locLeft !== a.locRight)
		.sort((a, b) => a.internalName.localeCompare(b.internalName));

	const continentArea = useMemo(() => {
		const entry = worldAreas.find(a => a.mapId === continent.mapId && a.areaId === 0);
		if (entry && entry.locLeft !== entry.locRight && entry.locTop !== entry.locBottom) return entry;
		const zones = worldAreas.filter(a => a.mapId === continent.mapId && a.areaId > 0 && a.locLeft !== a.locRight);
		if (!zones.length) return null;
		return {
			locLeft: Math.max(...zones.map(z => z.locLeft)),
			locRight: Math.min(...zones.map(z => z.locRight)),
			locTop: Math.max(...zones.map(z => z.locTop)),
			locBottom: Math.min(...zones.map(z => z.locBottom)),
		};
	}, [worldAreas, continent]);

	const ZONE_DOT_R = 7;

	function zoneCenter(z, cont) {
		const raw_cx = (cont.locLeft - (z.locLeft + z.locRight) / 2) / (cont.locLeft - cont.locRight) * IMG_W;
		const raw_cy = (cont.locTop  - (z.locTop  + z.locBottom) / 2) / (cont.locTop  - cont.locBottom) * IMG_H;
		const cal = getCal(continent.mapId);
		return { cx: raw_cx * cal.sx + cal.x, cy: raw_cy * cal.sy + cal.y };
	}

	const searchResults = useMemo(() => {
		if (!searchTerm.trim() || !zone) return [];
		const results = [];
		creatures.forEach(c => { if (matchesSearch(c, searchTerm)) results.push({ type: 'creature', spawn: c }); });
		gameobjects.forEach(g => { if (matchesSearch(g, searchTerm)) results.push({ type: 'go', spawn: g }); });
		return results.slice(0, 50);
	}, [searchTerm, creatures, gameobjects, zone]);

	const onSelectResult = useCallback((type, spawn) => {
		setSelected({ type, spawn });
		const pos = worldToZonePx(spawn.wx, spawn.wy, zoneRef.current);
		const vp = viewRef.current?.getBoundingClientRect();
		if (vp) {
			const ns = Math.max(scaleRef.current, 2);
			setPan({ x: vp.width / 2 - pos.px * ns, y: vp.height / 2 - pos.py * ns });
			setScale(ns);
		}
		setSearchOpen(false);
	}, []);

	const onClusterClick = useCallback((e, px, py) => {
		e.stopPropagation();
		const vp = viewRef.current?.getBoundingClientRect();
		if (!vp) return;
		const ns = Math.min(10, scaleRef.current * 2.5);
		setPan({ x: vp.width / 2 - px * ns, y: vp.height / 2 - py * ns });
		setScale(ns);
	}, []);

	function spawnPx(spawn) {
		if (!zone) return { px: -9999, py: -9999 };
		if (dragPos?.guid === spawn.guid) return { px: dragPos.px, py: dragPos.py };
		return worldToZonePx(spawn.wx, spawn.wy, zone);
	}

	const isSel = (spawn) => selected?.spawn?.guid === spawn.guid;
	const hasSearch = searchTerm.trim().length > 0;

	const clusterData = useMemo(() => {
		const filtered = showCreatures
			? creatures.filter(cr => creatureFilter.has(creatureClass(cr)))
			: [];
		const c = clusterSpawns(filtered, true, zone, scale, hasSearch);
		const g = clusterSpawns(gameobjects, showGOs, zone, scale, hasSearch);
		return {
			creatureClusters: c.clusters, creatureSingles: c.singles,
			goClusters: g.clusters, goSingles: g.singles,
		};
	}, [creatures, gameobjects, zone, scale, showCreatures, showGOs, creatureFilter, hasSearch]);

	return (
		<div className="spawn-map-page">

			{/* ── Toolbar ──────────────────────────────────────────────────── */}
			<div className="spawn-map-toolbar">
				<select className="map-select" value={continent.mapId}
					onChange={e => { setContinent(CONTINENTS.find(c => c.mapId === +e.target.value)); setZone(null); }}>
					{CONTINENTS.map(c => <option key={c.mapId} value={c.mapId}>{c.name}</option>)}
				</select>

				<select className="map-select" value={zone?.id ?? ''}
					onChange={e => setZone(e.target.value ? worldAreas.find(a => a.id === +e.target.value) : null)}>
					<option value="">— Continent overzicht —</option>
					{zonesForContinent.map(a => <option key={a.id} value={a.id}>{a.internalName}</option>)}
				</select>

				{zone && <>
					<div className="spawn-search-wrap" ref={searchRef}>
						<input
							type="text"
							className="spawn-search"
							placeholder="Zoek naam of entry-ID…"
							value={searchTerm}
							onChange={e => { setSearchTerm(e.target.value); if (e.target.value.trim()) setSearchOpen(true); }}
							onFocus={() => { if (searchTerm.trim()) setSearchOpen(true); }}
						/>
						{searchOpen && searchResults.length > 0 && (
							<div className="spawn-search-panel">
								{searchResults.map(({ type, spawn }) => (
									<div key={`${type}-${spawn.guid}`} className="spawn-search-item"
										onClick={() => onSelectResult(type, spawn)}>
										<span className={`spawn-search-badge ${type}`}>
											{type === 'creature' ? 'NPC' : 'GO'}
										</span>
										<span className="spawn-search-name">{spawn.name}</span>
										<span className="spawn-search-id">#{spawn.entry}</span>
									</div>
								))}
							</div>
						)}
					</div>

					<button className={`spawn-toggle ${showCreatures ? 'active' : ''}`}
						onClick={() => setShowCreatures(v => !v)}>
						<span className="spawn-dot creature" /> Creatures
					</button>

					{showCreatures && (
						<div className="type-filter-wrap" ref={filterRef}>
							<button
								className={`spawn-toggle type-filter-btn ${filterOpen ? 'active' : ''}`}
								onClick={() => setFilterOpen(v => !v)}
								title="Filter op type">
								{['hostile', 'horde', 'alliance', 'neutral', 'critter'].map(t => (
									<span key={t} className={`filter-pip ${t} ${creatureFilter.has(t) ? '' : 'off'}`} />
								))}
								<span style={{ marginLeft: 2 }}>▾</span>
							</button>
							{filterOpen && (
								<div className="type-filter-panel">
									{[
										{ key: 'hostile', label: 'Hostile', color: '#f97316' },
										{ key: 'horde', label: 'Horde', color: '#ef4444' },
										{ key: 'alliance', label: 'Alliance', color: '#60a5fa' },
										{ key: 'neutral', label: 'Neutraal', color: '#eab308' },
										{ key: 'critter', label: 'Critter', color: '#94a3b8' },
									].map(({ key, label, color }) => (
										<label key={key} className="type-filter-item"
											onClick={() => toggleCreatureType(key)}>
											<span className="type-filter-check">{creatureFilter.has(key) ? '✓' : ''}</span>
											<span className="type-filter-dot" style={{ background: color }} />
											{label}
										</label>
									))}
								</div>
							)}
						</div>
					)}

					<button className={`spawn-toggle ${showGOs ? 'active' : ''}`}
						onClick={() => setShowGOs(v => !v)}>
						<span className="spawn-dot gameobject" /> Objects
					</button>
				</>}

				{!zone && (
					<div className="cal-wrap" ref={calRef}>
						<button className={`spawn-toggle cal-btn ${calOpen ? 'active' : ''}`}
							onClick={() => setCalOpen(v => !v)}
							title="Kalibratie zone-markers">
							⚙ Kalibratie
						</button>
						{calOpen && (() => {
							const cal = getCal(continent.mapId);
							return (
								<div className="cal-panel">
									<div className="cal-title">{continent.name}</div>
									{[
										{ key: 'x',  label: 'Offset X',  step: 1,    min: -500, max: 500 },
										{ key: 'y',  label: 'Offset Y',  step: 1,    min: -500, max: 500 },
										{ key: 'sx', label: 'Scale X',   step: 0.01, min: 0.5,  max: 2 },
										{ key: 'sy', label: 'Scale Y',   step: 0.01, min: 0.5,  max: 2 },
									].map(({ key, label, step, min, max }) => (
										<div key={key} className="cal-row">
											<span className="cal-key">{label}</span>
											<input type="number" className="cal-input"
												value={cal[key]} step={step} min={min} max={max}
												onChange={e => updateCal(continent.mapId, key, +e.target.value)} />
										</div>
									))}
									<button className="cal-reset" onClick={() => resetCal(continent.mapId)}>
										Reset
									</button>
								</div>
							);
						})()}
					</div>
				)}

				{(imgLoading || spawnLoading) && (
					<span className="spawn-loading">
						<Loader size={12} className="spin" />
						{spawnLoading ? 'Spawns laden…' : 'Afbeelding laden…'}
					</span>
				)}
				{!zone && !imgLoading && (
					<span className="spawn-hint">Klik op een zone om in te zoomen</span>
				)}
				{areasError && <span className="spawn-hint" style={{ color: 'var(--danger)' }}>DBC: {areasError}</span>}
			</div>

			{/* ── Body ─────────────────────────────────────────────────────── */}
			<div className="spawn-map-body">
				<div className="map-viewport" ref={viewRef} onMouseDown={onViewMouseDown} onContextMenu={onViewContextMenu}>
					<div className="map-world" style={{
						transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`,
						transformOrigin: '0 0',
						width: IMG_W,
						height: IMG_H,
					}}>
						{bgImage && (
							<img src={bgImage} width={IMG_W} height={IMG_H}
								style={{ display: 'block' }} draggable={false} />
						)}
						{!bgImage && !imgLoading && (
							<div className="map-no-image">Geen afbeelding gevonden</div>
						)}

						{!zone && continentArea && (
							<svg className="map-svg" width={IMG_W} height={IMG_H}
								onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
								onMouseLeave={() => setHoveredZone(null)}>
								{zonesForContinent.map(area => {
									const { cx, cy } = zoneCenter(area, continentArea);
									const hovered = hoveredZone?.id === area.id;
									const r = (hovered ? ZONE_DOT_R * 1.4 : ZONE_DOT_R) / scale;
									return (
										<g key={area.id}
											className="zone-marker"
											onMouseEnter={() => setHoveredZone(area)}
											onMouseLeave={() => setHoveredZone(null)}
											onMouseDown={e => e.stopPropagation()}
											onClick={() => setZone(area)}>
											<circle cx={cx} cy={cy} r={r}
												className={`zone-dot${hovered ? ' hovered' : ''}`}
												vectorEffect="non-scaling-stroke" />
										</g>
									);
								})}
							</svg>
						)}

						{zone && (
							<svg className="map-svg" width={IMG_W} height={IMG_H}>

								{/* GO clusters */}
								{clusterData.goClusters.map((cl, i) => (
									<g key={`goc-${i}`} onClick={e => onClusterClick(e, cl.px, cl.py)}>
										<circle cx={cl.px} cy={cl.py} r={9} className="cluster-bubble go" />
										<text x={cl.px} y={cl.py} className="cluster-label">
											{cl.count > 99 ? '99+' : cl.count}
										</text>
									</g>
								))}

								{/* GO singles */}
								{clusterData.goSingles.map(({ spawn: go }) => {
									const pos = spawnPx(go);
									if (!inBounds(pos)) return null;
									const muted = hasSearch && !matchesSearch(go, searchTerm);
									return (
										<rect key={`go-${go.guid}`}
											x={pos.px - 3} y={pos.py - 3} width={6} height={6}
											className={`spawn-go spawn-marker${isSel(go) ? ' sel' : ''}${muted ? ' muted' : ''}`}
											onClick={() => setSelected({ type: 'go', spawn: go })}
											onMouseDown={e => startDrag(e, go, 'go')}
											onContextMenu={e => onMarkerContextMenu(e, go, 'go')}
										/>
									);
								})}

								{/* Creature clusters */}
								{clusterData.creatureClusters.map((cl, i) => (
									<g key={`cc-${i}`} onClick={e => onClusterClick(e, cl.px, cl.py)}>
										<circle cx={cl.px} cy={cl.py} r={9} className="cluster-bubble creature" />
										<text x={cl.px} y={cl.py} className="cluster-label">
											{cl.count > 99 ? '99+' : cl.count}
										</text>
									</g>
								))}

								{/* Creature singles */}
								{clusterData.creatureSingles.map(({ spawn: c }) => {
									const pos = spawnPx(c);
									if (!inBounds(pos)) return null;
									const cc = creatureClass(c);
									const muted = hasSearch && !matchesSearch(c, searchTerm);
									return (
										<circle key={`c-${c.guid}`}
											cx={pos.px} cy={pos.py} r={cc === 'critter' ? 2 : 3}
											className={`spawn-creature spawn-marker ${cc}${isSel(c) ? ' sel' : ''}${muted ? ' muted' : ''}`}
											onClick={() => setSelected({ type: 'creature', spawn: c })}
											onMouseDown={e => startDrag(e, c, 'creature')}
											onContextMenu={e => onMarkerContextMenu(e, c, 'creature')}
										/>
									);
								})}

								{/* Waypoints */}
								{waypoints.length > 1 && waypoints.map((wp, i) => {
									const next = waypoints[(i + 1) % waypoints.length];
									const a = worldToZonePx(wp.wx, wp.wy, zone);
									const b = worldToZonePx(next.wx, next.wy, zone);
									return <line key={`wpl-${i}`} x1={a.px} y1={a.py} x2={b.px} y2={b.py} className="wp-line" />;
								})}
								{waypoints.map((wp, i) => {
									const { px, py } = worldToZonePx(wp.wx, wp.wy, zone);
									return (
										<g key={`wpn-${i}`} className="wp-node-group">
											<circle cx={px} cy={py} r={4} className="wp-node" />
											<text x={px + 6} y={py + 4} className="wp-label">{wp.point}</text>
										</g>
									);
								})}
							</svg>
						)}
					</div>
				</div>

				{/* ── Zone tooltip ───────────────────────────────────────── */}
				{hoveredZone && (
					<div className="zone-tooltip" style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}>
						{hoveredZone.internalName}
					</div>
				)}

				{/* ── Context-menu ───────────────────────────────────────── */}
				{contextMenu && (
					<div className="ctx-menu" ref={contextMenuRef}
						style={{ left: contextMenu.x, top: contextMenu.y }}>
						{contextMenu.spawn ? <>
							<div className="ctx-item" onClick={ctxCopyCoords}>Coördinaten kopiëren</div>
							<div className="ctx-item" onClick={ctxTeleport}>Teleporteer (.go xyz)</div>
							<div className="ctx-divider" />
							<div className="ctx-item ctx-danger" onClick={ctxDelete}>Spawn verwijderen</div>
						</> : <>
							<div className="ctx-item" onClick={ctxOpenAdd}>Spawn toevoegen…</div>
						</>}
					</div>
				)}

				{/* ── Spawn toevoegen modal ───────────────────────────────── */}
				{addModal && (
					<div className="modal-overlay" onMouseDown={() => setAddModal(null)}>
						<div className="modal-box" onMouseDown={e => e.stopPropagation()}>
							<div className="modal-title">Spawn toevoegen</div>
							<div className="modal-field">
								<label className="modal-label">Type</label>
								<select className="modal-select" value={addType} onChange={e => setAddType(e.target.value)}>
									<option value="creature">Creature</option>
									<option value="go">Gameobject</option>
								</select>
							</div>
							<div className="modal-field">
								<label className="modal-label">Entry ID</label>
								<input type="number" className="modal-input" value={addEntry}
									onChange={e => setAddEntry(e.target.value)}
									onKeyDown={e => { if (e.key === 'Enter') ctxConfirmAdd(); if (e.key === 'Escape') setAddModal(null); }}
									placeholder="bijv. 6"
									autoFocus />
							</div>
							<div className="modal-coords">
								{addModal.wx?.toFixed(2)}, {addModal.wy?.toFixed(2)}, 0
							</div>
							<div className="modal-actions">
								<button className="modal-btn-cancel" onClick={() => setAddModal(null)}>Annuleren</button>
								<button className="modal-btn-ok" onClick={ctxConfirmAdd} disabled={!addEntry}>Toevoegen</button>
							</div>
						</div>
					</div>
				)}

				{/* ── Inspector ──────────────────────────────────────────── */}
				{selected && (
					<div className="spawn-inspector">
						<div className="insp-header">
							<span className={`insp-badge ${selected.type === 'creature' ? 'creature' : 'go'}`}>
								{selected.type === 'creature' ? 'NPC' : 'GO'}
							</span>
							<span className="insp-name">{selected.spawn.name}</span>
							<button className="insp-close" onClick={() => setSelected(null)}>×</button>
						</div>
						<div className="insp-body">
							<div className="insp-section">Spawn</div>
							<div className="insp-row"><span className="insp-key">GUID</span><span className="insp-val">{selected.spawn.guid}</span></div>
							<div className="insp-row"><span className="insp-key">Entry</span><span className="insp-val">{selected.spawn.entry}</span></div>
							<div className="insp-row"><span className="insp-key">X (N/S)</span><span className="insp-val">{selected.spawn.wx?.toFixed(2)}</span></div>
							<div className="insp-row"><span className="insp-key">Y (E/W)</span><span className="insp-val">{selected.spawn.wy?.toFixed(2)}</span></div>
							<div className="insp-row"><span className="insp-key">Z</span><span className="insp-val">{selected.spawn.wz?.toFixed(2)}</span></div>

							{selected.type === 'creature' && <>
								<div className="insp-section">Template</div>
								<div className="insp-row"><span className="insp-key">Level</span><span className="insp-val">{selected.spawn.minlevel}–{selected.spawn.maxlevel}</span></div>
								<div className="insp-row"><span className="insp-key">Faction</span><span className="insp-val">{selected.spawn.faction}</span></div>
								<div className="insp-row"><span className="insp-key">Rank</span><span className="insp-val">{RANK_NAMES[selected.spawn.rank] ?? selected.spawn.rank}</span></div>
								<div className="insp-row"><span className="insp-key">Dmg mod</span><span className="insp-val">{selected.spawn.DamageModifier?.toFixed(2)}</span></div>
								<div className="insp-row"><span className="insp-key">Beweging</span><span className="insp-val">{MOVE_NAMES[selected.spawn.MovementType] ?? selected.spawn.MovementType}</span></div>
								<div className="insp-row"><span className="insp-key">AI</span><span className="insp-val">{selected.spawn.AIName || '—'}</span></div>
								<div className="insp-row"><span className="insp-key">Script</span><span className="insp-val">{selected.spawn.ScriptName || '—'}</span></div>
								{waypoints.length > 0 && <>
									<div className="insp-section">Waypoints ({waypoints.length})</div>
									{waypoints.map(wp => (
										<div key={wp.point} className="insp-row">
											<span className="insp-key">#{wp.point}</span>
											<span className="insp-val">{wp.wx?.toFixed(0)}, {wp.wy?.toFixed(0)}</span>
										</div>
									))}
								</>}
							</>}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
