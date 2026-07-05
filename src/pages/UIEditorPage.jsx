import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, FileText, FolderOpen, LayoutGrid, Maximize2, Minus, Plus, RefreshCcw, RotateCcw, Save, Wand2 } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';

import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import GlueM2Viewer from '../components/glue/GlueM2Viewer';
import './DashboardPage.css';
import './EditorPage.css';
import './UIEditorPage.css';

const SCREEN_PRESETS = [
  {
    id: 'login',
    label: 'Login Screen',
    description: 'Account login glue UI with the main Northrend backdrop.',
    previewModelPath: 'Interface\\GLUES\\MODELS\\UI_MAINMENU_NORTHREND\\UI_MainMenu_Northrend.m2',
    previewBlp: 'Interface\\GLUES\\MODELS\\UI_MAINMENU_NORTHREND\\WotLK_Login_Citadel01.blp',
    files: [
      { path: 'Interface\\GlueXML\\AccountLogin.xml', kind: 'xml', label: 'AccountLogin.xml' },
      { path: 'Interface\\GlueXML\\AccountLogin.lua', kind: 'lua', label: 'AccountLogin.lua' },
      { path: 'Interface\\GlueXML\\GlueStrings.lua', kind: 'lua', label: 'GlueStrings.lua' },
      { path: 'Interface\\GlueXML\\GlueParent.xml', kind: 'xml', label: 'GlueParent.xml' },
    ],
  },
  {
    id: 'char-select',
    label: 'Character Select',
    description: 'Realm character list, buttons, and screen layout.',
    previewModelPath: 'Interface\\Glues\\MODELS\\UI_CharacterSelect\\UI_CharacterSelect.M2',
    previewBlp: 'Interface\\Glues\\MODELS\\UI_CharacterSelect\\UI_CharacterSelectTEX.blp',
    files: [
      { path: 'Interface\\GlueXML\\CharacterSelect.xml', kind: 'xml', label: 'CharacterSelect.xml' },
      { path: 'Interface\\GlueXML\\CharacterSelect.lua', kind: 'lua', label: 'CharacterSelect.lua' },
    ],
  },
  {
    id: 'char-create',
    label: 'Character Create',
    description: 'Race selection and character creation glue screen.',
    previewModelPath: 'Interface\\GLUES\\MODELS\\UI_Orc\\UI_Orc.m2',
    previewBlp: 'Interface\\GLUES\\CHARACTERCREATE\\UI-CharacterCreate-Banners.blp',
    files: [
      { path: 'Interface\\GlueXML\\CharacterCreate.xml', kind: 'xml', label: 'CharacterCreate.xml' },
      { path: 'Interface\\GlueXML\\CharacterCreate.lua', kind: 'lua', label: 'CharacterCreate.lua' },
      { path: 'Interface\\GlueXML\\RaceSelect.xml', kind: 'xml', label: 'RaceSelect.xml' },
      { path: 'Interface\\GlueXML\\RaceSelect.lua', kind: 'lua', label: 'RaceSelect.lua' },
    ],
  },
];

function getPreset(id) {
  return SCREEN_PRESETS.find(s => s.id === id) || SCREEN_PRESETS[0];
}

const UI_BASE_W = 1024;
const UI_BASE_H = 768;
const UI_TAGS = new Set(['Frame', 'Button', 'CheckButton', 'EditBox', 'FontString', 'Texture', 'ModelFFX', 'Model', 'StatusBar', 'Slider']);

function clamp01(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseColorChannels(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (!value) return null;

  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const raw = hex[1];
    const expand = raw.length === 3 || raw.length === 4;
    const parts = expand ? raw.split('').map(ch => ch + ch) : raw.match(/.{1,2}/g) || [];
    const channels = parts.map(part => parseInt(part, 16));
    if (channels.length >= 3) return [channels[0], channels[1], channels[2], channels.length >= 4 ? channels[3] : 255];
  }

  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map(part => part.trim());
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = parts.length >= 4 ? Number(parts[3]) : 1;
      if ([r, g, b, a].every(Number.isFinite)) return [r, g, b, a <= 1 ? Math.round(a * 255) : a];
    }
  }

  return null;
}

function channelsToRgba([r, g, b, a = 255]) {
  return `rgba(${clamp01(r)}, ${clamp01(g)}, ${clamp01(b)}, ${(clamp01(a) / 255).toFixed(2)})`;
}

function deriveButtonGradient(color, fallback = 'linear-gradient(180deg, rgba(57, 112, 188, 0.96), rgba(17, 56, 110, 0.96))') {
  const channels = parseColorChannels(color);
  if (!channels) return fallback;
  const [r, g, b, a] = channels;
  const top = channelsToRgba([r + 22, g + 22, b + 22, a]);
  const bottom = channelsToRgba([r - 18, g - 18, b - 18, a]);
  return `linear-gradient(180deg, ${top}, ${bottom})`;
}


function getLoginWidgetSourcePaths(widget) {
  const xmlPath = 'Interface\\GlueXML\\AccountLogin.xml';
  const luaPath = 'Interface\\GlueXML\\AccountLogin.lua';
  const stringsPath = 'Interface\\GlueXML\\GlueStrings.lua';
  const definitionPath = xmlPath;
  const actionPath = widget?.kind === 'button' ? (widget.actionKind === 'url' ? stringsPath : luaPath) : null;
  return { definitionPath, actionPath, xmlPath, luaPath, stringsPath };
}

function firstDirectChild(el, tags) {
  for (const child of Array.from(el?.children || [])) {
    if (tags.includes(child.tagName)) return child;
  }
  return null;
}

function getTextValue(el) {
  const text = String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  return text && text.length <= 120 ? text : '';
}

function parseAnchor(el) {
  const anchors = firstDirectChild(el, ['Anchors']);
  const anchor = anchors ? firstDirectChild(anchors, ['Anchor', 'Point']) : firstDirectChild(el, ['Anchor', 'Point']);
  if (!anchor) return null;

  const point = (anchor.getAttribute('point') || anchor.getAttribute('relativePoint') || 'CENTER').toUpperCase();
  const offset = firstDirectChild(anchor, ['Offset']);
  const x = Number(offset?.getAttribute('x') ?? anchor.getAttribute('x') ?? 0);
  const y = Number(offset?.getAttribute('y') ?? anchor.getAttribute('y') ?? 0);

  return {
    point,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function parseSize(el) {
  const size = firstDirectChild(el, ['Size']);
  const w = Number(size?.getAttribute('x') ?? size?.getAttribute('width') ?? el?.getAttribute?.('width') ?? 0);
  const h = Number(size?.getAttribute('y') ?? size?.getAttribute('height') ?? el?.getAttribute?.('height') ?? 0);
  return {
    w: Number.isFinite(w) ? w : 0,
    h: Number.isFinite(h) ? h : 0,
  };
}

function anchorToTopLeft(point, w, h) {
  const p = (point || 'CENTER').toUpperCase();
  const origin = {
    TOPLEFT: [0, 0],
    TOP: [UI_BASE_W / 2, 0],
    TOPRIGHT: [UI_BASE_W, 0],
    LEFT: [0, UI_BASE_H / 2],
    CENTER: [UI_BASE_W / 2, UI_BASE_H / 2],
    RIGHT: [UI_BASE_W, UI_BASE_H / 2],
    BOTTOMLEFT: [0, UI_BASE_H],
    BOTTOM: [UI_BASE_W / 2, UI_BASE_H],
    BOTTOMRIGHT: [UI_BASE_W, UI_BASE_H],
  }[p] || [UI_BASE_W / 2, UI_BASE_H / 2];

  const offset = {
    TOPLEFT: [0, 0],
    TOP: [-w / 2, 0],
    TOPRIGHT: [-w, 0],
    LEFT: [0, -h / 2],
    CENTER: [-w / 2, -h / 2],
    RIGHT: [-w, -h / 2],
    BOTTOMLEFT: [0, -h],
    BOTTOM: [-w / 2, -h],
    BOTTOMRIGHT: [-w, -h],
  }[p] || [-w / 2, -h / 2];

  return {
    x: origin[0] + offset[0],
    y: origin[1] + offset[1],
  };
}

function parseSceneNodes(xmlText, sourceId = 'xml') {
  if (!xmlText) return [];
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return [];

    const nodes = [];
    const visit = (el, depth = 0, path = []) => {
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName;
      if (UI_TAGS.has(tag)) {
        const name = el.getAttribute('name') || '';
        const inherits = el.getAttribute('inherits') || '';
        const hidden = (el.getAttribute('hidden') || '').toLowerCase() === 'true';
        const virtual = (el.getAttribute('virtual') || '').toLowerCase() === 'true';
        const size = parseSize(el);
        const anchor = parseAnchor(el);
        const box = anchor
          ? anchorToTopLeft(anchor.point, size.w || 120, size.h || 32)
          : { x: UI_BASE_W / 2 - (size.w || 120) / 2, y: UI_BASE_H / 2 - (size.h || 32) / 2 };
        const text = getTextValue(el);
        const file = el.getAttribute('file') || el.getAttribute('texture') || '';
        const key = [sourceId, ...path, tag, name, text, file].filter(Boolean).join(':');

        if (name || text || file || ['Button', 'EditBox', 'FontString', 'Texture', 'ModelFFX', 'Model'].includes(tag)) {
          nodes.push({
            id: key,
            tag,
            name,
            inherits,
            text,
            file,
            hidden,
            virtual,
            depth,
            x: box.x,
            y: box.y,
            w: size.w || (tag === 'FontString' ? 240 : 120),
            h: size.h || (tag === 'FontString' ? 28 : 32),
          });
        }
      }
      let childIndex = 0;
      for (const child of Array.from(el.children || [])) {
        visit(child, depth + 1, path.concat(childIndex));
        childIndex += 1;
      }
    };

    visit(doc.documentElement, 0, []);
    return nodes.slice(0, 180);
  } catch {
    return [];
  }
}

function buildRuntimeSummary(screenId, sources = [], nodes = [], modelPath = '') {
  const luaSource = sources.find(src => (src.kind || '').toLowerCase() === 'lua') || null;
  const xmlSources = sources.filter(src => (src.kind || '').toLowerCase() !== 'lua');
  const luaText = luaSource?.text || '';
  const xmlText = xmlSources.map(src => src.text || '').join('\n');

  const modelCalls = Array.from(luaText.matchAll(/SetModel\((['\"])(.*?)\1\)/g)).map(match => match[2]);
  const cameraCalls = Array.from(luaText.matchAll(/SetCamera\((\d+)\)/g)).map(match => match[1]);
  const sequenceCalls = Array.from(luaText.matchAll(/SetSequence\((\d+)\)/g)).map(match => match[1]);
  const hookMatches = Array.from(luaText.matchAll(/(?:AccountLogin|WoWAccountSelect|CharacterCreate|RaceSelect)_[A-Za-z0-9_]+/g)).map(match => match[0]);
  const stateMatches = Array.from(luaText.matchAll(/Is[A-Za-z0-9_]+\(\)|Has[A-Za-z0-9_]+\(\)/g)).map(match => match[0]);
  const nodeMatches = nodes
    .filter(node => node.name || node.text || node.file)
    .slice(0, 8)
    .map(node => node.name || node.text || node.file || node.tag);

  const overlayLabels = [];
  const pushLabels = (sourceText, patterns) => {
    for (const pattern of patterns) {
      for (const match of sourceText.matchAll(pattern)) {
        if (match?.[1]) overlayLabels.push(match[1]);
      }
    }
  };
  pushLabels(xmlText, [
    /<ModelFFX[^>]*name="([^"]+)"/g,
    /<Frame[^>]*name="([^"]+)"/g,
    /<Button[^>]*name="([^"]+)"/g,
    /<EditBox[^>]*name="([^"]+)"/g,
    /<FontString[^>]*name="([^"]+)"/g,
    /<Texture[^>]*name="([^"]+)"/g,
  ]);

  const labelPool = Array.from(new Set([...nodeMatches, ...overlayLabels]));
  const pickLabels = (...keywords) => labelPool.filter(label => keywords.some(keyword => label.toLowerCase().includes(keyword))).slice(0, 6);
  const loginFields = pickLabels('accountlogin', 'accountname', 'password', 'token', 'remember', 'launcher', 'save');
  const loginActions = pickLabels('optionsbutton', 'cinematics', 'credits', 'terms', 'community', 'manageaccount', 'upgradeaccount', 'exit');
  const loginDialogs = pickLabels('virtualkeypad', 'serveralert', 'wowaccountselect', 'changedoptions', 'tosframe', 'survey', 'connectionhelp');
  const luaFlow = Array.from(new Set([...hookMatches, ...stateMatches])).slice(0, 12);

  return {
    screenId,
    modelPath,
    modelCalls: Array.from(new Set(modelCalls)),
    cameraCalls: Array.from(new Set(cameraCalls)),
    sequenceCalls: Array.from(new Set(sequenceCalls)),
    hookMatches: Array.from(new Set(hookMatches)),
    stateMatches: Array.from(new Set(stateMatches)),
    overlayLabels: labelPool.slice(0, 12),
    loginFields,
    loginActions,
    loginDialogs,
    luaFlow,
  };
}

function buildLoginFocusWidgets(drafts = {}) {
  const base = [
    { id: 'logo', node: 'AccountLoginLogo', kind: 'brand', text: 'WORLD OF WARCRAFT', subtext: 'CAIO EDITION', x: 0.50, y: 0.13, w: 0.36, h: 0.14, fill: 'transparent', textColor: '#f0c463', borderColor: 'transparent' },
    { id: 'account-label', node: 'AccountLoginAccountEdit', kind: 'label', text: 'Battle.net Account Name', x: 0.50, y: 0.34, w: 0.26, h: 0.03, fill: 'transparent', textColor: '#f0c463', borderColor: 'transparent' },
    { id: 'account-field', node: 'AccountLoginAccountEdit', kind: 'input', value: 'Redleaf1', x: 0.50, y: 0.40, w: 0.23, h: 0.060, fill: 'rgba(14, 17, 24, 0.92)', textColor: '#e9f1ff', borderColor: 'rgba(111, 128, 154, 0.8)' },
    { id: 'password-label', node: 'AccountLoginPasswordEdit', kind: 'label', text: 'Password', x: 0.50, y: 0.50, w: 0.14, h: 0.03, fill: 'transparent', textColor: '#f0c463', borderColor: 'transparent' },
    { id: 'password-field', node: 'AccountLoginPasswordEdit', kind: 'input', value: '', x: 0.50, y: 0.56, w: 0.23, h: 0.060, fill: 'rgba(14, 17, 24, 0.92)', textColor: '#e9f1ff', borderColor: 'rgba(111, 128, 154, 0.8)' },
    { id: 'login-button', node: 'AccountLoginLoginButton', kind: 'button', text: 'Login', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLogin_Login()', x: 0.50, y: 0.66, w: 0.24, h: 0.062, fill: 'linear-gradient(180deg, rgba(57, 112, 188, 0.96), rgba(17, 56, 110, 0.96))', buttonColor: '#3970bc', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.85)' },
    { id: 'remember', node: 'AccountLoginSaveAccountName', kind: 'checkbox', text: 'Remember Account Name', x: 0.50, y: 0.74, w: 0.30, h: 0.040, fill: 'transparent', textColor: '#f2d78d', borderColor: 'transparent' },
    { id: 'left-manage', node: 'AccountLoginManageAccountButton', kind: 'button', text: 'Manage Account', actionKind: 'url', actionLabel: 'URL', actionValue: 'AUTH_NO_TIME_URL', x: 0.08, y: 0.81, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'left-community', node: 'AccountLoginCommunityButton', kind: 'button', text: 'Community Site', actionKind: 'url', actionLabel: 'URL', actionValue: 'COMMUNITY_URL', x: 0.08, y: 0.89, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'right-options', node: 'OptionsButton', kind: 'button', text: 'Options', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLogin_Options()', x: 0.92, y: 0.65, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'right-cinematics', node: 'AccountLoginCinematicsButton', kind: 'button', text: 'Cinematics', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLogin_Cinematics()', x: 0.92, y: 0.73, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'right-credits', node: 'AccountLoginCreditsButton', kind: 'button', text: 'Credits', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLogin_Credits()', x: 0.92, y: 0.81, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'right-terms', node: 'AccountLoginTOSButton', kind: 'button', text: 'Terms of Use', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLogin_Terms()', x: 0.92, y: 0.89, w: 0.16, h: 0.045, fill: 'linear-gradient(180deg, rgba(43, 95, 168, 0.94), rgba(17, 44, 87, 0.94))', buttonColor: '#2b5fa8', textColor: '#ffd77e', borderColor: 'rgba(112, 169, 255, 0.75)' },
    { id: 'version', node: 'AccountLoginVersion', kind: 'label', text: 'Version 3.3.5 (12340) (Release)', x: 0.03, y: 0.95, w: 0.18, h: 0.04, fill: 'transparent', textColor: '#f0c463', borderColor: 'transparent' },
    { id: 'esrb', node: 'ESRB', kind: 'panel', text: 'ESRB Notice', subtext: 'Game Experience May Change During Online Play', x: 0.08, y: 0.93, w: 0.12, h: 0.08, fill: 'rgba(255,255,255,0.92)', textColor: '#1f1f1f', borderColor: 'rgba(0,0,0,0.2)' },
    { id: 'realm', node: 'AccountLoginDropDown', kind: 'button', text: 'Realm', actionKind: 'lua', actionLabel: 'OnClick', actionValue: 'AccountLoginDropDown_OnClick()', x: 0.16, y: 0.05, w: 0.18, h: 0.045, fill: 'linear-gradient(180deg, rgba(30, 37, 48, 0.92), rgba(16, 19, 26, 0.92))', buttonColor: '#1e2530', textColor: '#e9f1ff', borderColor: 'rgba(111, 128, 154, 0.75)' },
  ];
  return base.map(widget => {
    const draft = drafts[widget.id] || {};
    return {
      ...widget,
      text: draft.text ?? widget.text,
      value: draft.value ?? widget.value ?? '',
      subtext: draft.subtext ?? widget.subtext ?? '',
      fill: draft.fill ?? widget.fill,
      buttonColor: draft.buttonColor ?? widget.buttonColor,
      actionKind: draft.actionKind ?? widget.actionKind,
      actionLabel: draft.actionLabel ?? widget.actionLabel,
      actionValue: draft.actionValue ?? widget.actionValue,
      textColor: draft.textColor ?? widget.textColor,
      borderColor: draft.borderColor ?? widget.borderColor,
      x: draft.x ?? widget.x,
      y: draft.y ?? widget.y,
      w: draft.w ?? widget.w,
      h: draft.h ?? widget.h,
    };
  });
}

function ScenePreview({ title, blpPath, xmlSources, modelPath, onOpenSource }) {
  const nodes = useMemo(() => (xmlSources || []).flatMap(src => parseSceneNodes(src.text, src.id)), [xmlSources]);
  const runtime = useMemo(() => buildRuntimeSummary(title, xmlSources, nodes, modelPath), [title, xmlSources, nodes, modelPath]);
  const stageRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState('fit');

  useEffect(() => {
    const update = () => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return;
      const nextFit = Math.min(rect.width / UI_BASE_W, rect.height / UI_BASE_H);
      setFitScale(Number.isFinite(nextFit) && nextFit > 0 ? nextFit : 1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const isLoginPreset = /login/i.test(title);
  const [focusMode, setFocusMode] = useState(true);
  const [selectedWidgetId, setSelectedWidgetId] = useState('account-field');
  const [widgetDrafts, setWidgetDrafts] = useState({});
  const loginWidgets = useMemo(() => (isLoginPreset ? buildLoginFocusWidgets(widgetDrafts) : []), [isLoginPreset, widgetDrafts]);
  const selectedWidget = loginWidgets.find(widget => widget.id === selectedWidgetId) || loginWidgets[0] || null;
  const selectedDraft = widgetDrafts[selectedWidget?.id || ''] || {};
  const loginSourcePaths = selectedWidget ? getLoginWidgetSourcePaths(selectedWidget) : null;
  const openDefinitionSource = () => onOpenSource?.(loginSourcePaths?.definitionPath);
  const openActionSource = () => onOpenSource?.(loginSourcePaths?.actionPath);

  const focusCanvasRef = useRef(null);
  const dragRef = useRef(null);
  const clamp01 = (value, min, max) => Math.min(max, Math.max(min, value));
  const scale = zoomMode === 'fit' ? fitScale * zoom : zoom;

  useEffect(() => {
    if (isLoginPreset) setFocusMode(true);
  }, [isLoginPreset]);

  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = focusCanvasRef.current?.getBoundingClientRect();
      const width = rect?.width || drag.rectWidth || 1;
      const height = rect?.height || drag.rectHeight || 1;
      const nextX = clamp01(drag.baseX + (event.clientX - drag.startX) / width, 0, 1 - drag.baseW);
      const nextY = clamp01(drag.baseY + (event.clientY - drag.startY) / height, 0, 1 - drag.baseH);
      setWidgetDrafts(prev => ({
        ...prev,
        [drag.id]: { ...(prev[drag.id] || {}), x: nextX, y: nextY },
      }));
    };
    const onEnd = (event) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, []);

  const startWidgetDrag = (widget, event) => {
    if (!widget || widget.kind === 'input') return;
    setSelectedWidgetId(widget.id);
    const rect = focusCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id: widget.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: selectedDraft.x ?? widget.x,
      baseY: selectedDraft.y ?? widget.y,
      baseW: widget.w,
      baseH: widget.h,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  if (isLoginPreset && focusMode) {
    return (
      <div className="ui-editor-scene ui-editor-scene-focus">
        <div className="ui-editor-scene-stage ui-editor-scene-stage-focus" ref={stageRef}>
          <div className="ui-editor-scene-controls">
            <button type="button" className="ui-editor-scene-control ui-editor-scene-control-wide" onClick={() => setFocusMode(false)} title="Show backdrop">
              <Wand2 size={14} /> UI Focus
            </button>
            <button type="button" className="ui-editor-scene-control" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="Zoom out">
              <Minus size={14} />
            </button>
            <button type="button" className="ui-editor-scene-control" onClick={() => setZoom(z => Math.min(2.5, +(z + 0.1).toFixed(2)))} title="Zoom in">
              <Plus size={14} />
            </button>
            <button type="button" className="ui-editor-scene-control" onClick={() => { setZoom(1); setZoomMode('fit'); }} title="Fit to screen">
              <Maximize2 size={14} />
            </button>
            <div className="ui-editor-scene-scale mono">{Math.round(scale * 100)}%</div>
          </div>

          <div className="ui-editor-scene-focus-shell">
            <div className="ui-editor-scene-focus-stage">
              <div className="ui-editor-scene-viewport is-focus" style={{ transform: 'translate(-50%, -50%) scale(' + (scale * 1.14) + ')', width: UI_BASE_W, height: UI_BASE_H }}>
                <div className="ui-editor-login-canvas" ref={focusCanvasRef}>
                  <div className="ui-editor-login-backdrop" />
                  <div className="ui-editor-login-aurora" />
                  <div className="ui-editor-login-grid" />
                  <div className="ui-editor-login-brand">
                    <div className="ui-editor-login-brand-main">World of Warcraft</div>
                    <div className="ui-editor-login-brand-sub">Caio Edition</div>
                  </div>

                  <div className="ui-editor-login-widgets">
                    {loginWidgets.map(widget => {
                      const draft = widgetDrafts[widget.id] || {};
                      const selected = widget.id === selectedWidgetId;
                      const style = {
                        left: (widget.x * 100) + '%',
                        top: (widget.y * 100) + '%',
                        width: (widget.w * 100) + '%',
                        height: (widget.h * 100) + '%',
                        color: widget.textColor,
                        borderColor: widget.borderColor,
                        background: widget.kind === 'button' ? (draft.fill ?? widget.fill) : widget.fill,
                        zIndex: selected ? 20 : (widget.kind === 'button' ? 12 : 8),
                        touchAction: 'none',
                        userSelect: 'none',
                      };
                      const common = {
                        key: widget.id,
                        type: 'button',
                        className: 'ui-editor-login-widget ui-editor-login-widget-' + widget.kind + (selected ? ' selected' : ''),
                        style,
                        title: widget.node,
                        onPointerDown: (event) => startWidgetDrag(widget, event),
                        onClick: () => { setSelectedWidgetId(widget.id); onOpenSource?.('Interface\\GlueXML\\AccountLogin.xml'); },
                      };

                      if (widget.kind === 'input') {
                        return (
                          <div key={widget.id} className={'ui-editor-login-widget ui-editor-login-widget-input' + (selected ? ' selected' : '')} style={style} title={widget.node} onClick={() => setSelectedWidgetId(widget.id)}>
                            <div className="ui-editor-login-widget-label">{widget.text}</div>
                            <input
                              className="ui-editor-login-input mono"
                              value={selectedDraft.value ?? widget.value ?? ''}
                              placeholder={widget.text}
                              onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [widget.id]: { ...(prev[widget.id] || {}), value: e.target.value } }))}
                            />
                          </div>
                        );
                      }

                      if (widget.kind === 'checkbox') {
                        return (
                          <button {...common}>
                            <span className="ui-editor-login-checkbox">ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¹Ãƒâ€¦Ã¢â‚¬Å“</span>
                            <span>{selectedDraft.text ?? widget.text}</span>
                          </button>
                        );
                      }

                      if (widget.kind === 'brand') {
                        return (
                          <button {...common} className={common.className + ' brand'}>
                            <span className="ui-editor-login-brand-main">{selectedDraft.text ?? widget.text}</span>
                            <span className="ui-editor-login-brand-sub">{selectedDraft.subtext ?? widget.subtext}</span>
                          </button>
                        );
                      }

                      if (widget.kind === 'panel') {
                        return (
                          <button {...common} className={common.className + ' panel'}>
                            <span className="ui-editor-login-panel-title">{selectedDraft.text ?? widget.text}</span>
                            <span className="ui-editor-login-panel-sub">{selectedDraft.subtext ?? widget.subtext}</span>
                          </button>
                        );
                      }

                      return (
                        <button {...common}>
                          <span>{selectedDraft.text ?? widget.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="ui-editor-scene-inspector">
              <div className="ui-editor-scene-inspector-title">Selected Control</div>
              <div className="ui-editor-scene-inspector-subtitle">{selectedWidget?.node || 'No control selected'}</div>
              {selectedWidget && (
                <div className="ui-editor-scene-inspector-form">
                  <label>
                    <span>Text</span>
                    <input
                      type="text"
                      value={selectedDraft.value ?? selectedDraft.text ?? selectedWidget.value ?? selectedWidget.text ?? ''}
                      onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), value: e.target.value, text: e.target.value } }))}
                    />
                  </label>
                  {selectedWidget.kind === 'button' ? (
                    <>
                      <label>
                        <span>{selectedDraft.actionLabel ?? selectedWidget.actionLabel ?? 'Action'}</span>
                        <input
                          type="text"
                          value={selectedDraft.actionValue ?? selectedWidget.actionValue ?? ''}
                          placeholder={selectedWidget.actionKind === 'url' ? 'https://...' : 'OnClick script or function'}
                          onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), actionValue: e.target.value } }))}
                        />
                      </label>
                      <label>
                        <span>Button color</span>
                        <input
                          type="color"
                          value={(selectedDraft.buttonColor ?? selectedWidget.buttonColor ?? '#3970bc').startsWith('#') ? (selectedDraft.buttonColor ?? selectedWidget.buttonColor ?? '#3970bc') : '#3970bc'}
                          onChange={(e) => {
                            const buttonColor = e.target.value;
                            setWidgetDrafts(prev => ({
                              ...prev,
                              [selectedWidget.id]: {
                                ...(prev[selectedWidget.id] || {}),
                                buttonColor,
                                fill: deriveButtonGradient(buttonColor),
                              },
                            }));
                          }}
                        />
                      </label>
                      <label>
                        <span>Fill</span>
                        <input
                          type="text"
                          value={selectedDraft.fill ?? selectedWidget.fill ?? deriveButtonGradient(selectedDraft.buttonColor ?? selectedWidget.buttonColor ?? '#3970bc')}
                          onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), fill: e.target.value } }))}
                        />
                      </label>
                    </>
                  ) : (
                    <label>
                      <span>Fill</span>
                      <input
                        type="text"
                        value={selectedDraft.fill ?? selectedWidget.fill ?? ''}
                        onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), fill: e.target.value } }))}
                      />
                    </label>
                  )}
                  <label>
                    <span>Source</span>
                    <div className="ui-editor-scene-runtime-chip-row">
                      <button type="button" className="ui-editor-scene-runtime-chip mono" onClick={openDefinitionSource}>XML</button>
                      {loginSourcePaths?.actionPath && (
                        <button type="button" className="ui-editor-scene-runtime-chip mono" onClick={openActionSource}>
                          {selectedWidget.actionKind === 'url' ? 'Strings' : 'Lua'}
                        </button>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>Text color</span>
                    <input
                      type="color"
                      value={(selectedDraft.textColor ?? selectedWidget.textColor ?? '#ffffff').startsWith('#') ? (selectedDraft.textColor ?? selectedWidget.textColor ?? '#ffffff') : '#ffffff'}
                      onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), textColor: e.target.value } }))}
                    />
                  </label>
                  <div className="ui-editor-scene-inspector-grid">
                    <label>
                      <span>X</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(((selectedDraft.x ?? selectedWidget.x) || 0) * 100)}
                        onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), x: Number(e.target.value) / 100 } }))}
                      />
                    </label>
                    <label>
                      <span>Y</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(((selectedDraft.y ?? selectedWidget.y) || 0) * 100)}
                        onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), y: Number(e.target.value) / 100 } }))}
                      />
                    </label>
                    <label>
                      <span>W</span>
                      <input
                        type="range"
                        min="5"
                        max="60"
                        value={Math.round(((selectedDraft.w ?? selectedWidget.w) || 0) * 100)}
                        onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), w: Number(e.target.value) / 100 } }))}
                      />
                    </label>
                    <label>
                      <span>H</span>
                      <input
                        type="range"
                        min="2"
                        max="20"
                        value={Math.round(((selectedDraft.h ?? selectedWidget.h) || 0) * 100)}
                        onChange={(e) => setWidgetDrafts(prev => ({ ...prev, [selectedWidget.id]: { ...(prev[selectedWidget.id] || {}), h: Number(e.target.value) / 100 } }))}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-editor-scene">
      <div className="ui-editor-scene-stage" ref={stageRef}>
        <div className="ui-editor-scene-controls">
          <button type="button" className="ui-editor-scene-control" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="Zoom out">
            <Minus size={14} />
          </button>
          <button type="button" className="ui-editor-scene-control" onClick={() => setZoom(z => Math.min(2.5, +(z + 0.1).toFixed(2)))} title="Zoom in">
            <Plus size={14} />
          </button>
          <button type="button" className="ui-editor-scene-control" onClick={() => { setZoom(1); setZoomMode('fit'); }} title="Fit to screen">
            <Maximize2 size={14} />
          </button>
          <button type="button" className="ui-editor-scene-control" onClick={() => { setZoom(1); setZoomMode('free'); }} title="1:1 view">
            <RotateCcw size={14} />
          </button>
          {isLoginPreset && (
            <button type="button" className="ui-editor-scene-control ui-editor-scene-control-wide" onClick={() => setFocusMode(true)} title="Edit UI controls">
              <Wand2 size={14} /> UI Focus
            </button>
          )}
          <div className="ui-editor-scene-scale mono">{Math.round(scale * 100)}%</div>
        </div>

        <div className="ui-editor-scene-viewport" style={{ transform: 'translate(-50%, -50%) scale(' + scale + ')', width: UI_BASE_W, height: UI_BASE_H }}>
          <GlueM2Viewer active={!!modelPath} modelPath={modelPath} title={title} />

          <div className="ui-editor-scene-overlay">
            {nodes.length === 0 ? (
              <div className="ui-editor-scene-empty">No XML frames parsed yet.</div>
            ) : nodes.map(node => (
              <button
                key={node.id}
                type="button"
                className={"ui-editor-scene-node tag-" + node.tag.toLowerCase() + (node.hidden ? ' is-hidden' : '')}
                style={{
                  left: Math.max(0, Math.min(100, node.x / UI_BASE_W * 100)) + '%',
                  top: Math.max(0, Math.min(100, node.y / UI_BASE_H * 100)) + '%',
                  width: Math.max(3, Math.min(100, node.w / UI_BASE_W * 100)) + '%',
                  height: Math.max(3, Math.min(100, node.h / UI_BASE_H * 100)) + '%',
                }}
                title={[
                  node.tag,
                  node.name ? 'name=' + node.name : null,
                  node.inherits ? 'inherits=' + node.inherits : null,
                  node.text ? 'text=' + node.text : null,
                  node.file ? 'file=' + node.file : null,
                ].filter(Boolean).join(' | ')}
              >
                <span className="ui-editor-scene-node-label">
                  {node.name || node.text || node.tag}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="ui-editor-scene-badge">
          <div className="ui-editor-scene-badge-title">{title}</div>
          {modelPath && <div className="ui-editor-scene-badge-line mono">{modelPath}</div>}
          {blpPath && <div className="ui-editor-scene-badge-line mono">{blpPath}</div>}
        </div>
      </div>
      <div className="ui-editor-scene-runtime">
        <div className="ui-editor-scene-runtime-title">Runtime Map</div>
        <div className="ui-editor-scene-runtime-stats">
          <div className="ui-editor-scene-runtime-stat">
            <span className="ui-editor-scene-runtime-stat-label">Backdrop</span>
            <strong>{runtime.modelCalls.length || 1}</strong>
            <span>model call(s)</span>
          </div>
          <div className="ui-editor-scene-runtime-stat">
            <span className="ui-editor-scene-runtime-stat-label">Overlay</span>
            <strong>{runtime.overlayLabels.length}</strong>
            <span>UI nodes</span>
          </div>
          <div className="ui-editor-scene-runtime-stat">
            <span className="ui-editor-scene-runtime-stat-label">Lua</span>
            <strong>{runtime.luaFlow.length}</strong>
            <span>hooks</span>
          </div>
        </div>

        <div className="ui-editor-scene-runtime-grid">
          <section className="ui-editor-scene-runtime-card backdrop">
            <div className="ui-editor-scene-runtime-label">Backdrop & camera</div>
            <div className="ui-editor-scene-runtime-line mono">{runtime.modelPath || 'No model path set'}</div>
            {runtime.modelCalls.map(call => <div key={call} className="ui-editor-scene-runtime-chip mono">{call}</div>)}
            {runtime.cameraCalls.length > 0 && <div className="ui-editor-scene-runtime-chip mono">Camera {runtime.cameraCalls.join(', ')}</div>}
            {runtime.sequenceCalls.length > 0 && <div className="ui-editor-scene-runtime-chip mono">Sequence {runtime.sequenceCalls.join(', ')}</div>}
          </section>

          <section className="ui-editor-scene-runtime-card fields">
            <div className="ui-editor-scene-runtime-label">Login fields</div>
            <div className="ui-editor-scene-runtime-chip-row">
              {runtime.loginFields.length === 0 ? <span className="ui-editor-scene-runtime-chip mono muted">No login fields</span> : runtime.loginFields.map(label => <span key={label} className="ui-editor-scene-runtime-chip mono">{label}</span>)}
            </div>
          </section>

          <section className="ui-editor-scene-runtime-card actions">
            <div className="ui-editor-scene-runtime-label">Actions</div>
            <div className="ui-editor-scene-runtime-chip-row">
              {runtime.loginActions.length === 0 ? <span className="ui-editor-scene-runtime-chip mono muted">No actions</span> : runtime.loginActions.map(label => <span key={label} className="ui-editor-scene-runtime-chip mono">{label}</span>)}
            </div>
          </section>

          <section className="ui-editor-scene-runtime-card dialogs">
            <div className="ui-editor-scene-runtime-label">Dialogs</div>
            <div className="ui-editor-scene-runtime-chip-row">
              {runtime.loginDialogs.length === 0 ? <span className="ui-editor-scene-runtime-chip mono muted">No dialogs</span> : runtime.loginDialogs.map(label => <span key={label} className="ui-editor-scene-runtime-chip mono">{label}</span>)}
            </div>
          </section>

          <section className="ui-editor-scene-runtime-card lua">
            <div className="ui-editor-scene-runtime-label">Lua flow</div>
            <div className="ui-editor-scene-runtime-chip-row">
              {runtime.luaFlow.length === 0 ? <span className="ui-editor-scene-runtime-chip mono muted">No Lua hooks parsed yet</span> : runtime.luaFlow.map(label => <span key={label} className="ui-editor-scene-runtime-chip mono">{label}</span>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function UIEditorPage() {
  const { worldmapMpqPath } = useConnection();
  const [screenId, setScreenId] = useState('login');
  const preset = useMemo(() => getPreset(screenId), [screenId]);
  const [screenFiles, setScreenFiles] = useState({});
  const [activePath, setActivePath] = useState(preset.files[0].path);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);


  const unsavedGuard = useUnsavedGuard(dirty);

  const currentFiles = preset.files;
  const activeFile = screenFiles[activePath] || null;
  const sceneXmlSources = useMemo(() => currentFiles.map(file => ({
      id: file.path,
      kind: file.kind,
      text: screenFiles[file.path]?.text || '',
    })), [currentFiles, screenFiles]);

  useEffect(() => {
    setActivePath(preset.files[0]?.path || '');
  }, [preset]);

  const loadPreset = useCallback(async (nextId = screenId) => {
    const nextPreset = getPreset(nextId);
    if (!worldmapMpqPath) {
      setMsg({ type: 'error', text: 'Set the Client Data path in Settings first.' });
      return;
    }

    setLoading(true);
    setMsg(null);
    try {
      const results = await Promise.all(nextPreset.files.map(async file => {
        const res = await window.azeroth.glue.readTextFile(worldmapMpqPath, file.path);
        return { file, res };
      }));

      const nextFiles = {};
      for (const { file, res } of results) {
        nextFiles[file.path] = {
          ...file,
          text: res?.success ? String(res.text ?? '') : '',
          loaded: !!res?.success,
          error: res?.success ? null : (res?.error || 'Not found'),
        };
      }

      setScreenFiles(nextFiles);
      setActivePath(nextPreset.files[0]?.path || '');
      setDirty(false);
      setMsg({ type: 'info', text: `Loaded ${nextPreset.label} from MPQs.` });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [screenId, worldmapMpqPath]);

  useEffect(() => {
    loadPreset(screenId);
  }, [screenId]);

  const onSelectScreen = (e) => setScreenId(e.target.value);
  const onSelectFile = (path) => setActivePath(path);
  const onChangeText = (e) => {
    const text = e.target.value;
    setScreenFiles(prev => ({
      ...prev,
      [activePath]: { ...(prev[activePath] || { path: activePath }), text, loaded: true, error: null },
    }));
    setDirty(true);
  };

  const handleReload = async () => {
    await loadPreset(screenId);
  };

  const handleSave = async () => {
    const files = currentFiles.filter(file => screenFiles[file.path]);
    if (!files.length) return;
    setSaving(true);
    setMsg(null);
    try {
      for (const file of files) {
        const payload = screenFiles[file.path]?.text ?? '';
        const res = await window.azeroth.glue.writeTextFile(file.path, payload);
        if (!res?.success) throw new Error(res?.error || `Failed to write ${file.path}`);
      }
      setDirty(false);
      setMsg({ type: 'success', text: 'Exported to output\\Interface\\GlueXML\\...' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const outputPaths = currentFiles.map(file => ({
    ...file,
    outputPath: `output\\${file.path}`,
    loaded: screenFiles[file.path]?.loaded,
    error: screenFiles[file.path]?.error,
  }));

  return (
    <div className="ui-editor-page fade-in">
      <div className="page-header ui-editor-header">
        <div>
          <h1 className="page-title">UI Editor</h1>
          <p className="page-sub">
            Edit Blizzard glue UI files from the MPQs and export overrides to <strong>output\\Interface\\GlueXML\\...</strong>
          </p>
        </div>
        <div className="ui-editor-actions">
          <button className="btn-ghost" onClick={handleReload} disabled={loading}>
            <RefreshCcw size={13} /> {loading ? 'Loading...' : 'Reload'}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading || !dirty}>
            <Save size={13} /> {saving ? 'Saving...' : 'Export'}
          </button>
        </div>
      </div>

      <div className="ui-editor-toolbar">
        <div className="field-group">
          <label>Glue Screen</label>
          <select value={screenId} onChange={onSelectScreen}>
            {SCREEN_PRESETS.map(screen => (
              <option key={screen.id} value={screen.id}>{screen.label}</option>
            ))}
          </select>
        </div>
        <div className="field-group ui-editor-path">
          <label>Client Data Path</label>
          <div className="ui-editor-path-box mono">{worldmapMpqPath || 'Set this in Settings'}</div>
        </div>
        <div className="field-group ui-editor-status">
          <label>Status</label>
          <div className={`ui-editor-status-pill ${dirty ? 'dirty' : 'clean'}`}>{dirty ? 'Unsaved' : 'Clean'}</div>
        </div>
      </div>

      {msg && <div className={`editor-msg ${msg.type}`} style={{ margin: '0 28px 12px' }}>{msg.text}</div>}

      <div className="ui-editor-shell">
        <aside className="ui-editor-sidebar panel">
          <div className="panel-header">
            <LayoutGrid size={13} />
            <span>Screen Files</span>
          </div>
          <div className="ui-editor-sidebar-body">
            <div className="ui-editor-card">
              <div className="ui-editor-card-title">{preset.label}</div>
              <div className="ui-editor-card-text">{preset.description}</div>
            </div>

            <div className="ui-editor-filelist">
              {currentFiles.map(file => {
                const state = screenFiles[file.path];
                const active = activePath === file.path;
                return (
                  <button key={file.path} className={`ui-editor-file ${active ? 'active' : ''}`} onClick={() => onSelectFile(file.path)}>
                    <div>
                      <div className="ui-editor-file-name">{file.label}</div>
                      <div className="ui-editor-file-path mono">{file.path}</div>
                    </div>
                    <div className={`ui-editor-file-dot ${state?.loaded ? 'ok' : 'warn'}`}>{state?.loaded ? 'OK' : 'MISS'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="ui-editor-main panel">
          <div className="panel-header">
            <FileText size={13} />
            <span>{activeFile?.label || 'Editor'}</span>
          </div>

          <div className="ui-editor-main-body">
            <div className="ui-editor-preview panel">
              <div className="panel-header">
                <Eye size={13} />
                <span>Scene Preview</span>
              </div>
              <div className="ui-editor-preview-inner">
                <ScenePreview
                  title={preset.label}
                  blpPath={preset.previewBlp}
                  xmlSources={sceneXmlSources}
                  modelPath={preset.previewModelPath}
                  onOpenSource={setActivePath}
                />
              </div>
            </div>

            <div className="ui-editor-code panel">
              <div className="panel-header">
                <Wand2 size={13} />
                <span>Source</span>
              </div>
              <textarea
                className="ui-editor-textarea mono"
                value={activeFile?.text ?? ''}
                onChange={onChangeText}
                spellCheck={false}
                placeholder={activeFile?.loaded ? '' : 'File not loaded from MPQ'}
                disabled={!activeFile}
              />
            </div>
          </div>
        </section>

        <aside className="ui-editor-output panel">
          <div className="panel-header">
            <FolderOpen size={13} />
            <span>Output Map</span>
          </div>
          <div className="ui-editor-output-body">
            {outputPaths.map(file => (
              <div key={file.path} className="ui-editor-output-row">
                <div className="ui-editor-output-label">{file.label}</div>
                <div className="ui-editor-output-path mono">{file.outputPath}</div>
                {file.error && <div className="ui-editor-output-error"><AlertTriangle size={12} /> {file.error}</div>}
              </div>
            ))}
            <div className="ui-editor-output-note">
              Export uses the same Blizzard path structure, rooted at <span className="mono">output</span>.
            </div>
          </div>
        </aside>
      </div>

      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
    </div>
  );
}







