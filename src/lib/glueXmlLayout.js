export const GLUE_WIDTH = 1024;
export const GLUE_HEIGHT = 768;

const UI_TAGS = new Set(['Frame', 'Button', 'CheckButton', 'EditBox', 'FontString', 'Texture', 'ModelFFX', 'Model', 'StatusBar', 'Slider']);
const TEXTURE_TAGS = ['NormalTexture', 'Texture', 'Backdrop'];
const POINTS = {
  TOPLEFT: [0, 0], TOP: [0.5, 0], TOPRIGHT: [1, 0],
  LEFT: [0, 0.5], CENTER: [0.5, 0.5], RIGHT: [1, 0.5],
  BOTTOMLEFT: [0, 1], BOTTOM: [0.5, 1], BOTTOMRIGHT: [1, 1],
};

function directChild(element, names) {
  return Array.from(element?.children || []).find(child => names.includes(child.tagName)) || null;
}

function inheritedElements(element, templates, seen = new Set()) {
  const names = String(element?.getAttribute?.('inherits') || '').split(',').map(value => value.trim()).filter(Boolean);
  const result = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const template = templates.get(name);
    if (!template) continue;
    result.push(template, ...inheritedElements(template, templates, seen));
  }
  return result;
}

function inheritedAttr(element, name, templates) {
  if (element?.hasAttribute?.(name)) return element.getAttribute(name);
  for (const template of inheritedElements(element, templates)) {
    if (template.hasAttribute(name)) return template.getAttribute(name);
  }
  return '';
}

function inheritedChild(element, names, templates) {
  const own = directChild(element, names);
  if (own) return own;
  for (const template of inheritedElements(element, templates)) {
    const child = directChild(template, names);
    if (child) return child;
  }
  return null;
}

function dimension(element) {
  if (!element) return { x: 0, y: 0 };
  const value = element.hasAttribute('x') || element.hasAttribute('y')
    ? element
    : Array.from(element.children || []).find(child => child.hasAttribute?.('x') || child.hasAttribute?.('y'));
  const x = Number(value?.getAttribute?.('x') ?? value?.getAttribute?.('width') ?? 0);
  const y = Number(value?.getAttribute?.('y') ?? value?.getAttribute?.('height') ?? 0);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

function elementSize(element, templates) {
  const size = inheritedChild(element, ['Size'], templates);
  const value = dimension(size);
  const width = Number(inheritedAttr(element, 'width', templates));
  const height = Number(inheritedAttr(element, 'height', templates));
  return {
    width: value.x || (Number.isFinite(width) ? width : 0),
    height: value.y || (Number.isFinite(height) ? height : 0),
  };
}

function elementAnchors(element, templates, parentName) {
  const anchorsRoot = inheritedChild(element, ['Anchors'], templates);
  const anchors = anchorsRoot ? Array.from(anchorsRoot.children || []).filter(child => child.tagName === 'Anchor') : [];
  return anchors.map(anchor => {
    const offset = dimension(directChild(anchor, ['Offset']));
    return {
      point: (anchor.getAttribute('point') || 'CENTER').toUpperCase(),
      relativePoint: (anchor.getAttribute('relativePoint') || anchor.getAttribute('point') || 'CENTER').toUpperCase(),
      relativeTo: String(anchor.getAttribute('relativeTo') || parentName || 'GlueParent').replace(/\$parent/g, parentName || ''),
      x: offset.x || Number(anchor.getAttribute('x')) || 0,
      y: offset.y || Number(anchor.getAttribute('y')) || 0,
    };
  });
}

function resolvedTextureFile(element, templates) {
  if (!element) return '';
  const direct = inheritedAttr(element, 'file', templates) || inheritedAttr(element, 'texture', templates) || inheritedAttr(element, 'bgFile', templates);
  if (direct) return direct;
  const child = inheritedChild(element, TEXTURE_TAGS, templates);
  return child ? inheritedAttr(child, 'file', templates) || inheritedAttr(child, 'bgFile', templates) : '';
}

function resolvedTextureCoords(element, templates) {
  const child = inheritedChild(element, TEXTURE_TAGS, templates);
  const coords = child ? inheritedChild(child, ['TexCoords'], templates) : null;
  if (!coords) return null;
  const values = ['left', 'right', 'top', 'bottom'].map(name => Number(coords.getAttribute(name)));
  return values.every(Number.isFinite) ? { left: values[0], right: values[1], top: values[2], bottom: values[3] } : null;
}

function resolvedText(element, templates, strings) {
  const raw = inheritedAttr(element, 'text', templates);
  if (!raw) return '';
  return strings[raw] || raw;
}

function elementAction(element) {
  const scripts = directChild(element, ['Scripts']);
  const onClick = directChild(scripts, ['OnClick']);
  if (!onClick) return '';
  return [onClick.getAttribute('function') || '', onClick.textContent || ''].filter(Boolean).join(' ').trim();
}

function actionTargets(action) {
  const show = [...String(action || '').matchAll(/([A-Za-z_$][\w$]*):Show\s*\(/g)].map(match => match[1]);
  const hide = [...String(action || '').matchAll(/([A-Za-z_$][\w$]*):Hide\s*\(/g)].map(match => match[1]);
  if (/OptionsSelectFrame_Hide\s*\(/.test(action)) hide.push('OptionsSelectFrame');
  return { show: [...new Set(show)], hide: [...new Set(hide)] };
}

function resolvedColor(element, templates) {
  const color = inheritedChild(element, ['Color', 'TextColor'], templates);
  if (!color) return null;
  const r = Number(color.getAttribute('r'));
  const g = Number(color.getAttribute('g'));
  const b = Number(color.getAttribute('b'));
  const a = Number(color.getAttribute('a') || 1);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

function defaultSize(tag) {
  if (tag === 'FontString') return { width: 220, height: 20 };
  if (tag === 'Texture') return { width: 64, height: 64 };
  if (tag === 'EditBox') return { width: 200, height: 36 };
  if (tag === 'Button' || tag === 'CheckButton') return { width: 160, height: 32 };
  return { width: 0, height: 0 };
}

function resolveName(rawName, parentName) {
  return String(rawName || '').replace(/\$parent/g, parentName || '');
}

function pointFactors(point) {
  return POINTS[String(point || 'CENTER').toUpperCase()] || POINTS.CENTER;
}

function solveAxis(anchors, size, explicitSize, axis) {
  if (!anchors.length) return { start: 0, size };
  const factorIndex = axis === 'x' ? 0 : 1;
  const values = anchors.map(anchor => ({ factor: pointFactors(anchor.point)[factorIndex], value: anchor.value }));
  if (!explicitSize) {
    const first = values[0];
    const second = values.find(value => Math.abs(value.factor - first.factor) > 0.01);
    if (second) {
      const nextSize = (second.value - first.value) / (second.factor - first.factor);
      if (Number.isFinite(nextSize) && nextSize > 0) return { start: first.value - nextSize * first.factor, size: nextSize };
    }
  }
  return { start: values[0].value - size * values[0].factor, size };
}

function parseDocument(text) {
  if (!text) return null;
  const document = new DOMParser().parseFromString(text, 'text/xml');
  return document.querySelector('parsererror') ? null : document;
}

export function parseGlueStrings(sources) {
  const strings = {};
  for (const source of sources || []) {
    if (!/\.lua$/i.test(source.path || '')) continue;
    for (const match of String(source.text || '').matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(["'])(.*?)\2\s*;?/gm)) {
      strings[match[1]] = match[3].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  return strings;
}

function parseGlueModelPaths(sources) {
  const paths = {};
  for (const source of sources || []) {
    if (!/\.lua$/i.test(source.path || '')) continue;
    for (const match of String(source.text || '').matchAll(/([A-Za-z_$][\w$]*):SetModel\(\s*["']([^"']+)["']\s*\)/g)) {
      paths[match[1]] = match[2].replace(/\//g, '\\');
    }
  }
  return paths;
}

function parseGlueModelSettings(sources) {
  const settings = {};
  for (const source of sources || []) {
    if (!/\.lua$/i.test(source.path || '')) continue;
    const text = String(source.text || '');
    for (const match of text.matchAll(/([A-Za-z_$][\w$]*):SetCamera\(\s*(\d+)\s*\)/g)) {
      settings[match[1]] = { ...(settings[match[1]] || {}), cameraIndex: Number(match[2]) };
    }
    for (const match of text.matchAll(/([A-Za-z_$][\w$]*):SetSequence\(\s*(\d+)\s*\)/g)) {
      settings[match[1]] = { ...(settings[match[1]] || {}), sequence: Number(match[2]) };
    }
  }
  return settings;
}

export function normalizeBlpPath(value) {
  const path = String(value || '').trim().replace(/\//g, '\\');
  if (!path || path.includes('$') || path.includes('%')) return '';
  if (/\.tga$/i.test(path)) return path.replace(/\.tga$/i, '.blp');
  return /\.[a-z0-9]+$/i.test(path) ? path : `${path}.blp`;
}

export function buildGlueScene(sources, entryPaths) {
  const strings = parseGlueStrings(sources);
  const modelPaths = parseGlueModelPaths(sources);
  const modelSettings = parseGlueModelSettings(sources);
  const documents = new Map();
  for (const source of sources || []) {
    if (!/\.xml$/i.test(source.path || '')) continue;
    const document = parseDocument(source.text);
    if (document) documents.set(source.path.toLowerCase(), { document, source });
  }

  const templates = new Map();
  for (const { document } of documents.values()) {
    for (const element of Array.from(document.querySelectorAll('[virtual="true"][name]'))) templates.set(element.getAttribute('name'), element);
  }

  const nodes = [];
  const entrySet = new Set((entryPaths || []).filter(path => /\.xml$/i.test(path)).map(path => path.toLowerCase()));
  for (const [key, { document, source }] of documents) {
    if (!entrySet.has(key)) continue;
    const visit = (element, parentNode, locator, depth) => {
      const isUi = UI_TAGS.has(element.tagName);
      let currentParent = parentNode;
      if (isUi && String(element.getAttribute('virtual')).toLowerCase() !== 'true') {
        const rawName = element.getAttribute('name') || '';
        const parentName = element.getAttribute('parent') || parentNode?.name || 'GlueParent';
        const name = resolveName(rawName, parentName);
        const measured = elementSize(element, templates);
        const fallback = defaultSize(element.tagName);
        const action = elementAction(element);
        const hidden = String(inheritedAttr(element, 'hidden', templates)).toLowerCase() === 'true';
        const setAllPoints = String(inheritedAttr(element, 'setAllPoints', templates)).toLowerCase() === 'true';
        const toplevel = String(inheritedAttr(element, 'toplevel', templates)).toLowerCase() === 'true';
        const frameStrata = String(inheritedAttr(element, 'frameStrata', templates)).toUpperCase();
        const node = {
          id: `${source.path}:${locator.join('.')}`,
          sourcePath: source.path,
          locator,
          tag: element.tagName,
          name,
          parentId: parentNode?.id || null,
          parentName,
          depth,
          order: nodes.length,
          editable: !!source.editable,
          hidden,
          runtimeHidden: hidden || (toplevel && setAllPoints && ['DIALOG', 'HIGH'].includes(frameStrata) && element.tagName !== 'ModelFFX'),
          setAllPoints,
          toplevel,
          frameStrata,
          inherits: element.getAttribute('inherits') || '',
          text: resolvedText(element, templates, strings),
          rawText: inheritedAttr(element, 'text', templates),
          action,
          actionTargets: actionTargets(action),
          texturePath: normalizeBlpPath(resolvedTextureFile(element, templates)),
          textureCoords: resolvedTextureCoords(element, templates),
          color: resolvedColor(element, templates),
          width: measured.width || fallback.width,
          height: measured.height || fallback.height,
          explicitWidth: measured.width > 0,
          explicitHeight: measured.height > 0,
          anchors: elementAnchors(element, templates, parentName),
          modelConfig: ['Model', 'ModelFFX'].includes(element.tagName) ? {
            modelPath: modelPaths[name] || modelPaths[rawName] || inheritedAttr(element, 'model', templates) || '',
            ...(modelSettings[name] || modelSettings[rawName] || {}),
            setAllPoints,
            fogNear: Number(inheritedAttr(element, 'fogNear', templates) || 0),
            fogFar: Number(inheritedAttr(element, 'fogFar', templates) || 0),
            glow: Number(inheritedAttr(element, 'glow', templates) || 0),
          } : null,
        };
        nodes.push(node);
        currentParent = node;
      }
      Array.from(element.children || []).forEach((child, index) => visit(child, currentParent, [...locator, index], depth + (isUi ? 1 : 0)));
    };
    visit(document.documentElement, null, [], 0);
  }

  const byId = new Map(nodes.map(node => [node.id, node]));
  const byName = new Map(nodes.filter(node => node.name).map(node => [node.name, node]));
  const root = { x: 0, y: 0, width: GLUE_WIDTH, height: GLUE_HEIGHT };
  const resolving = new Set();
  const resolveBox = node => {
    if (node.box) return node.box;
    if (resolving.has(node.id)) return root;
    resolving.add(node.id);
    const parent = byId.get(node.parentId) || byName.get(node.parentName);
    const parentBox = parent && parent !== node ? resolveBox(parent) : root;
    if (node.setAllPoints) {
      node.box = { ...parentBox };
    } else {
      const width = node.width || (node.tag === 'Frame' || node.tag.startsWith('Model') ? parentBox.width : 120);
      const height = node.height || (node.tag === 'Frame' || node.tag.startsWith('Model') ? parentBox.height : 30);
      const constraintsX = [];
      const constraintsY = [];
      for (const anchor of node.anchors) {
        const target = byName.get(anchor.relativeTo);
        const targetBox = target && target !== node ? resolveBox(target) : parentBox;
        const targetFactor = pointFactors(anchor.relativePoint);
        constraintsX.push({ point: anchor.point, value: targetBox.x + targetBox.width * targetFactor[0] + anchor.x });
        constraintsY.push({ point: anchor.point, value: targetBox.y + targetBox.height * targetFactor[1] - anchor.y });
      }
      const solvedX = solveAxis(constraintsX, width, node.explicitWidth, 'x');
      const solvedY = solveAxis(constraintsY, height, node.explicitHeight, 'y');
      node.box = {
        x: constraintsX.length ? solvedX.start : parentBox.x,
        y: constraintsY.length ? solvedY.start : parentBox.y,
        width: solvedX.size,
        height: solvedY.size,
      };
    }
    resolving.delete(node.id);
    return node.box;
  };
  nodes.forEach(resolveBox);
  return { nodes, templates: templates.size, documents: documents.size, strings: Object.keys(strings).length };
}

function elementAtLocator(document, locator) {
  let element = document.documentElement;
  for (const index of locator || []) element = element?.children?.[index];
  return element || null;
}

function ensureDirectChild(document, parent, name) {
  let child = directChild(parent, [name]);
  if (!child) {
    child = document.createElement(name);
    parent.appendChild(child);
  }
  return child;
}

export function updateGlueNodeXml(xmlText, node, patch) {
  const document = parseDocument(xmlText);
  if (!document) throw new Error('The XML source is not valid.');
  const element = elementAtLocator(document, node.locator);
  if (!element) throw new Error('The selected XML node could not be found.');

  if (patch.text !== undefined) element.setAttribute('text', patch.text);
  if (patch.width !== undefined || patch.height !== undefined) {
    const size = ensureDirectChild(document, element, 'Size');
    const target = size.hasAttribute('x') || size.hasAttribute('y') ? size : (size.firstElementChild || size);
    if (patch.width !== undefined) target.setAttribute('x', String(Math.max(1, Math.round(patch.width))));
    if (patch.height !== undefined) target.setAttribute('y', String(Math.max(1, Math.round(patch.height))));
  }
  if (patch.dx || patch.dy) {
    const anchors = ensureDirectChild(document, element, 'Anchors');
    const anchor = directChild(anchors, ['Anchor']) || (() => {
      const created = document.createElement('Anchor');
      created.setAttribute('point', 'TOPLEFT');
      anchors.appendChild(created);
      return created;
    })();
    const offset = ensureDirectChild(document, anchor, 'Offset');
    const target = offset.hasAttribute('x') || offset.hasAttribute('y') ? offset : (offset.firstElementChild || offset);
    const x = Number(target.getAttribute('x') || 0) + Number(patch.dx || 0);
    const y = Number(target.getAttribute('y') || 0) - Number(patch.dy || 0);
    target.setAttribute('x', String(Math.round(x)));
    target.setAttribute('y', String(Math.round(y)));
  }
  return new XMLSerializer().serializeToString(document);
}
