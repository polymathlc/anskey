/* =====================================================================
   ✏️ MODEL STUDIO — the bar-model drawing board (v1.141.0)
   ---------------------------------------------------------------------
   This is the drawing engine of polymathlc/model (Polymath Bar Model
   Studio, https://polymathlc.github.io/model/), carried here as the
   worksheet's model suite. It is ONLY the drawing board: no question,
   no scenario, no AI marking and no model answer came across. Draw a
   model, then 📌 put it on the worksheet page, where it becomes an
   ordinary frameless picture (see the 📐 MODEL STUDIO glue in
   index.html) that moves, resizes, locks, saves and prints like every
   pasted picture — and opens back up here with every bar still a bar.

   THE ENGINE BELOW IS polymathlc/model's OWN, nearly line for line, so
   a fix to either copies straight across. What changed in the port:
     · it lives inside this one closure, so its plain names (snap,
       appState, performUndo, pointerSession…) never meet the worksheet's
       globals;
     · every element is looked up inside #msCard (msQ), never by a bare
       document id, and the window's ids carry the `ms` prefix;
     · the keyboard is read on the window, not the document, and every
       key it sees stops there — or a letter typed while drawing fires a
       one-letter worksheet tool;
     · the scenario, the AI check and the model answer are not here.

   Element types stored in appState.elements:
     bar     { id, type, x, y, w, h, units, shaded[], color, labels? }
     label   { id, type, x, y, text, size? }
     brace   { id, type, x1, x2, y, text, below } (or vertical x, y1, y2)
     arrow   { id, type, x1, y1, x2, y2, text }
     divider { id, type, y }
     dotted  { id, type, x1, y1, x2, y2, text }   equality guide line
     align   { id, type, x1, y1, x2, y2 }         faint alignment guide
     pen     { id, type, points[], color }
   Coordinates live in the 900 × 460 SVG viewBox and snap to an 8px grid.
   ===================================================================== */
(function () {
var msRoot = document.getElementById('msCard');
if (!msRoot) { return; }
function msQ(selector) { return msRoot.querySelector(selector); }

/* ════════════════════════ DRAWING ENGINE (polymathlc/model) ═══════════ */


var GRID_SNAP = 8;
var MIN_BAR_WIDTH = 30;
var DEFAULT_BAR_HEIGHT = 44;
var FONT_STACK = "'RobotoQuestion','Century Gothic',CenturyGothic,AppleGothic,sans-serif";

var appState = {
  elements: [],
  undoStack: [],
  activeTool: 'bar',
  activeColor: '#C8E6C9',
  selectedId: null,      // set only when EXACTLY one element is selected
  selectedIds: [],       // the real selection; single-select is the 1-item case
  nextId: 1,
  isMarking: false
};

var canvasSvg = msQ('#msCanvas');
var elementsLayer = msQ('#msElements');
var previewLayer = msQ('#msPreview');
var selectionLayer = msQ('#msSelection');
var canvasHint = msQ('#msHint');
var selectionCountNode = msQ('#msSelCount');
var selectionActionsNode = msQ('#msSelActions');
var canvasFrame = canvasSvg.parentElement;

var SVG_NS = 'http://www.w3.org/2000/svg';

function snap(value) {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

function newElementId() {
  return 'el' + (appState.nextId++);
}

function svgPoint(clientX, clientY) {
  // Convert screen coordinates into viewBox coordinates
  var point = canvasSvg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  var ctm = canvasSvg.getScreenCTM();
  if (!ctm) { return { x: 0, y: 0 }; }
  var transformed = point.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

function makeNode(tagName, attributes) {
  var node = document.createElementNS(SVG_NS, tagName);
  for (var key in attributes) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      node.setAttribute(key, attributes[key]);
    }
  }
  return node;
}

function makeText(x, y, textContent, options) {
  options = options || {};
  var textNode = makeNode('text', {
    x: x, y: y,
    'font-family': FONT_STACK,
    'font-size': options.size || 15,
    'font-weight': options.bold ? '700' : '600',
    fill: options.color || '#1A1A1A',
    'text-anchor': options.anchor || 'start',
    'dominant-baseline': options.baseline || 'auto'
  });
  textNode.textContent = textContent;
  return textNode;
}

/* ── Renderers for each element type ─────────────────────────────── */

function renderBarElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'bar' });
  var unitWidth = element.w / element.units;

  for (var i = 0; i < element.units; i++) {
    var isShaded = element.shaded.indexOf(i) !== -1;
    var cell = makeNode('rect', {
      x: element.x + i * unitWidth,
      y: element.y,
      width: unitWidth,
      height: element.h,
      fill: isShaded ? shadeOf(element.color) : element.color,
      stroke: '#5C5C5C',
      'stroke-width': 1.6,
      'data-unit-index': i
    });
    group.appendChild(cell);

    if (isShaded) {
      // Diagonal hatch lines to make shading obvious even in greyscale print
      var hatch = makeNode('path', {
        d: buildHatchPath(element.x + i * unitWidth, element.y, unitWidth, element.h),
        stroke: '#5C5C5C',
        'stroke-width': 0.9,
        fill: 'none',
        'pointer-events': 'none'
      });
      group.appendChild(hatch);
    }

    /* Inner label: words written INSIDE this unit. Stored on the bar,
       so it travels and resizes with it. Double-click a unit to set it. */
    var inner = element.labels && element.labels[i];
    if (inner) {
      group.appendChild(makeText(
        element.x + i * unitWidth + unitWidth / 2,
        element.y + element.h / 2 + 5,
        inner,
        { size: innerLabelSize(inner, unitWidth), anchor: 'middle', color: '#1A1A1A' }
      ));
    }
  }
  return group;
}

/* Shrink an inner label just enough to sit inside its unit. Century
   Gothic runs about 0.58em per character at these sizes. */
function innerLabelSize(text, unitWidth) {
  var size = 15;
  var usable = unitWidth - 10;
  while (size > 9 && text.length * size * 0.58 > usable) { size -= 1; }
  return size;
}

function shadeOf(hexColor) {
  // Slightly darker version of the swatch for shaded units
  var map = {
    '#C8E6C9': '#A5D6A7', '#BBDEFB': '#90CAF9', '#D1C4E9': '#B39DDB',
    '#FFE0B2': '#FFCC80', '#FFCDD2': '#EF9A9A', '#FFFFFF': '#E0E0E0'
  };
  return map[hexColor] || '#D0D0D0';
}

function buildHatchPath(x, y, w, h) {
  var d = '';
  var step = 10;
  for (var offset = -h; offset < w; offset += step) {
    var x1 = Math.max(x, x + offset);
    var y1 = offset < 0 ? y - offset : y;
    var x2 = Math.min(x + w, x + offset + h);
    var y2 = y + Math.min(h, w - offset);
    if (x2 > x1) {
      d += 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' ';
    }
  }
  return d;
}

function renderLabelElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'label' });
  var size = element.size || 17;
  var textNode = makeText(element.x, element.y, element.text, {
    size: size,
    bold: true,
    color: element.text.indexOf('?') !== -1 ? '#E64A19' : '#1A1A1A'
  });
  // Invisible hit-pad behind the text so it's easy to click/erase
  var pad = makeNode('rect', {
    x: element.x - 6, y: element.y - size - 1,
    width: Math.max(40, element.text.length * size * 0.6 + 12), height: size + 9,
    fill: 'transparent'
  });
  group.appendChild(pad);
  group.appendChild(textNode);
  return group;
}

/* ── Brace geometry ──────────────────────────────────────────────────
   A brace can point in any of four directions: a horizontal brace opens
   DOWN (below) or UP, a vertical one opens RIGHT or LEFT. This single
   helper works out the path and label placement so the live drag
   preview and the committed brace are always drawn by the same code
   and can never disagree.

   Braces saved before left-facing existed have no `facing`, so an
   absent value means 'right' — the old behaviour. */

function braceFacing(element) {
  return element.facing === 'left' ? 'left' : 'right';
}

function braceGeometry(element) {
  if (element.vertical) {
    var vy1 = Math.min(element.y1, element.y2);
    var vy2 = Math.max(element.y1, element.y2);
    var midY = (vy1 + vy2) / 2;
    var vx = element.x;
    var sign = braceFacing(element) === 'left' ? -1 : 1;
    var vDepth = 12 * sign;   // bracket bulge, out to the facing side
    var vTip = 20 * sign;     // the pointy middle nub, further out

    return {
      d: 'M' + vx + ' ' + vy1 +
         ' Q' + (vx + vDepth) + ' ' + vy1 + ' ' + (vx + vDepth) + ' ' + (vy1 + 10) +
         ' L' + (vx + vDepth) + ' ' + (midY - 10) +
         ' Q' + (vx + vDepth) + ' ' + midY + ' ' + (vx + vTip) + ' ' + midY +
         ' Q' + (vx + vDepth) + ' ' + midY + ' ' + (vx + vDepth) + ' ' + (midY + 10) +
         ' L' + (vx + vDepth) + ' ' + (vy2 - 10) +
         ' Q' + (vx + vDepth) + ' ' + vy2 + ' ' + vx + ' ' + vy2,
      labelX: vx + vTip + 8 * sign,
      labelY: midY,
      anchor: sign < 0 ? 'end' : 'start',
      baseline: 'middle',
      spine: { x1: vx + 8 * sign, y1: vy1, x2: vx + 8 * sign, y2: vy2 }
    };
  }

  var x1 = Math.min(element.x1, element.x2);
  var x2 = Math.max(element.x1, element.x2);
  var midX = (x1 + x2) / 2;
  var y = element.y;
  var depth = element.below ? 12 : -12;
  var tip = element.below ? 20 : -20;

  return {
    d: 'M' + x1 + ' ' + y +
       ' Q' + x1 + ' ' + (y + depth) + ' ' + (x1 + 10) + ' ' + (y + depth) +
       ' L' + (midX - 10) + ' ' + (y + depth) +
       ' Q' + midX + ' ' + (y + depth) + ' ' + midX + ' ' + (y + tip) +
       ' Q' + midX + ' ' + (y + depth) + ' ' + (midX + 10) + ' ' + (y + depth) +
       ' L' + (x2 - 10) + ' ' + (y + depth) +
       ' Q' + x2 + ' ' + (y + depth) + ' ' + x2 + ' ' + y,
    labelX: midX,
    labelY: element.below ? y + tip + 20 : y + tip - 8,
    anchor: 'middle',
    baseline: null,
    spine: null
  };
}

function renderBraceElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'brace' });
  var geo = braceGeometry(element);

  group.appendChild(makeNode('path', {
    d: geo.d, fill: 'none', stroke: '#5C5C5C', 'stroke-width': 1.8
  }));

  var textOptions = {
    size: 16, bold: true, anchor: geo.anchor,
    color: element.text.indexOf('?') !== -1 ? '#E64A19' : '#1A1A1A'
  };
  if (geo.baseline) { textOptions.baseline = geo.baseline; }
  group.appendChild(makeText(geo.labelX, geo.labelY, element.text, textOptions));

  if (geo.spine) {
    // Fat invisible spine for easy select/erase on vertical braces
    group.appendChild(makeNode('line', {
      x1: geo.spine.x1, y1: geo.spine.y1, x2: geo.spine.x2, y2: geo.spine.y2,
      stroke: 'transparent', 'stroke-width': 26
    }));
  }
  return group;
}

/* ── Alignment guide ─────────────────────────────────────────────────
   A faint grey dotted line, carrying no text. Its only job is to show
   that edges line up — that two bars start at the same place, or that
   a unit boundary matches the one above it. Deliberately paler and
   finer than the equality line so it reads as scaffolding, not as a
   statement about the maths.                                        */

function renderAlignElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'align' });
  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2,
    stroke: '#C4C4C4', 'stroke-width': 1.4,
    'stroke-dasharray': '2 5', 'stroke-linecap': 'round'
  }));
  // Fat invisible line so a 1.4px guide is still easy to grab
  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2,
    stroke: 'transparent', 'stroke-width': 16
  }));
  return group;
}

function renderArrowElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'arrow' });
  var dx = element.x2 - element.x1;
  var dy = element.y2 - element.y1;
  var length = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / length, uy = dy / length;
  var headSize = 11;
  var baseX = element.x2 - ux * headSize;
  var baseY = element.y2 - uy * headSize;
  var perpX = -uy, perpY = ux;

  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: baseX, y2: baseY,
    stroke: '#E64A19', 'stroke-width': 2.4
  }));
  group.appendChild(makeNode('path', {
    d: 'M' + element.x2 + ' ' + element.y2 +
       ' L' + (baseX + perpX * 6) + ' ' + (baseY + perpY * 6) +
       ' L' + (baseX - perpX * 6) + ' ' + (baseY - perpY * 6) + ' Z',
    fill: '#E64A19'
  }));
  if (element.text) {
    group.appendChild(makeText((element.x1 + element.x2) / 2, (element.y1 + element.y2) / 2 - 10,
      element.text, { size: 15, bold: true, anchor: 'middle', color: '#E64A19' }));
  }
  // Wider invisible stroke to make thin arrows clickable
  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2,
    stroke: 'transparent', 'stroke-width': 16
  }));
  return group;
}

/* The toolbar swatches are soft pastels (great for bar fills, too pale
   for a 2.6px pen line), so each swatch maps to a saturated ink twin. */
function penInkOf(swatchColor) {
  var map = {
    '#C8E6C9': '#43A047',   // green
    '#BBDEFB': '#1E88E5',   // blue
    '#D1C4E9': '#8E24AA',   // purple
    '#FFE0B2': '#FB8C00',   // orange
    '#FFCDD2': '#E53935',   // coral
    '#FFFFFF': '#37474F'    // white swatch → graphite ink
  };
  return map[swatchColor] || '#37474F';
}

function buildPenPathData(points) {
  if (!points || points.length === 0) { return ''; }
  var d = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
  if (points.length === 1) {
    // A tap: draw a tiny dot-length segment so something is visible
    d += ' l0.5 0.5';
    return d;
  }
  // Quadratic smoothing through midpoints keeps hand strokes from
  // looking jagged without being expensive to compute.
  for (var i = 1; i < points.length - 1; i++) {
    var midX = (points[i].x + points[i + 1].x) / 2;
    var midY = (points[i].y + points[i + 1].y) / 2;
    d += ' Q' + points[i].x.toFixed(1) + ' ' + points[i].y.toFixed(1) +
         ' ' + midX.toFixed(1) + ' ' + midY.toFixed(1);
  }
  var last = points[points.length - 1];
  d += ' L' + last.x.toFixed(1) + ' ' + last.y.toFixed(1);
  return d;
}

function renderPenElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'pen' });
  var pathData = buildPenPathData(element.points);

  group.appendChild(makeNode('path', {
    d: pathData,
    fill: 'none',
    stroke: element.ink,
    'stroke-width': element.width || 2.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  }));

  // Fat invisible twin so thin strokes are easy to select and erase
  group.appendChild(makeNode('path', {
    d: pathData,
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': 16,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  }));
  return group;
}

function renderDividerElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'divider' });
  group.appendChild(makeNode('line', {
    x1: 10, y1: element.y, x2: 890, y2: element.y,
    stroke: '#8A8A8A', 'stroke-width': 1.5, 'stroke-dasharray': '7 6'
  }));
  group.appendChild(makeText(16, element.y - 8, 'Before', { size: 12, color: '#8A8A8A' }));
  group.appendChild(makeText(16, element.y + 20, 'After', { size: 12, color: '#8A8A8A' }));
  // Fat invisible hit line
  group.appendChild(makeNode('line', {
    x1: 10, y1: element.y, x2: 890, y2: element.y,
    stroke: 'transparent', 'stroke-width': 18
  }));
  return group;
}

/* ── Dotted equality line ────────────────────────────────────────────
   The textbook way to say "these two parts are the same": a dotted
   guide line between them, carrying a small "=" mark at its middle.
   The mark is editable text, so it can also read "same", "480", or be
   emptied out for a plain dotted guide line.                        */

function renderDottedElement(element) {
  var group = makeNode('g', { 'data-id': element.id, 'data-type': 'dotted' });

  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2,
    stroke: '#8A8A8A', 'stroke-width': 2.2,
    'stroke-dasharray': '1 6', 'stroke-linecap': 'round'
  }));

  if (element.text) {
    // A white badge behind the mark stops the dots running through it
    var midX = (element.x1 + element.x2) / 2;
    var midY = (element.y1 + element.y2) / 2;
    var badgeW = Math.max(20, element.text.length * 10 + 10);
    group.appendChild(makeNode('rect', {
      x: midX - badgeW / 2, y: midY - 11,
      width: badgeW, height: 22, rx: 5,
      fill: '#FFFFFF', stroke: '#D8D8D8', 'stroke-width': 1
    }));
    group.appendChild(makeText(midX, midY, element.text, {
      size: 16, bold: true, anchor: 'middle', baseline: 'middle', color: '#37474F'
    }));
  }

  // Fat invisible twin so a 2px dotted line is easy to grab and erase
  group.appendChild(makeNode('line', {
    x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2,
    stroke: 'transparent', 'stroke-width': 16
  }));
  return group;
}

function renderAllElements() {
  while (elementsLayer.firstChild) { elementsLayer.removeChild(elementsLayer.firstChild); }
  for (var i = 0; i < appState.elements.length; i++) {
    var element = appState.elements[i];
    var node = null;
    if (element.type === 'bar') { node = renderBarElement(element); }
    else if (element.type === 'label') { node = renderLabelElement(element); }
    else if (element.type === 'brace') { node = renderBraceElement(element); }
    else if (element.type === 'arrow') { node = renderArrowElement(element); }
    else if (element.type === 'divider') { node = renderDividerElement(element); }
    else if (element.type === 'dotted') { node = renderDottedElement(element); }
    else if (element.type === 'align') { node = renderAlignElement(element); }
    else if (element.type === 'pen') { node = renderPenElement(element); }
    if (node) { elementsLayer.appendChild(node); }
  }
  renderSelection();
  updateCanvasHint();
}

/* ── Selection state ─────────────────────────────────────────────────
   appState.selectedIds is the single source of truth. appState.selectedId
   mirrors it ONLY when exactly one element is selected, so every
   single-element behaviour (resize handles, F2 text editing, the split
   and shade popovers) keeps working untouched and simply stands down
   while a multi-selection is active. */

function setSelection(ids) {
  var unique = [];
  for (var i = 0; i < ids.length; i++) {
    if (unique.indexOf(ids[i]) === -1 && findElementById(ids[i])) { unique.push(ids[i]); }
  }
  appState.selectedIds = unique;
  appState.selectedId = unique.length === 1 ? unique[0] : null;
  updateSelectionCount();
}

function clearSelection() { setSelection([]); }

function isSelected(id) { return appState.selectedIds.indexOf(id) !== -1; }

function toggleInSelection(id) {
  var next = appState.selectedIds.slice();
  var at = next.indexOf(id);
  if (at === -1) { next.push(id); } else { next.splice(at, 1); }
  setSelection(next);
}

function selectedElements() {
  var list = [];
  for (var i = 0; i < appState.selectedIds.length; i++) {
    var element = findElementById(appState.selectedIds[i]);
    if (element) { list.push(element); }
  }
  return list;
}

function selectionBounds(elements) {
  if (!elements.length) { return null; }
  var first = elementBounds(elements[0]);
  var minX = first.x, minY = first.y;
  var maxX = first.x + first.w, maxY = first.y + first.h;
  for (var i = 1; i < elements.length; i++) {
    var box = elementBounds(elements[i]);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function renderSelection() {
  while (selectionLayer.firstChild) { selectionLayer.removeChild(selectionLayer.firstChild); }
  var chosen = selectedElements();
  if (!chosen.length) { updateSelectionCount(); return; }

  // Outline every selected element
  for (var i = 0; i < chosen.length; i++) {
    var box = elementBounds(chosen[i]);
    selectionLayer.appendChild(makeNode('rect', {
      x: box.x - 5, y: box.y - 5,
      width: box.w + 10, height: box.h + 10,
      fill: 'none', stroke: '#66BB6A', 'stroke-width': 1.6,
      'stroke-dasharray': '5 4', rx: 6, 'pointer-events': 'none'
    }));
  }

  if (chosen.length > 1) {
    // A softer box around the whole group, so it reads as one unit
    var group = selectionBounds(chosen);
    selectionLayer.appendChild(makeNode('rect', {
      x: group.x - 11, y: group.y - 11,
      width: group.w + 22, height: group.h + 22,
      fill: '#66BB6A', 'fill-opacity': 0.06,
      stroke: '#2E7D32', 'stroke-width': 1.4,
      'stroke-dasharray': '2 5', rx: 10, 'pointer-events': 'none'
    }));
    updateSelectionCount();
    return;   // resize handles are single-element only
  }

  var handles = resizeHandlesFor(chosen[0]);
  for (var h = 0; h < handles.length; h++) {
    var handle = handles[h];
    selectionLayer.appendChild(makeNode('rect', {
      x: handle.x - HANDLE_HALF, y: handle.y - HANDLE_HALF,
      width: HANDLE_HALF * 2, height: HANDLE_HALF * 2,
      fill: '#FFFFFF', stroke: '#66BB6A', 'stroke-width': 1.8,
      rx: 2.5, 'data-handle': handle.name,
      style: 'cursor:' + handle.cursor
    }));
  }
  updateSelectionCount();
}

function updateSelectionCount() {
  if (!selectionCountNode) { return; }
  var count = appState.selectedIds.length;
  selectionCountNode.textContent = count > 1 ? count + ' selected' : '';
  selectionCountNode.classList.toggle('visible', count > 1);
  updateSelectionActions();
}

/* ── Selection action bar ────────────────────────────────────────────
   Bulk duplicate / copy / delete / recolour existed only as keyboard
   shortcuts, which made them impossible to find. This floats the same
   actions right above whatever is selected. */

var SELECTION_COLOURS = ['#C8E6C9', '#BBDEFB', '#D1C4E9', '#FFE0B2', '#FFCDD2', '#FFFFFF'];

var SEL_ACTIONS = [
  { key: 'duplicate', label: 'Duplicate', title: 'Duplicate the selection (Ctrl+D)',
    icon: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>',
    run: performDuplicate },
  { key: 'copy', label: 'Copy', title: 'Copy the selection (Ctrl+C)',
    icon: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    run: performCopy },
  { key: 'delete', label: 'Delete', title: 'Delete the selection (Del)', danger: true,
    icon: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    run: performDeleteSelection }
];

function buildSelectionActions() {
  if (!selectionActionsNode) { return; }
  selectionActionsNode.innerHTML = '';

  var count = document.createElement('span');
  count.className = 'sel-count';
  selectionActionsNode.appendChild(count);

  SEL_ACTIONS.forEach(function (action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sel-act-btn' + (action.danger ? ' danger' : '');
    button.title = action.title;
    button.innerHTML = '<svg viewBox="0 0 24 24">' + action.icon + '</svg>' + action.label;
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      action.run();
    });
    selectionActionsNode.appendChild(button);
  });

  var separator = document.createElement('span');
  separator.className = 'sel-act-sep';
  separator.setAttribute('data-role', 'colour-separator');
  selectionActionsNode.appendChild(separator);

  SELECTION_COLOURS.forEach(function (colour) {
    var swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'sel-swatch';
    swatch.setAttribute('data-role', 'colour');
    swatch.style.background = colour;
    swatch.title = 'Recolour every selected bar';
    swatch.addEventListener('click', function (event) {
      event.stopPropagation();
      recolourSelection(colour);
    });
    selectionActionsNode.appendChild(swatch);
  });
}

function recolourSelection(colour) {
  var bars = selectedElements().filter(function (el) { return el.type === 'bar'; });
  if (!bars.length) { return; }
  pushUndoSnapshot();
  bars.forEach(function (bar) { bar.color = colour; });
  renderAllElements();
}

function updateSelectionActions() {
  if (!selectionActionsNode) { return; }
  var chosen = selectedElements();
  // Hidden mid-drag so it never sits under the pointer or jitters along
  var busy = pointerSession && (pointerSession.mode === 'move' ||
                                pointerSession.mode === 'resize' ||
                                pointerSession.mode === 'marquee');
  if (!chosen.length || busy) {
    selectionActionsNode.classList.remove('visible');
    return;
  }

  var countNode = selectionActionsNode.querySelector('.sel-count');
  if (countNode) {
    countNode.textContent = chosen.length > 1 ? chosen.length + ' selected' : '1 selected';
  }
  // Colours only make sense when a bar is in the selection
  var hasBar = chosen.some(function (el) { return el.type === 'bar'; });
  var colourNodes = selectionActionsNode.querySelectorAll('[data-role="colour"], [data-role="colour-separator"]');
  for (var i = 0; i < colourNodes.length; i++) {
    colourNodes[i].style.display = hasBar ? '' : 'none';
  }

  var box = selectionBounds(chosen);
  var anchor = canvasScreenPosition(box.x + box.w / 2, box.y);
  var frameWidth = canvasFrame.clientWidth;
  var barWidth = selectionActionsNode.offsetWidth || 260;
  // Keep the bar on-canvas horizontally, and drop it below the
  // selection when there is no room above.
  var left = Math.max(barWidth / 2 + 6, Math.min(frameWidth - barWidth / 2 - 6, anchor.left));
  var top = anchor.top - 12;
  if (top < 44) {
    var lower = canvasScreenPosition(box.x + box.w / 2, box.y + box.h);
    top = lower.top + 52;
  }
  selectionActionsNode.style.left = left + 'px';
  selectionActionsNode.style.top = top + 'px';
  selectionActionsNode.classList.add('visible');
}

/* ── Resize handles ──────────────────────────────────────────────────
   Every selected element grows grab-handles: bars get the classic 8
   box handles, braces & arrows get one handle per endpoint, pen
   strokes get 4 corner scale handles, labels get one corner handle
   that scales the font size. Dividers span the full width, so they
   only move (no handles). */

var HANDLE_HALF = 5.5;        // half-size of a handle square, viewBox units
var MIN_BAR_HEIGHT = 16;
var MIN_SPAN = 30;            // smallest brace span, matches draw minimum

function resizeHandlesFor(element) {
  if (element.type === 'bar') {
    var x1 = element.x, y1 = element.y, x2 = element.x + element.w, y2 = element.y + element.h;
    var midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    return [
      { name: 'nw', x: x1, y: y1, cursor: 'nwse-resize' },
      { name: 'n',  x: midX, y: y1, cursor: 'ns-resize' },
      { name: 'ne', x: x2, y: y1, cursor: 'nesw-resize' },
      { name: 'e',  x: x2, y: midY, cursor: 'ew-resize' },
      { name: 'se', x: x2, y: y2, cursor: 'nwse-resize' },
      { name: 's',  x: midX, y: y2, cursor: 'ns-resize' },
      { name: 'sw', x: x1, y: y2, cursor: 'nesw-resize' },
      { name: 'w',  x: x1, y: midY, cursor: 'ew-resize' }
    ];
  }
  if (element.type === 'label') {
    var box = elementBounds(element);
    return [{ name: 'se', x: box.x + box.w, y: box.y + box.h, cursor: 'nwse-resize' }];
  }
  if (element.type === 'brace') {
    if (element.vertical) {
      return [
        { name: 'start', x: element.x + 6, y: element.y1, cursor: 'ns-resize' },
        { name: 'end',   x: element.x + 6, y: element.y2, cursor: 'ns-resize' }
      ];
    }
    return [
      { name: 'start', x: element.x1, y: element.y, cursor: 'ew-resize' },
      { name: 'end',   x: element.x2, y: element.y, cursor: 'ew-resize' }
    ];
  }
  if (element.type === 'arrow' || element.type === 'dotted' || element.type === 'align') {
    return [
      { name: 'start', x: element.x1, y: element.y1, cursor: 'move' },
      { name: 'end',   x: element.x2, y: element.y2, cursor: 'move' }
    ];
  }
  if (element.type === 'pen') {
    var penBox = elementBounds(element);
    return [
      { name: 'nw', x: penBox.x, y: penBox.y, cursor: 'nwse-resize' },
      { name: 'ne', x: penBox.x + penBox.w, y: penBox.y, cursor: 'nesw-resize' },
      { name: 'se', x: penBox.x + penBox.w, y: penBox.y + penBox.h, cursor: 'nwse-resize' },
      { name: 'sw', x: penBox.x, y: penBox.y + penBox.h, cursor: 'nesw-resize' }
    ];
  }
  return [];   // divider: full-width, nothing to resize
}

function clampSpanEnd(moving, fixed, minSpan) {
  // Keep the dragged end at least minSpan away from the fixed end
  if (Math.abs(moving - fixed) < minSpan) {
    return moving >= fixed ? fixed + minSpan : fixed - minSpan;
  }
  return moving;
}

function applyResize(element, original, handleName, point) {
  var px = snap(point.x), py = snap(point.y);

  if (element.type === 'bar') {
    var bx1 = original.x, by1 = original.y;
    var bx2 = original.x + original.w, by2 = original.y + original.h;
    if (handleName.indexOf('w') !== -1) { bx1 = Math.min(px, bx2 - MIN_BAR_WIDTH); }
    if (handleName.indexOf('e') !== -1) { bx2 = Math.max(px, bx1 + MIN_BAR_WIDTH); }
    if (handleName.indexOf('n') !== -1) { by1 = Math.min(py, by2 - MIN_BAR_HEIGHT); }
    if (handleName.indexOf('s') !== -1) { by2 = Math.max(py, by1 + MIN_BAR_HEIGHT); }
    element.x = bx1; element.y = by1;
    element.w = bx2 - bx1; element.h = by2 - by1;

  } else if (element.type === 'label') {
    // Drag the corner handle to grow/shrink the text
    var originalBox = elementBounds(original);
    var scale = (point.x - originalBox.x) / Math.max(1, originalBox.w);
    var newSize = Math.round((original.size || 17) * scale);
    element.size = Math.max(10, Math.min(64, newSize));

  } else if (element.type === 'brace') {
    if (element.vertical) {
      if (handleName === 'start') { element.y1 = clampSpanEnd(py, original.y2, MIN_SPAN); }
      else { element.y2 = clampSpanEnd(py, original.y1, MIN_SPAN); }
    } else {
      if (handleName === 'start') { element.x1 = clampSpanEnd(px, original.x2, MIN_SPAN); }
      else { element.x2 = clampSpanEnd(px, original.x1, MIN_SPAN); }
    }

  } else if (element.type === 'arrow') {
    // Endpoints stay unsnapped, same as when the arrow was drawn
    if (handleName === 'start') { element.x1 = point.x; element.y1 = point.y; }
    else { element.x2 = point.x; element.y2 = point.y; }

  } else if (element.type === 'dotted' || element.type === 'align') {
    /* Endpoints snap to the grid, and a line that was drawn straight
       stays straight — a guide is only useful if it keeps lining the
       two parts up exactly. */
    var wasVertical = original.x1 === original.x2;
    var wasHorizontal = original.y1 === original.y2;
    if (handleName === 'start') {
      element.x1 = wasVertical ? original.x2 : px;
      element.y1 = wasHorizontal ? original.y2 : py;
    } else {
      element.x2 = wasVertical ? original.x1 : px;
      element.y2 = wasHorizontal ? original.y1 : py;
    }

  } else if (element.type === 'pen') {
    // Scale all points about the corner opposite the dragged handle
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var p = 0; p < original.points.length; p++) {
      var pt = original.points[p];
      if (pt.x < minX) { minX = pt.x; }
      if (pt.y < minY) { minY = pt.y; }
      if (pt.x > maxX) { maxX = pt.x; }
      if (pt.y > maxY) { maxY = pt.y; }
    }
    var anchorX = handleName.indexOf('w') !== -1 ? maxX : minX;
    var anchorY = handleName.indexOf('n') !== -1 ? maxY : minY;
    var movingX = handleName.indexOf('w') !== -1 ? minX : maxX;
    var movingY = handleName.indexOf('n') !== -1 ? minY : maxY;
    var sx = (point.x - anchorX) / ((movingX - anchorX) || 1);
    var sy = (point.y - anchorY) / ((movingY - anchorY) || 1);
    sx = Math.max(0.05, Math.min(20, sx));
    sy = Math.max(0.05, Math.min(20, sy));
    element.points = original.points.map(function (op) {
      return {
        x: Math.round((anchorX + (op.x - anchorX) * sx) * 10) / 10,
        y: Math.round((anchorY + (op.y - anchorY) * sy) * 10) / 10
      };
    });
  }
}

function elementBounds(element) {
  if (element.type === 'bar') { return { x: element.x, y: element.y, w: element.w, h: element.h }; }
  if (element.type === 'label') {
    var labelSize = element.size || 17;
    return { x: element.x - 6, y: element.y - labelSize - 1, w: Math.max(40, element.text.length * labelSize * 0.6), h: labelSize + 9 };
  }
  if (element.type === 'brace') {
    if (element.vertical) {
      var vTop = Math.min(element.y1, element.y2);
      return { x: element.x, y: vTop, w: 30 + Math.max(50, (element.text || '').length * 10), h: Math.abs(element.y2 - element.y1) };
    }
    var bx1 = Math.min(element.x1, element.x2);
    return { x: bx1, y: element.below ? element.y : element.y - 40, w: Math.abs(element.x2 - element.x1), h: 44 };
  }
  if (element.type === 'arrow') {
    var ax = Math.min(element.x1, element.x2), ay = Math.min(element.y1, element.y2);
    return { x: ax - 4, y: ay - 4, w: Math.abs(element.x2 - element.x1) + 8, h: Math.abs(element.y2 - element.y1) + 8 };
  }
  if (element.type === 'align') {
    var gx = Math.min(element.x1, element.x2), gy = Math.min(element.y1, element.y2);
    return {
      x: gx - 4, y: gy - 4,
      w: Math.abs(element.x2 - element.x1) + 8,
      h: Math.abs(element.y2 - element.y1) + 8
    };
  }
  if (element.type === 'dotted') {
    // Pad to at least the "=" badge so the selection box never sits
    // inside the mark on a perfectly straight line
    var dx = Math.min(element.x1, element.x2), dy = Math.min(element.y1, element.y2);
    var dw = Math.abs(element.x2 - element.x1), dh = Math.abs(element.y2 - element.y1);
    var padX = Math.max(4, (24 - dw) / 2), padY = Math.max(4, (24 - dh) / 2);
    return { x: dx - padX, y: dy - padY, w: dw + padX * 2, h: dh + padY * 2 };
  }
  if (element.type === 'divider') { return { x: 10, y: element.y - 9, w: 880, h: 18 }; }
  if (element.type === 'pen') {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var p = 0; p < element.points.length; p++) {
      var pt = element.points[p];
      if (pt.x < minX) { minX = pt.x; }
      if (pt.y < minY) { minY = pt.y; }
      if (pt.x > maxX) { maxX = pt.x; }
      if (pt.y > maxY) { maxY = pt.y; }
    }
    if (minX === Infinity) { return { x: 0, y: 0, w: 0, h: 0 }; }
    return { x: minX - 4, y: minY - 4, w: (maxX - minX) + 8, h: (maxY - minY) + 8 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function indexOfElementId(id) {
  for (var i = 0; i < appState.elements.length; i++) {
    if (appState.elements[i].id === id) { return i; }
  }
  return -1;
}

/* Put a drag's elements back EXACTLY where they started, so the undo
   snapshot captures the true pre-drag state. Replacing the objects
   outright matters: replaying applyMove with a zero delta would re-snap
   to the 8px grid and shift anything sitting off-grid (a 1px Ctrl+arrow
   nudge, say) by up to half a grid step. */
function restoreSessionOriginals(session) {
  for (var i = 0; i < session.originals.length; i++) {
    var original = JSON.parse(session.originals[i]);
    var at = indexOfElementId(original.id);
    if (at !== -1) { appState.elements[at] = original; }
  }
}

function findElementById(id) {
  for (var i = 0; i < appState.elements.length; i++) {
    if (appState.elements[i].id === id) { return appState.elements[i]; }
  }
  return null;
}

function pushUndoSnapshot() {
  appState.undoStack.push(JSON.stringify(appState.elements));
  if (appState.undoStack.length > 60) { appState.undoStack.shift(); }
}

function performUndo() {
  if (appState.undoStack.length === 0) { return; }
  appState.elements = JSON.parse(appState.undoStack.pop());
  clearSelection();
  renderAllElements();
}

/* ── Copy & paste ────────────────────────────────────────────────────
   An internal clipboard for drawn elements. Copy stores deep JSON
   clones of every selected element; each paste stamps fresh copies with
   new ids, offset by one grid-friendly step per paste so repeated
   pastes cascade diagonally instead of stacking invisibly. The whole
   pasted group becomes the new selection so it can be dragged into
   place immediately. Ctrl+D duplicates the selection in one stroke.
   A multi-element paste shifts every piece by the SAME offset, so the
   group keeps its shape.                                            */

var elementClipboard = null;   // array of JSON strings, one per element
var pasteCount = 0;            // resets on each fresh copy

function offsetElementInPlace(element, dx, dy, exact) {
  // Reuses the exact same per-type geometry rules as applyMove, but
  // against the element's own current position.
  applyMove(element, JSON.parse(JSON.stringify(element)), dx, dy, exact);
}

function clampElementToCanvas(element) {
  // Keep a pasted copy from wandering off the 900×460 canvas: if its
  // bounding box has escaped, pull it back inside with a margin.
  var box = elementBounds(element);
  var pullX = 0, pullY = 0;
  if (box.x + box.w > 890) { pullX = 890 - (box.x + box.w); }
  if (box.y + box.h > 450) { pullY = 450 - (box.y + box.h); }
  if (box.x < 10) { pullX = 10 - box.x; }
  if (box.y < 10) { pullY = 10 - box.y; }
  if (pullX !== 0 || pullY !== 0) { offsetElementInPlace(element, pullX, pullY); }
}

function performCopy() {
  var chosen = selectedElements();
  if (!chosen.length) {
    canvasHint.textContent = 'Select something first (V) — drag a box around it, then Copy';
    return false;
  }
  elementClipboard = chosen.map(function (el) { return JSON.stringify(el); });
  pasteCount = 0;
  canvasHint.textContent = chosen.length > 1
    ? 'Copied ' + chosen.length + ' items — press Ctrl+V or the Paste button'
    : 'Copied — press Ctrl+V or the Paste button';
  return true;
}

function performPaste() {
  if (!elementClipboard || !elementClipboard.length) {
    canvasHint.textContent = 'Nothing copied yet — select something and Copy first';
    return false;
  }
  pasteCount += 1;
  var step = 24 * pasteCount;          // cascade: 24, 48, 72, …

  var copies = elementClipboard.map(function (json) {
    var copy = JSON.parse(json);
    copy.id = newElementId();
    offsetElementInPlace(copy, step, step);
    return copy;
  });
  // Pull the group back on-canvas as one piece, so relative spacing
  // survives: measure the overflow once and shift everything by it.
  var pull = groupPullBack(copies);
  if (pull.x !== 0 || pull.y !== 0) {
    copies.forEach(function (copy) { offsetElementInPlace(copy, pull.x, pull.y); });
  }

  pushUndoSnapshot();
  copies.forEach(function (copy) { appState.elements.push(copy); });
  setSelection(copies.map(function (copy) { return copy.id; }));  // ready to drag
  renderAllElements();
  return true;
}

function groupPullBack(elements) {
  var box = selectionBounds(elements);
  if (!box) { return { x: 0, y: 0 }; }
  var pullX = 0, pullY = 0;
  if (box.x + box.w > 890) { pullX = 890 - (box.x + box.w); }
  if (box.y + box.h > 450) { pullY = 450 - (box.y + box.h); }
  if (box.x + pullX < 10) { pullX = 10 - box.x; }
  if (box.y + pullY < 10) { pullY = 10 - box.y; }
  return { x: pullX, y: pullY };
}

function performDuplicate() {
  // Ctrl+D convenience: copy + paste of the whole selection in one action
  if (performCopy()) { performPaste(); }
}

function performSelectAll() {
  if (!appState.elements.length) { return; }
  if (appState.activeTool !== 'select') {
    var selectButton = msQ('.tool-btn[data-tool="select"]');
    if (selectButton) { selectButton.click(); }
  }
  setSelection(appState.elements.map(function (el) { return el.id; }));
  renderSelection();
  updateCanvasHint();
}

function performDeleteSelection() {
  if (!appState.selectedIds.length) { return; }
  pushUndoSnapshot();
  var doomed = appState.selectedIds.slice();
  appState.elements = appState.elements.filter(function (el) {
    return doomed.indexOf(el.id) === -1;
  });
  clearSelection();
  renderAllElements();
}

function clearCanvas(skipConfirm) {
  if (!skipConfirm && appState.elements.length > 0) {
    if (!window.confirm('Clear the whole canvas?')) { return; }
  }
  pushUndoSnapshot();
  appState.elements = [];
  clearSelection();
  renderAllElements();
}

function updateCanvasHint() {
  var hints = {
    bar: 'Click and drag to draw a bar',
    select: 'Click a shape, or drag a box round several · Shift+click adds one · Ctrl+A selects all · drag to move (hold Shift to keep it straight, Ctrl to duplicate) · Ctrl+C/V, Ctrl+D, Delete',
    split: 'Click a bar to split it into equal units',
    razor: 'Hover to line the dotted blade up, then click to cut the bar in two right there — it snaps onto a unit line when you are close · Shift+click cuts every bar the line crosses',
    shade: 'Click a unit to shade or unshade it',
    label: 'Click anywhere, type your label, then press Enter — use "?" for the unknown',
    brace: 'Drag across or DOWN — dip the drag the way you want it to open (up/down/left/right). Press F to flip a selected brace.',
    arrow: 'Drag from the giver to the receiver, type the amount, then press Enter',
    divider: 'Click where the Before / After line should go',
    dotted: 'Drag a dotted line between two parts that are equal — double-click it to change the “=” mark',
    align: 'Drag a faint guide line to show that two edges line up — it carries no words, it just lines things up',
    pen: 'Draw freely — sketch any part of the model by hand',
    eraser: 'Click any element to erase it'
  };
  if (appState.elements.length === 0 && appState.activeTool === 'bar') {
    canvasHint.textContent = 'Click and drag to draw your first bar';
  } else if (appState.selectedIds.length > 1) {
    canvasHint.textContent = appState.selectedIds.length + ' selected — drag to move them together (Shift keeps it straight, Ctrl duplicates) · Ctrl+C/V · Ctrl+D · Delete';
  } else {
    canvasHint.textContent = hints[appState.activeTool] || '';
  }
}

/* ── Text editing (PowerPoint-style) ─────────────────────────────────
   Double-click an element (or press F2 / Enter with it selected) to
   edit its text in place. Double-clicking a bar types text "into" the
   shape — it drops a label at that spot, PowerPoint-style. An emptied
   label is deleted, like an emptied PowerPoint text box. */

function textAnchorOf(element) {
  if (element.type === 'label') { return { x: element.x, y: element.y }; }
  if (element.type === 'brace') {
    if (element.vertical) {
      return { x: element.x + 28, y: (element.y1 + element.y2) / 2 };
    }
    var midX = (Math.min(element.x1, element.x2) + Math.max(element.x1, element.x2)) / 2;
    return { x: midX, y: element.y + (element.below ? 32 : -32) };
  }
  if (element.type === 'arrow' || element.type === 'dotted') {
    return { x: (element.x1 + element.x2) / 2, y: (element.y1 + element.y2) / 2 - 10 };
  }
  return null;   // pen, divider and alignment guides carry no text
}

function beginTextEdit(element, atPoint) {
  if (element.type === 'bar') {
    /* Double-clicking a bar writes words INSIDE it, PowerPoint-style.
       The text is stored on the bar against the unit that was clicked,
       so it stays put when the bar is moved, resized or recoloured. */
    var unitWidth = element.w / element.units;
    var unitIndex = 0;
    if (atPoint) {
      unitIndex = Math.floor((atPoint.x - element.x) / unitWidth);
      unitIndex = Math.max(0, Math.min(element.units - 1, unitIndex));
    }
    if (!element.labels) { element.labels = {}; }
    var centreX = element.x + unitIndex * unitWidth + unitWidth / 2;
    var centreY = element.y + element.h / 2;
    openFloatingInput(centreX, centreY, element.labels[unitIndex] || '', function (value) {
      var trimmed = value.trim();
      pushUndoSnapshot();
      if (trimmed) { element.labels[unitIndex] = trimmed; }
      else { delete element.labels[unitIndex]; }   // emptied → cleared
      renderAllElements();
    });
    return true;
  }

  var anchor = textAnchorOf(element);
  if (!anchor) { return false; }           // pen / divider carry no text
  openFloatingInput(anchor.x, anchor.y, element.text || '', function (value) {
    var trimmed = value.trim();
    pushUndoSnapshot();
    if (element.type === 'label' && !trimmed) {
      // An emptied label disappears, like an empty PowerPoint text box
      appState.elements = appState.elements.filter(function (el) { return el.id !== element.id; });
      setSelection(appState.selectedIds);   // drops the now-missing id
    } else if (element.type === 'brace') {
      element.text = trimmed || '?';
    } else {
      element.text = trimmed;              // arrows & dotted lines may go unmarked
    }
    renderAllElements();
  });
  return true;
}

/* ── Pointer interaction ─────────────────────────────────────────── */

var pointerSession = null;   // { mode, startX, startY, ... }

/* Manual double-click detection: the canvas preventDefault()s
   pointerdown, which can suppress the browser's synthetic dblclick,
   so we time consecutive clicks on the same element ourselves. */
var lastSelectClick = { id: null, time: 0 };
var DOUBLE_CLICK_MS = 450;

canvasSvg.addEventListener('pointerdown', function (event) {
  if (appState.isMarking) { return; }
  event.preventDefault();
  canvasSvg.setPointerCapture(event.pointerId);
  var point = svgPoint(event.clientX, event.clientY);
  var tool = appState.activeTool;

  if (tool === 'bar') {
    pointerSession = { mode: 'drawBar', startX: snap(point.x), startY: snap(point.y) };
  } else if (tool === 'pen') {
    // Freehand: collect raw (unsnapped) points so the stroke follows
    // the hand exactly. Points are thinned in pointermove.
    pointerSession = {
      mode: 'drawPen',
      points: [{ x: point.x, y: point.y }],
      ink: penInkOf(appState.activeColor)
    };
    drawPreviewPen(pointerSession.points, pointerSession.ink);
  } else if (tool === 'brace') {
    pointerSession = { mode: 'drawBrace', startX: snap(point.x), startY: snap(point.y) };
  } else if (tool === 'arrow') {
    pointerSession = { mode: 'drawArrow', startX: point.x, startY: point.y };
  } else if (tool === 'dotted') {
    pointerSession = { mode: 'drawDotted', startX: snap(point.x), startY: snap(point.y) };
  } else if (tool === 'align') {
    pointerSession = { mode: 'drawAlign', startX: snap(point.x), startY: snap(point.y) };
  } else if (tool === 'select') {
    // A resize handle wins over element hit-testing so handles that
    // overlap the element (or a neighbour) still grab correctly.
    var handleName = event.target.getAttribute && event.target.getAttribute('data-handle');
    var selectedElement = appState.selectedId ? findElementById(appState.selectedId) : null;
    if (handleName && selectedElement) {
      pointerSession = {
        mode: 'resize', element: selectedElement,
        handle: handleName,
        original: JSON.stringify(selectedElement),
        resized: false
      };
    } else {
      var hit = hitTest(event.target);
      // Shift adds to (or removes from) the selection — but only decides
      // that on RELEASE, so it never swallows a drag. Shift+drag still
      // constrains the move to one axis, and Ctrl+Shift+drag still
      // duplicates along that axis.
      var additive = event.shiftKey;
      // Ctrl / Cmd / Alt held means "duplicate this", never "edit its
      // text", so such a click must not count towards a double-click.
      // Otherwise two duplicate-drags in quick succession on the same
      // element open the text editor instead of dragging a copy out.
      var wantsDuplicate = event.ctrlKey || event.metaKey || event.altKey;
      if (hit) {
        var wasSelected = isSelected(hit.id);

        if (additive || wantsDuplicate) {
          lastSelectClick = { id: null, time: 0 };
          // Bring it into the group straight away so a shift+drag moves
          // it along with everything else.
          if (additive && !wasSelected) { setSelection(appState.selectedIds.concat([hit.id])); }
          else if (!additive && !wasSelected) { setSelection([hit.id]); }
        } else {
          // Second click on the same element within the double-click
          // window opens its text editor (PowerPoint behaviour)
          if (lastSelectClick.id === hit.id && event.timeStamp - lastSelectClick.time < DOUBLE_CLICK_MS) {
            lastSelectClick = { id: null, time: 0 };
            setSelection([hit.id]);
            renderSelection();
            beginTextEdit(hit, point);
            return;
          }
          lastSelectClick = { id: hit.id, time: event.timeStamp };
          // Clicking inside an existing multi-selection keeps the group so
          // the whole group can be dragged; clicking outside it starts over.
          if (!wasSelected) { setSelection([hit.id]); }
        }

        pointerSession = {
          mode: 'move',
          clickedId: hit.id,
          additive: additive,
          // Shift-clicking something already in the group takes it back
          // out — but only if the pointer never actually moved.
          toggleOffOnClick: additive && wasSelected,
          elements: selectedElements(),
          startX: point.x, startY: point.y,
          originals: selectedElements().map(function (el) { return JSON.stringify(el); }),
          moved: false,
          // Ctrl+drag (or Alt/Cmd+drag) duplicates, PowerPoint-style
          wantsDuplicate: wantsDuplicate,
          duplicated: false
        };
      } else {
        // Empty canvas: start a rubber-band marquee. Shift keeps what is
        // already selected and adds whatever the band sweeps up.
        lastSelectClick = { id: null, time: 0 };
        if (!additive) { clearSelection(); }
        pointerSession = {
          mode: 'marquee',
          startX: point.x, startY: point.y,
          basis: additive ? appState.selectedIds.slice() : []
        };
      }
    }
    renderSelection();
  } else if (tool === 'eraser') {
    var target = hitTest(event.target);
    if (target) {
      pushUndoSnapshot();
      appState.elements = appState.elements.filter(function (el) { return el.id !== target.id; });
      setSelection(appState.selectedIds);   // drops the erased id
      renderAllElements();
    }
  } else if (tool === 'razor') {
    if (event.pointerType === 'touch') {
      /* A finger covers the very point it is aiming at, so on touch the
         press only aims: the dotted line follows the finger and the cut
         happens on lift. Mouse and stylus cut on the click itself. */
      pointerSession = { mode: 'razorAim' };
      razorHover = { point: point, shift: false };
      drawRazorPreview();
    } else {
      razorHover = { point: point, shift: event.shiftKey };
      performRazorCut(razorPlan(point, event.shiftKey));
      drawRazorPreview();
    }
  } else if (tool === 'split') {
    var barTarget = hitTest(event.target);
    if (barTarget && barTarget.type === 'bar') {
      openSplitPopover(barTarget, event.clientX, event.clientY);
    }
  } else if (tool === 'shade') {
    var shadeTarget = hitTest(event.target);
    if (shadeTarget && shadeTarget.type === 'bar') {
      var unitIndexAttr = event.target.getAttribute('data-unit-index');
      var unitIndex = unitIndexAttr !== null ? parseInt(unitIndexAttr, 10) : 0;
      pushUndoSnapshot();
      var pos = shadeTarget.shaded.indexOf(unitIndex);
      if (pos === -1) { shadeTarget.shaded.push(unitIndex); }
      else { shadeTarget.shaded.splice(pos, 1); }
      renderAllElements();
    }
  } else if (tool === 'label') {
    openFloatingInput(point.x, point.y, '', function (value) {
      if (value.trim()) {
        pushUndoSnapshot();
        appState.elements.push({
          id: newElementId(), type: 'label',
          x: snap(point.x), y: snap(point.y), text: value.trim()
        });
        renderAllElements();
      }
    });
  } else if (tool === 'divider') {
    pushUndoSnapshot();
    appState.elements.push({ id: newElementId(), type: 'divider', y: snap(point.y) });
    renderAllElements();
  }
});

canvasSvg.addEventListener('pointermove', function (event) {
  if (!pointerSession) { return; }
  var point = svgPoint(event.clientX, event.clientY);

  if (pointerSession.mode === 'drawBar') {
    drawPreviewRect(pointerSession.startX, pointerSession.startY, snap(point.x), snap(point.y));
  } else if (pointerSession.mode === 'drawPen') {
    var lastPoint = pointerSession.points[pointerSession.points.length - 1];
    var distX = point.x - lastPoint.x;
    var distY = point.y - lastPoint.y;
    // Thin the stream: only keep points ≥ 2.5px apart. Keeps strokes
    // smooth but stops a slow careful drawing from becoming 5,000 points.
    if ((distX * distX + distY * distY) >= 6.25 && pointerSession.points.length < 900) {
      pointerSession.points.push({
        x: Math.round(point.x * 10) / 10,
        y: Math.round(point.y * 10) / 10
      });
      drawPreviewPen(pointerSession.points, pointerSession.ink);
    }
  } else if (pointerSession.mode === 'drawBrace') {
    // Live ghost of the actual brace, drawn by the same geometry code
    // that will render it, so what you see is exactly what you get.
    drawPreviewBrace(braceFromDrag(pointerSession.startX, pointerSession.startY, point));
  } else if (pointerSession.mode === 'drawArrow') {
    drawPreviewArrow(pointerSession.startX, pointerSession.startY, point.x, point.y);
  } else if (pointerSession.mode === 'drawDotted') {
    var dottedEnd = resolveDottedEnd(pointerSession.startX, pointerSession.startY, point);
    drawPreviewDotted(pointerSession.startX, pointerSession.startY, dottedEnd.x, dottedEnd.y);
  } else if (pointerSession.mode === 'drawAlign') {
    var guideEnd = resolveDottedEnd(pointerSession.startX, pointerSession.startY, point);
    drawPreviewAlign(pointerSession.startX, pointerSession.startY, guideEnd.x, guideEnd.y);
  } else if (pointerSession.mode === 'razorAim') {
    razorHover = { point: point, shift: false };
    drawRazorPreview();
  } else if (pointerSession.mode === 'marquee') {
    drawPreviewMarquee(pointerSession.startX, pointerSession.startY, point.x, point.y);
  } else if (pointerSession.mode === 'move') {
    var dx = point.x - pointerSession.startX;
    var dy = point.y - pointerSession.startY;
    // Shift constrains the drag to one axis, PowerPoint-style
    if (event.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; } else { dx = 0; }
    }
    if (!pointerSession.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      pointerSession.moved = true;
      if (pointerSession.wantsDuplicate) {
        // Ctrl+drag: leave twins behind at the start positions. Restore
        // the dragged elements first so the undo snapshot is pristine.
        restoreSessionOriginals(pointerSession);
        pushUndoSnapshot();

        /* restoreSessionOriginals swaps FRESH objects into
           appState.elements, which orphans the references this session
           is holding. Re-point at the live objects, or the rest of the
           drag would quietly mutate detached copies and nothing on
           screen would move. */
        pointerSession.elements = pointerSession.originals.map(function (json) {
          return findElementById(JSON.parse(json).id);
        });

        for (var t = 0; t < pointerSession.originals.length; t++) {
          var twin = JSON.parse(pointerSession.originals[t]);
          twin.id = newElementId();
          appState.elements.push(twin);
        }
        pointerSession.duplicated = true;
      }
    }
    // Every selected element shifts by the same delta, so the group
    // keeps its shape.
    for (var m = 0; m < pointerSession.elements.length; m++) {
      if (!pointerSession.elements[m]) { continue; }
      applyMove(pointerSession.elements[m], JSON.parse(pointerSession.originals[m]), dx, dy);
    }
    renderAllElements();
  } else if (pointerSession.mode === 'resize') {
    pointerSession.resized = true;
    applyResize(pointerSession.element, JSON.parse(pointerSession.original), pointerSession.handle, point);
    renderAllElements();
  }
});

canvasSvg.addEventListener('pointerup', function (event) {
  if (!pointerSession) { return; }
  var point = svgPoint(event.clientX, event.clientY);
  clearPreview();

  if (pointerSession.mode === 'drawBar') {
    var x1 = Math.min(pointerSession.startX, snap(point.x));
    var x2 = Math.max(pointerSession.startX, snap(point.x));
    var y1 = Math.min(pointerSession.startY, snap(point.y));
    var width = x2 - x1;
    if (width >= MIN_BAR_WIDTH) {
      pushUndoSnapshot();
      appState.elements.push({
        id: newElementId(), type: 'bar',
        x: x1, y: y1, w: width, h: DEFAULT_BAR_HEIGHT,
        units: 1, shaded: [], color: appState.activeColor
      });
      renderAllElements();
    }
  } else if (pointerSession.mode === 'drawPen') {
    // Commit only strokes with a bit of substance — a stray tap of
    // less than ~6px total travel is discarded as noise.
    var travelled = 0;
    for (var pi = 1; pi < pointerSession.points.length; pi++) {
      travelled += Math.abs(pointerSession.points[pi].x - pointerSession.points[pi - 1].x) +
                   Math.abs(pointerSession.points[pi].y - pointerSession.points[pi - 1].y);
    }
    if (pointerSession.points.length >= 2 && travelled >= 6) {
      pushUndoSnapshot();
      appState.elements.push({
        id: newElementId(), type: 'pen',
        points: pointerSession.points,
        ink: pointerSession.ink,
        width: 2.6
      });
      renderAllElements();
    }
  } else if (pointerSession.mode === 'drawBrace') {
    // Same geometry the preview just showed, so the committed brace
    // lands exactly where the ghost was.
    var ghost = braceFromDrag(pointerSession.startX, pointerSession.startY, point);
    if (ghost.span >= 30) {
      var geo = braceGeometry(ghost);
      var promptX = ghost.vertical
        ? geo.labelX + (braceFacing(ghost) === 'left' ? -26 : 26)
        : geo.labelX;
      openFloatingInput(promptX, geo.labelY, '', function (value) {
        pushUndoSnapshot();
        var brace = { id: newElementId(), type: 'brace', text: value.trim() || '?' };
        if (ghost.vertical) {
          brace.vertical = true;
          brace.x = ghost.x; brace.y1 = ghost.y1; brace.y2 = ghost.y2;
          brace.facing = ghost.facing;
        } else {
          brace.x1 = ghost.x1; brace.x2 = ghost.x2; brace.y = ghost.y;
          brace.below = ghost.below;
        }
        appState.elements.push(brace);
        renderAllElements();
      });
    }
  } else if (pointerSession.mode === 'drawAlign') {
    var alignEnd = resolveDottedEnd(pointerSession.startX, pointerSession.startY, point);
    var alignSpan = Math.max(
      Math.abs(alignEnd.x - pointerSession.startX),
      Math.abs(alignEnd.y - pointerSession.startY)
    );
    if (alignSpan >= 20) {
      pushUndoSnapshot();
      appState.elements.push({
        id: newElementId(), type: 'align',
        x1: pointerSession.startX, y1: pointerSession.startY,
        x2: alignEnd.x, y2: alignEnd.y
      });
      renderAllElements();
    }
  } else if (pointerSession.mode === 'drawArrow') {
    var length = Math.sqrt(
      Math.pow(point.x - pointerSession.startX, 2) +
      Math.pow(point.y - pointerSession.startY, 2)
    );
    if (length >= 24) {
      var startX = pointerSession.startX, startY = pointerSession.startY;
      openFloatingInput((startX + point.x) / 2, (startY + point.y) / 2, '', function (value) {
        pushUndoSnapshot();
        appState.elements.push({
          id: newElementId(), type: 'arrow',
          x1: startX, y1: startY, x2: point.x, y2: point.y,
          text: value.trim()
        });
        renderAllElements();
      });
    }
  } else if (pointerSession.mode === 'drawDotted') {
    var dotEnd = resolveDottedEnd(pointerSession.startX, pointerSession.startY, point);
    var dotSpan = Math.sqrt(
      Math.pow(dotEnd.x - pointerSession.startX, 2) +
      Math.pow(dotEnd.y - pointerSession.startY, 2)
    );
    if (dotSpan >= 24) {
      pushUndoSnapshot();
      appState.elements.push({
        id: newElementId(), type: 'dotted',
        x1: pointerSession.startX, y1: pointerSession.startY,
        x2: dotEnd.x, y2: dotEnd.y,
        text: '='            // the default mark; double-click to change it
      });
      renderAllElements();
    }
  } else if (pointerSession.mode === 'razorAim') {
    // Touch aiming: the blade lands where the finger lifted
    performRazorCut(razorPlan(point, false));
    razorHover = null;          // no hover on touch, so drop the guide line
    drawRazorPreview();         // leaves just the fading cut mark
  } else if (pointerSession.mode === 'marquee') {
    // Everything the band touched joins the selection
    var swept = elementsIntersecting(
      pointerSession.startX, pointerSession.startY, point.x, point.y
    ).map(function (el) { return el.id; });
    setSelection(pointerSession.basis.concat(swept));
    renderSelection();
    updateCanvasHint();
  } else if (pointerSession.mode === 'move' && pointerSession.moved) {
    if (pointerSession.duplicated) {
      // Ctrl+drag duplicate: the undo snapshot was taken when the twins
      // were dropped, so one undo removes the whole duplication.
      renderAllElements();
    } else {
      // Commit the move of the whole selection as ONE undo step
      var movedJson = pointerSession.elements.map(function (el) { return JSON.stringify(el); });
      restoreSessionOriginals(pointerSession);
      pushUndoSnapshot();
      for (var v = 0; v < pointerSession.elements.length; v++) {
        var moved = JSON.parse(movedJson[v]);
        var at = indexOfElementId(moved.id);
        if (at !== -1) { appState.elements[at] = moved; }
      }
      setSelection(appState.selectedIds);   // re-point at the fresh objects
      renderAllElements();
    }
  } else if (pointerSession.mode === 'move' && !pointerSession.moved) {
    // Nothing was dragged, so this was a plain click. Decide what it
    // meant for the selection now that we know no drag followed.
    if (pointerSession.toggleOffOnClick) {
      // Shift+click on something already in the group takes it out
      toggleInSelection(pointerSession.clickedId);
    } else if (!pointerSession.additive && pointerSession.elements.length > 1) {
      // A plain click inside a group narrows down to that one element,
      // PowerPoint-style. Shift+clicks are excluded — they add, not narrow.
      setSelection([pointerSession.clickedId]);
    }
    renderSelection();
    updateCanvasHint();
  } else if (pointerSession.mode === 'resize' && pointerSession.resized) {
    // Commit the resize as one undo step: swap the pre-resize element
    // back in, snapshot, then re-apply the resized version. A full
    // replacement (not Object.assign) so added keys like label.size
    // don't leak into the undo snapshot.
    var resizedElement = JSON.stringify(pointerSession.element);
    var elementIndex = appState.elements.indexOf(pointerSession.element);
    if (elementIndex !== -1) {
      appState.elements[elementIndex] = JSON.parse(pointerSession.original);
      pushUndoSnapshot();
      appState.elements[elementIndex] = JSON.parse(resizedElement);
    }
    renderAllElements();
  }

  pointerSession = null;
  updateSelectionActions();   // re-show once the drag is over
});

function hitTest(domTarget) {
  var node = domTarget;
  while (node && node !== canvasSvg) {
    if (node.getAttribute && node.getAttribute('data-id')) {
      return findElementById(node.getAttribute('data-id'));
    }
    node = node.parentNode;
  }
  return null;
}

function applyMove(element, original, dx, dy, exact) {
  /* exact: skip grid snapping, used by fine keyboard nudges.

     An axis with a ZERO delta is left exactly as it was rather than
     being snapped. That keeps a promise the interface makes in three
     places: a Shift-constrained drag must hold the other axis
     perfectly still, an arrow-key nudge must move on one axis only,
     and pulling a stray element back on-canvas must not shove it
     sideways as well. Without this an element sitting off-grid — after
     a 1px Ctrl+arrow nudge — would jump up to half a grid step on the
     axis it was supposed to be locked to. */
  var snapX = exact || dx === 0 ? function (v) { return v; } : snap;
  var snapY = exact || dy === 0 ? function (v) { return v; } : snap;

  if (element.type === 'bar' || element.type === 'label') {
    element.x = snapX(original.x + dx);
    element.y = snapY(original.y + dy);
  } else if (element.type === 'brace') {
    if (element.vertical) {
      element.x = snapX(original.x + dx);
      element.y1 = snapY(original.y1 + dy);
      element.y2 = snapY(original.y2 + dy);
    } else {
      element.x1 = snapX(original.x1 + dx);
      element.x2 = snapX(original.x2 + dx);
      element.y = snapY(original.y + dy);
    }
  } else if (element.type === 'arrow') {
    element.x1 = original.x1 + dx; element.y1 = original.y1 + dy;
    element.x2 = original.x2 + dx; element.y2 = original.y2 + dy;
  } else if (element.type === 'dotted' || element.type === 'align') {
    // Snapped, so a guide line dragged sideways stays aligned to bars
    element.x1 = snapX(original.x1 + dx); element.y1 = snapY(original.y1 + dy);
    element.x2 = snapX(original.x2 + dx); element.y2 = snapY(original.y2 + dy);
  } else if (element.type === 'divider') {
    element.y = snapY(original.y + dy);
  } else if (element.type === 'pen') {
    element.points = original.points.map(function (pt) {
      return { x: pt.x + dx, y: pt.y + dy };
    });
  }
}

/* Preview shapes while dragging */
function drawPreviewPen(points, ink) {
  clearPreview();
  previewLayer.appendChild(makeNode('path', {
    d: buildPenPathData(points),
    fill: 'none',
    stroke: ink,
    'stroke-width': 2.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'pointer-events': 'none'
  }));
}
function drawPreviewRect(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('rect', {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: DEFAULT_BAR_HEIGHT,
    fill: appState.activeColor, 'fill-opacity': 0.5,
    stroke: '#5C5C5C', 'stroke-width': 1.4, 'stroke-dasharray': '4 4'
  }));
}
function drawPreviewLine(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: '#66BB6A', 'stroke-width': 2.2, 'stroke-dasharray': '5 4'
  }));
}
/* A drag that is nearly straight snaps to that axis — an equality line
   is only convincing if it lines the two parts up exactly — while a
   deliberately slanted drag stays slanted, for parts sitting far apart
   on different rows. */
function resolveDottedEnd(startX, startY, point) {
  var endX = snap(point.x), endY = snap(point.y);
  var offX = Math.abs(endX - startX), offY = Math.abs(endY - startY);
  if (offY <= Math.max(16, offX * 0.25)) { endY = startY; }
  else if (offX <= Math.max(16, offY * 0.25)) { endX = startX; }
  return { x: endX, y: endY };
}

function drawPreviewDotted(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: '#8A8A8A', 'stroke-width': 2.2,
    'stroke-dasharray': '1 6', 'stroke-linecap': 'round'
  }));
}
function drawPreviewArrow(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: '#E64A19', 'stroke-width': 2, 'stroke-dasharray': '5 4'
  }));
}
/* ── Brace drags ─────────────────────────────────────────────────────
   The dominant axis picks the orientation; the SMALL cross-axis wobble
   picks which way it opens. Drag right and dip down → opens downward;
   dip up → opens upward. Drag down and lean left → opens leftward.
   A perfectly straight drag keeps the old defaults (down / right). */
function braceFromDrag(startX, startY, point) {
  var endX = snap(point.x), endY = snap(point.y);
  var spanX = Math.abs(endX - startX);
  var spanY = Math.abs(endY - startY);

  if (spanY > spanX) {
    return {
      vertical: true, x: startX,
      y1: Math.min(startY, endY), y2: Math.max(startY, endY),
      facing: (endX - startX) < 0 ? 'left' : 'right',
      span: spanY, text: '?'
    };
  }
  return {
    vertical: false,
    x1: Math.min(startX, endX), x2: Math.max(startX, endX),
    y: startY,
    below: (endY - startY) >= 0,
    span: spanX, text: '?'
  };
}

function drawPreviewBrace(ghost) {
  clearPreview();
  if (ghost.span < 12) { return; }        // too short to read yet
  var geo = braceGeometry(ghost);
  previewLayer.appendChild(makeNode('path', {
    d: geo.d, fill: 'none', stroke: '#66BB6A',
    'stroke-width': 2, 'stroke-dasharray': '5 4', 'pointer-events': 'none'
  }));
  // Ghost the label spot too, so its side is obvious before committing
  var dot = makeText(geo.labelX, geo.labelY, '?', {
    size: 16, bold: true, anchor: geo.anchor, color: '#66BB6A'
  });
  if (geo.baseline) { dot.setAttribute('dominant-baseline', geo.baseline); }
  previewLayer.appendChild(dot);
}

function drawPreviewAlign(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('line', {
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: '#C4C4C4', 'stroke-width': 1.6,
    'stroke-dasharray': '2 5', 'stroke-linecap': 'round'
  }));
}

function drawPreviewMarquee(x1, y1, x2, y2) {
  clearPreview();
  previewLayer.appendChild(makeNode('rect', {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    fill: '#66BB6A', 'fill-opacity': 0.10,
    stroke: '#2E7D32', 'stroke-width': 1.3,
    'stroke-dasharray': '5 4', rx: 3, 'pointer-events': 'none'
  }));
}

/* Any element whose bounding box overlaps the band is caught — a touch
   is enough, so a student doesn't have to enclose a wide brace fully. */
function elementsIntersecting(x1, y1, x2, y2) {
  var left = Math.min(x1, x2), right = Math.max(x1, x2);
  var top = Math.min(y1, y2), bottom = Math.max(y1, y2);
  if (right - left < 4 && bottom - top < 4) { return []; }   // stray click
  var caught = [];
  for (var i = 0; i < appState.elements.length; i++) {
    var box = elementBounds(appState.elements[i]);
    if (box.x <= right && box.x + box.w >= left &&
        box.y <= bottom && box.y + box.h >= top) {
      caught.push(appState.elements[i]);
    }
  }
  return caught;
}

function clearPreview() {
  while (previewLayer.firstChild) { previewLayer.removeChild(previewLayer.firstChild); }
}

/* ── Razor: a vertical cut, exactly where you click ───────────────────
   Hovering with the razor draws a dotted line straight down the canvas
   and a bolder dotted mark across whichever bar it crosses. Clicking
   breaks that bar into two bars at precisely that x.

   Accuracy is the entire point of this tool, so the preview and the cut
   run through ONE function — razorPlan(). The dotted line you are
   looking at IS the blade position; there is no second, slightly
   different rounding step at commit time. The only movement the tool
   ever applies is the magnet below, and that is drawn before you
   click, never after.  */

var RAZOR_MAGNET = 4;        /* viewBox px — this close to a unit line and
                                the blade locks onto it, so a cut meant for
                                a unit boundary lands on it perfectly */
var RAZOR_MIN_PIECE = 4;     // a cut must leave at least this much either side
var RAZOR_UNIT_TOLERANCE = 0.05;   // px — "the blade really is on a unit line"
var RAZOR_FLASH_MS = 420;
var RAZOR_INK = '#E64A19';
var RAZOR_LOCK_INK = '#2E7D32';

var razorHover = null;       // { point, shift } — last known razor position
var razorFlash = null;       // { x, spans, until } — the fading mark of a cut
var razorFlashTimer = null;

/* Topmost bar under a point. Walks backwards because later elements are
   painted last, so the last match is the one the eye sees on top. */
function barAtPoint(point) {
  for (var i = appState.elements.length - 1; i >= 0; i--) {
    var el = appState.elements[i];
    if (el.type !== 'bar') { continue; }
    if (point.x >= el.x && point.x <= el.x + el.w &&
        point.y >= el.y && point.y <= el.y + el.h) { return el; }
  }
  return null;
}

/* Pull the blade onto a unit line when it is within a few px of one.
   Without this, cutting "between unit 2 and unit 3" by eye would leave
   a hair of unit 2 behind on the right-hand piece. */
function razorMagnet(bar, rawX) {
  if (!bar) { return { x: rawX, locked: false }; }
  var units = bar.units || 1;
  if (units < 2) { return { x: rawX, locked: false }; }
  var unitWidth = bar.w / units;
  var index = Math.round((rawX - bar.x) / unitWidth);
  if (index < 1 || index > units - 1) { return { x: rawX, locked: false }; }
  var lineX = bar.x + index * unitWidth;
  if (Math.abs(lineX - rawX) <= RAZOR_MAGNET) { return { x: lineX, locked: true }; }
  return { x: rawX, locked: false };
}

/* Screen-to-canvas conversion leaves float dust — a pointer sitting on
   x = 300 arrives as 299.99703…. Trimming to a hundredth of a pixel
   keeps the stored model tidy without moving the blade anywhere the eye
   could follow. The preview is trimmed by the same call, so the line
   drawn and the line cut stay identical. A magnet-locked x is left
   alone: it comes from exact unit arithmetic and must stay exact. */
function razorTrim(value) {
  return Math.round(value * 100) / 100;
}

/* Everything a razor click will do, worked out once and used for both
   the preview and the cut. */
function razorPlan(point, cutEverything) {
  var host = barAtPoint(point);
  var magnet = razorMagnet(host, point.x);
  var cutX = magnet.locked ? magnet.x : razorTrim(magnet.x);
  var candidates = [];
  if (cutEverything) {
    for (var i = 0; i < appState.elements.length; i++) {
      if (appState.elements[i].type === 'bar') { candidates.push(appState.elements[i]); }
    }
  } else if (host) {
    candidates.push(host);
  }
  var targets = [];
  for (var c = 0; c < candidates.length; c++) {
    var bar = candidates[c];
    // Refuse a cut that would leave a sliver — it is almost always a miss
    if (cutX - bar.x >= RAZOR_MIN_PIECE && (bar.x + bar.w) - cutX >= RAZOR_MIN_PIECE) {
      targets.push(bar);
    }
  }
  return { x: cutX, targets: targets, locked: magnet.locked, host: host };
}

function unitIndexAt(bar, x) {
  var units = bar.units || 1;
  var index = Math.floor((x - bar.x) / (bar.w / units));
  return Math.max(0, Math.min(units - 1, index));
}

/* Break one bar in two at cutX. Returns [left, right]. */
function sliceBarAtX(bar, cutX) {
  var units = bar.units || 1;
  var shaded = bar.shaded || [];
  var unitWidth = bar.w / units;
  var raw = (cutX - bar.x) / unitWidth;
  var nearest = Math.round(raw);
  /* A cut on a unit line keeps the unit grid intact: the pieces simply
     inherit the units either side of the blade, so nothing shifts by so
     much as a pixel. Anywhere else the equal-unit grid cannot survive,
     so each piece becomes a plain one-unit bar of exactly the right
     width. */
  var onUnitLine = nearest >= 1 && nearest <= units - 1 &&
                   Math.abs(raw - nearest) * unitWidth <= RAZOR_UNIT_TOLERANCE;

  var cut = onUnitLine ? bar.x + nearest * unitWidth : cutX;
  var leftWidth = cut - bar.x;

  var left = {
    id: newElementId(), type: 'bar',
    x: bar.x, y: bar.y, w: leftWidth, h: bar.h,
    units: onUnitLine ? nearest : 1, shaded: [], color: bar.color
  };
  var right = {
    id: newElementId(), type: 'bar',
    // Derived from the same single `cut`, so the two pieces meet exactly:
    // no hairline gap, no overlap, and together they still measure bar.w.
    x: cut, y: bar.y, w: bar.w - leftWidth, h: bar.h,
    units: onUnitLine ? units - nearest : 1, shaded: [], color: bar.color
  };

  function carryLabel(piece, index, text) {
    if (!text) { return; }
    if (!piece.labels) { piece.labels = {}; }
    piece.labels[index] = text;
  }

  if (onUnitLine) {
    for (var i = 0; i < units; i++) {
      var piece = i < nearest ? left : right;
      var pieceIndex = i < nearest ? i : i - nearest;
      if (shaded.indexOf(i) !== -1) { piece.shaded.push(pieceIndex); }
      carryLabel(piece, pieceIndex, bar.labels && bar.labels[i]);
    }
  } else {
    // Each piece takes on the shading and wording of the unit its own
    // centre now sits in — the unit it is mostly made of.
    var pieces = [
      { piece: left, centre: bar.x + leftWidth / 2 },
      { piece: right, centre: cut + right.w / 2 }
    ];
    for (var p = 0; p < pieces.length; p++) {
      var sourceUnit = unitIndexAt(bar, pieces[p].centre);
      if (shaded.indexOf(sourceUnit) !== -1) { pieces[p].piece.shaded.push(0); }
      carryLabel(pieces[p].piece, 0, bar.labels && bar.labels[sourceUnit]);
    }
  }

  return [left, right];
}

function performRazorCut(plan) {
  if (!plan || !plan.targets.length) { return false; }
  pushUndoSnapshot();
  var spans = [];
  for (var i = 0; i < plan.targets.length; i++) {
    var bar = plan.targets[i];
    var at = appState.elements.indexOf(bar);
    if (at === -1) { continue; }
    spans.push({ y: bar.y, h: bar.h });
    // Spliced in place so the two pieces keep the original's stacking order
    var pieces = sliceBarAtX(bar, plan.x);
    appState.elements.splice(at, 1, pieces[0], pieces[1]);
  }
  if (!spans.length) { return false; }
  clearSelection();
  renderAllElements();
  razorFlash = { x: plan.x, spans: spans, until: Date.now() + RAZOR_FLASH_MS };
  if (razorFlashTimer) { clearTimeout(razorFlashTimer); }
  razorFlashTimer = setTimeout(function () {
    razorFlashTimer = null;
    razorFlash = null;
    drawRazorPreview();
  }, RAZOR_FLASH_MS);
  return true;
}

function razorLine(x, y1, y2, options) {
  return makeNode('line', {
    x1: x, y1: y1, x2: x, y2: y2,
    stroke: options.ink, 'stroke-width': options.width,
    'stroke-dasharray': options.dash,
    'stroke-linecap': 'round',
    opacity: options.opacity === undefined ? 1 : options.opacity,
    'pointer-events': 'none'
  });
}

/* Small blade ticks pointing into the bar, so the cut mark reads as a
   blade rather than as another guide line. */
function razorTick(x, y, pointingDown) {
  var tip = pointingDown ? y + 6 : y - 6;
  return makeNode('path', {
    d: 'M' + (x - 4.2) + ' ' + y + 'L' + (x + 4.2) + ' ' + y + 'L' + x + ' ' + tip + 'Z',
    fill: RAZOR_INK, stroke: 'none', 'pointer-events': 'none'
  });
}

function drawRazorPreview() {
  if (appState.activeTool !== 'razor') { return; }
  clearPreview();

  if (razorFlash && Date.now() < razorFlash.until) {
    for (var f = 0; f < razorFlash.spans.length; f++) {
      var span = razorFlash.spans[f];
      previewLayer.appendChild(razorLine(
        razorFlash.x, span.y - 9, span.y + span.h + 9,
        { ink: RAZOR_INK, width: 2.8, dash: 'none', opacity: 0.9 }
      ));
    }
  }

  if (!razorHover) { return; }
  var plan = razorPlan(razorHover.point, razorHover.shift);
  var willCut = plan.targets.length > 0;

  // The full-height guide: where the blade is, all the way down
  previewLayer.appendChild(razorLine(plan.x, 0, 460, {
    ink: willCut ? RAZOR_INK : '#9E9E9E',
    width: 1.3, dash: '2.5 5', opacity: willCut ? 0.5 : 0.45
  }));

  for (var t = 0; t < plan.targets.length; t++) {
    var bar = plan.targets[t];
    previewLayer.appendChild(razorLine(plan.x, bar.y - 7, bar.y + bar.h + 7, {
      ink: RAZOR_INK, width: 2.2, dash: '4.5 3.5'
    }));
    previewLayer.appendChild(razorTick(plan.x, bar.y - 7, true));
    previewLayer.appendChild(razorTick(plan.x, bar.y + bar.h + 7, false));
  }

  // A green dot means the blade has locked onto a unit line, so the
  // pieces will come out as whole units
  if (plan.locked && willCut && plan.host) {
    previewLayer.appendChild(makeNode('circle', {
      cx: plan.x, cy: plan.host.y - 16, r: 3.2,
      fill: RAZOR_LOCK_INK, stroke: 'none', 'pointer-events': 'none'
    }));
  }
}

function resetRazorPreview() {
  razorHover = null;
  razorFlash = null;
  if (razorFlashTimer) { clearTimeout(razorFlashTimer); razorFlashTimer = null; }
}

/* Hover preview. Kept as its own listener so the drag handler below is
   left exactly as it was. */
canvasSvg.addEventListener('pointermove', function (event) {
  if (appState.activeTool !== 'razor' || pointerSession || appState.isMarking) { return; }
  razorHover = { point: svgPoint(event.clientX, event.clientY), shift: event.shiftKey };
  drawRazorPreview();
});

canvasSvg.addEventListener('pointerleave', function () {
  if (appState.activeTool !== 'razor') { return; }
  razorHover = null;
  drawRazorPreview();
});

/* Holding or releasing Shift changes the preview from "cut this bar" to
   "cut every bar this line crosses" without the pointer moving. */
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Shift' || appState.activeTool !== 'razor' || !razorHover) { return; }
  if (razorHover.shift) { return; }        // key repeat — nothing has changed
  razorHover.shift = true;
  drawRazorPreview();
});
document.addEventListener('keyup', function (event) {
  if (event.key !== 'Shift' || appState.activeTool !== 'razor' || !razorHover) { return; }
  razorHover.shift = false;
  drawRazorPreview();
});

/* ── Floating input & split popover ──────────────────────────────── */

function canvasScreenPosition(viewX, viewY) {
  // Map viewBox coordinates back to pixel offsets inside the canvas frame
  var rect = canvasSvg.getBoundingClientRect();
  var scaleX = rect.width / 900;
  var scaleY = rect.height / 460;
  return { left: viewX * scaleX, top: viewY * scaleY };
}

function openFloatingInput(viewX, viewY, initialValue, onCommit) {
  closeFloatingWidgets();
  var pos = canvasScreenPosition(viewX, viewY);
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'floating-input';
  input.value = initialValue;
  input.placeholder = 'e.g. Ben, $480, ?';
  var inputLeft = Math.max(4, Math.min(pos.left - 45, canvasFrame.clientWidth - 150));
  var inputTop = Math.max(4, Math.min(pos.top - 18, canvasFrame.clientHeight - 44));
  input.style.left = inputLeft + 'px';
  input.style.top = inputTop + 'px';
  canvasFrame.appendChild(input);

  // Students often don't realise Enter finishes the text — say so.
  var hint = document.createElement('div');
  hint.className = 'floating-input-hint';
  hint.innerHTML = 'Type, then press <kbd>Enter &#8629;</kbd> to add it';
  var hintTop = inputTop + input.offsetHeight + 6;
  if (hintTop > canvasFrame.clientHeight - 30) {
    hintTop = inputTop - 30;               // no room below → show above
  }
  hint.style.left = Math.max(4, inputLeft - 20) + 'px';
  hint.style.top = hintTop + 'px';
  canvasFrame.appendChild(hint);

  input.focus();
  input.select();

  var committed = false;
  function removeWidgets() {
    if (input.parentNode) { input.parentNode.removeChild(input); }
    if (hint.parentNode) { hint.parentNode.removeChild(hint); }
  }
  function commit() {
    if (committed) { return; }
    committed = true;
    var value = input.value;
    removeWidgets();
    onCommit(value);
  }
  input.addEventListener('keydown', function (keyEvent) {
    if (keyEvent.key === 'Enter') { commit(); }
    if (keyEvent.key === 'Escape') {
      committed = true;
      removeWidgets();
    }
    keyEvent.stopPropagation();
  });
  input.addEventListener('blur', commit);
}

function openSplitPopover(barElement, clientX, clientY) {
  closeFloatingWidgets();
  var frameRect = canvasFrame.getBoundingClientRect();
  var popover = document.createElement('div');
  popover.className = 'split-popover';
  popover.innerHTML =
    '<label for="splitUnitsInput">Units</label>' +
    '<input id="splitUnitsInput" type="number" min="1" max="12" value="' + Math.max(2, barElement.units) + '" />' +
    '<button class="btn btn-primary btn-sm" id="splitOkBtn" type="button">Split</button>';
  popover.style.left = Math.max(4, Math.min(clientX - frameRect.left - 60, canvasFrame.clientWidth - 210)) + 'px';
  popover.style.top = Math.max(4, Math.min(clientY - frameRect.top + 10, canvasFrame.clientHeight - 64)) + 'px';
  canvasFrame.appendChild(popover);

  var unitsInput = popover.querySelector('#splitUnitsInput');
  unitsInput.focus();
  unitsInput.select();

  function commitSplit() {
    var count = parseInt(unitsInput.value, 10);
    if (!isNaN(count) && count >= 1 && count <= 12) {
      pushUndoSnapshot();
      barElement.units = count;
      barElement.shaded = barElement.shaded.filter(function (idx) { return idx < count; });
      // Inner labels belong to unit indices, so drop any that the new
      // split has left without a unit to sit in.
      if (barElement.labels) {
        Object.keys(barElement.labels).forEach(function (idx) {
          if (Number(idx) >= count) { delete barElement.labels[idx]; }
        });
      }
      renderAllElements();
    }
    closeFloatingWidgets();
  }
  popover.querySelector('#splitOkBtn').addEventListener('click', commitSplit);
  unitsInput.addEventListener('keydown', function (keyEvent) {
    if (keyEvent.key === 'Enter') { commitSplit(); }
    if (keyEvent.key === 'Escape') { closeFloatingWidgets(); }
    keyEvent.stopPropagation();
  });
}

function closeFloatingWidgets() {
  var stale = canvasFrame.querySelectorAll('.floating-input, .floating-input-hint, .split-popover');
  for (var i = 0; i < stale.length; i++) {
    stale[i].parentNode.removeChild(stale[i]);
  }
}
/* ════════════════════════ THE WINDOW'S OWN WIRING ════════════════════ */

/* Every change to the board goes through renderAllElements, so that is the
   one place a change is noticed. The glue is told at most once per frame,
   and only when the elements really differ — a selection or a hover
   re-renders without changing anything worth saving. */
var msChangeHook = null;
var msChangeTimer = null;
var msLastJson = '[]';
var msRenderAllElements = renderAllElements;
renderAllElements = function () {
  msRenderAllElements();
  if (!msChangeHook || msChangeTimer) { return; }
  msChangeTimer = setTimeout(function () {
    msChangeTimer = null;
    var now = JSON.stringify(appState.elements);
    if (now === msLastJson) { return; }
    msLastJson = now;
    try { msChangeHook(); } catch (err) { console.warn('Model studio change hook failed', err); }
  }, 0);
};

function msChooseTool(name) {
  var buttons = msRoot.querySelectorAll('.tool-btn[data-tool]');
  for (var b = 0; b < buttons.length; b++) {
    buttons[b].classList.toggle('active', buttons[b].getAttribute('data-tool') === name);
  }
  appState.activeTool = name;
  clearSelection();
  renderSelection();
  resetRazorPreview();
  clearPreview();
  canvasSvg.setAttribute('class', 'tool-' + appState.activeTool);
  updateCanvasHint();
}

var toolButtons = msRoot.querySelectorAll('.tool-btn[data-tool]');
for (var t = 0; t < toolButtons.length; t++) {
  (function (button) {
    button.addEventListener('click', function () { msChooseTool(button.getAttribute('data-tool')); });
  })(toolButtons[t]);
}

var swatchButtons = msRoot.querySelectorAll('.swatch');
for (var s = 0; s < swatchButtons.length; s++) {
  (function (swatch) {
    swatch.addEventListener('click', function () {
      for (var w = 0; w < swatchButtons.length; w++) { swatchButtons[w].classList.remove('active'); }
      swatch.classList.add('active');
      appState.activeColor = swatch.getAttribute('data-color');
      // Recolour every selected bar — one swatch click can repaint a group
      var selectedBars = selectedElements().filter(function (el) { return el.type === 'bar'; });
      if (selectedBars.length) {
        pushUndoSnapshot();
        selectedBars.forEach(function (bar) { bar.color = appState.activeColor; });
        renderAllElements();
      }
    });
  })(swatchButtons[s]);
}

msQ('#msUndoBtn').addEventListener('click', performUndo);
msQ('#msClearBtn').addEventListener('click', function () { clearCanvas(false); });
msQ('#msCopyBtn').addEventListener('click', performCopy);
msQ('#msPasteBtn').addEventListener('click', performPaste);

/* ── Keyboard shortcuts ──────────────────────────────────────────── */

var TOOL_SHORTCUTS = { v: 'select', b: 'bar', s: 'split', r: 'razor', h: 'shade', t: 'label', c: 'brace', a: 'arrow', d: 'divider', g: 'dotted', '=': 'dotted', l: 'align', p: 'pen', e: 'eraser' };

var NUDGE_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
};

/* Successive nudges of the same element within a second collapse into
   one undo step, so Ctrl+Z undoes the whole nudge burst at once. */
var lastNudge = { id: null, time: 0 };
function maybeSnapshotForNudge(id) {
  var now = Date.now();
  if (lastNudge.id !== id || now - lastNudge.time > 1000) { pushUndoSnapshot(); }
  lastNudge = { id: id, time: now };
}

/* Escape with nothing selected belongs to the window (it closes it); the
   glue sets this. */
var msEscapeHook = null;

/* Returns true when the key was the board's. */
function msHandleKey(event) {
  var key = event.key || '';
  var lower = key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && lower === 'z') {
    event.preventDefault();
    performUndo();
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && lower === 'a') {
    if (appState.elements.length) {
      event.preventDefault();
      performSelectAll();
    }
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && lower === 'c') {
    if (appState.selectedIds.length) {
      event.preventDefault();
      performCopy();
    }
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && lower === 'v') {
    if (elementClipboard) {
      event.preventDefault();
      performPaste();
    }
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && lower === 'd') {
    if (appState.selectedIds.length) {
      event.preventDefault();
      performDuplicate();
    }
    return true;
  }
  if ((key === 'Delete' || key === 'Backspace') && appState.selectedIds.length) {
    event.preventDefault();
    performDeleteSelection();
    return true;
  }
  if (key === 'Escape') {
    event.preventDefault();
    if (appState.selectedIds.length) {
      clearSelection();
      renderSelection();
      updateCanvasHint();
    } else if (msEscapeHook) {
      msEscapeHook();
    }
    return true;
  }
  if ((key === 'F2' || key === 'Enter') && appState.selectedId) {
    // PowerPoint: F2 / Enter edits the selected shape's text
    event.preventDefault();
    var editTarget = findElementById(appState.selectedId);
    if (editTarget) { beginTextEdit(editTarget, null); }
    return true;
  }
  if (NUDGE_KEYS[key] && appState.selectedIds.length) {
    // Arrow keys nudge one grid step; Ctrl+arrow nudges 1px (PowerPoint).
    event.preventDefault();
    var nudgeTargets = selectedElements();
    if (nudgeTargets.length) {
      var fine = event.ctrlKey || event.metaKey;
      var stepSize = fine ? 1 : GRID_SNAP;
      maybeSnapshotForNudge(appState.selectedIds.join(','));
      for (var n = 0; n < nudgeTargets.length; n++) {
        offsetElementInPlace(nudgeTargets[n], NUDGE_KEYS[key][0] * stepSize, NUDGE_KEYS[key][1] * stepSize, fine);
      }
      renderAllElements();
    }
    return true;
  }
  if (lower === 'f' && appState.selectedIds.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
    // F flips every selected brace to face the other way
    var braces = selectedElements().filter(function (el) { return el.type === 'brace'; });
    if (braces.length) {
      event.preventDefault();
      pushUndoSnapshot();
      braces.forEach(function (brace) {
        if (brace.vertical) { brace.facing = braceFacing(brace) === 'left' ? 'right' : 'left'; }
        else { brace.below = !brace.below; }
      });
      renderAllElements();
      return true;
    }
  }
  var tool = TOOL_SHORTCUTS[lower];
  if (tool && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    msChooseTool(tool);
    return true;
  }
  return false;
}

/* EVERY keystroke inside the window stops here — the board's own and every
   other — or a letter typed while drawing (or into a label) also fires the
   worksheet's one-letter tool shortcuts underneath. Keys typed INTO a
   floating label or the split box are theirs: they are not read as board
   shortcuts, but they still stop here. */
msRoot.addEventListener('keydown', function (event) {
  var target = event.target;
  var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
  if (!typing) { msHandleKey(event); }
  event.stopPropagation();
});
msRoot.addEventListener('keyup', function (event) { event.stopPropagation(); });

/* ── What the glue reads and writes ─────────────────────────────────── */

var MS_TYPES = ['bar', 'label', 'brace', 'arrow', 'divider', 'dotted', 'align', 'pen'];
var MS_MAX_ELEMENTS = 600;

/* Only plain objects of a type the board can draw, with an id it can find.
   A board saved by a later version, or a field mangled on the way through
   storage, must not throw inside the renderer and leave an empty window. */
function msClean(list) {
  if (!Array.isArray(list)) { return []; }
  var out = [];
  var seen = {};
  for (var i = 0; i < list.length && out.length < MS_MAX_ELEMENTS; i++) {
    var el = list[i];
    if (!el || typeof el !== 'object' || Array.isArray(el)) { continue; }
    if (MS_TYPES.indexOf(el.type) === -1) { continue; }
    var copy;
    try { copy = JSON.parse(JSON.stringify(el)); } catch (err) { continue; }
    if (copy.type === 'bar') {
      if (![copy.x, copy.y, copy.w, copy.h].every(isFinite)) { continue; }
      copy.units = Math.max(1, Math.min(60, Math.round(Number(copy.units) || 1)));
      if (!Array.isArray(copy.shaded)) { copy.shaded = []; }
    }
    if (copy.type === 'pen' && !Array.isArray(copy.points)) { continue; }
    if (copy.type === 'label' && typeof copy.text !== 'string') { copy.text = String(copy.text == null ? '' : copy.text); }
    if (typeof copy.id !== 'string' || !copy.id || seen[copy.id]) { copy.id = 'el' + (i + 1) + 'x' + out.length; }
    seen[copy.id] = true;
    out.push(copy);
  }
  return out;
}

/* Fresh ids must never collide with the ones a loaded board already uses. */
function msBumpNextId() {
  var top = 0;
  appState.elements.forEach(function (el) {
    var m = /^el(\d+)$/.exec(el.id || '');
    if (m) { top = Math.max(top, Number(m[1])); }
  });
  appState.nextId = Math.max(appState.nextId, top + 1);
}

function msLoad(list) {
  closeFloatingWidgets();
  resetRazorPreview();
  clearPreview();
  pointerSession = null;
  appState.elements = msClean(list);
  appState.undoStack = [];
  msBumpNextId();
  msLastJson = JSON.stringify(appState.elements);
  clearSelection();
  msRenderAllElements();
}

/* The drawn content's box in viewBox units. The renderer's own bounding
   box is exact (text included) whenever the board is on screen; the
   element maths is the fallback while the window is minimised or hidden. */
function msContentBox() {
  var box = null;
  try {
    var b = elementsLayer.getBBox();
    if (b && b.width > 0 && b.height > 0) { box = { x: b.x, y: b.y, w: b.width, h: b.height }; }
  } catch (err) { box = null; }
  if (!box) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    appState.elements.forEach(function (el) {
      var e = elementBounds(el);
      if (!(e.w > 0 || e.h > 0)) { return; }
      x1 = Math.min(x1, e.x); y1 = Math.min(y1, e.y);
      x2 = Math.max(x2, e.x + e.w); y2 = Math.max(y2, e.y + e.h);
    });
    if (x1 === Infinity) { return null; }
    box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  var pad = 14;
  var x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  var r = Math.min(900, box.x + box.w + pad), btm = Math.min(460, box.y + box.h + pad);
  return { x: x, y: y, w: Math.max(8, r - x), h: Math.max(8, btm - y) };
}

/* The model as a picture for the page: cropped to what is drawn, on a
   TRANSPARENT background so the printed worksheet shows round it, and drawn
   at twice its size so it stays sharp on paper. No selection handles, no
   preview, no grid — those are the window's, not the model's. */
function msPicture() {
  return new Promise(function (resolve, reject) {
    if (!appState.elements.length) { resolve(null); return; }
    var crop = msContentBox();
    if (!crop) { resolve(null); return; }
    var k = Math.max(1, Math.min(3, 1600 / crop.w));
    k = Math.min(k, 2.5);
    var outW = Math.max(1, Math.round(crop.w * k)), outH = Math.max(1, Math.round(crop.h * k));
    var clone = canvasSvg.cloneNode(false);
    clone.removeAttribute('id');
    clone.removeAttribute('class');
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', crop.x + ' ' + crop.y + ' ' + crop.w + ' ' + crop.h);
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
    var layer = document.createElementNS(SVG_NS, 'g');
    // Rendered from the elements, not copied off the screen, so a selection
    // in progress or a half-typed label can never end up in the picture.
    msRenderElementsInto(layer);
    clone.appendChild(layer);
    var url;
    try {
      var serialized = new XMLSerializer().serializeToString(clone);
      url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }));
    } catch (err) { reject(err); return; }
    var image = new Image();
    image.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        canvas.getContext('2d').drawImage(image, 0, 0, outW, outH);
        URL.revokeObjectURL(url);
        resolve({ src: canvas.toDataURL('image/png'), ratio: crop.w / crop.h, w: crop.w, h: crop.h });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('Could not draw the model as a picture.'));
    };
    image.src = url;
  });
}

/* renderAllElements without the selection and the hint, into a detached
   group — the picture's, never the window's. */
function msRenderElementsInto(target) {
  for (var i = 0; i < appState.elements.length; i++) {
    var element = appState.elements[i];
    var node = null;
    if (element.type === 'bar') { node = renderBarElement(element); }
    else if (element.type === 'label') { node = renderLabelElement(element); }
    else if (element.type === 'brace') { node = renderBraceElement(element); }
    else if (element.type === 'arrow') { node = renderArrowElement(element); }
    else if (element.type === 'divider') { node = renderDividerElement(element); }
    else if (element.type === 'dotted') { node = renderDottedElement(element); }
    else if (element.type === 'align') { node = renderAlignElement(element); }
    else if (element.type === 'pen') { node = renderPenElement(element); }
    if (node) { target.appendChild(node); }
  }
}

/* ── Boot ────────────────────────────────────────────────────────── */

buildSelectionActions();
canvasSvg.setAttribute('class', 'tool-' + appState.activeTool);
msRenderAllElements();

window.ModelStudio = {
  load: msLoad,
  elements: function () { return JSON.parse(JSON.stringify(appState.elements)); },
  isEmpty: function () { return appState.elements.length === 0; },
  picture: msPicture,
  clean: msClean,
  /* Any label being typed is committed (its own blur does it) and any
     popover closed, so what is read next is what is on screen. */
  settle: function () {
    var input = canvasFrame.querySelector('.floating-input');
    if (input) { try { input.blur(); } catch (err) {} }
    closeFloatingWidgets();
  },
  /* One undo step on the board, so New model is never a loss. */
  clear: function () { if (appState.elements.length) { clearCanvas(true); } },
  tool: msChooseTool,
  onChange: function (fn) { msChangeHook = typeof fn === 'function' ? fn : null; },
  onEscape: function (fn) { msEscapeHook = typeof fn === 'function' ? fn : null; },
  refresh: function () { msRenderAllElements(); }
};
})();
