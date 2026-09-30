/* Singapore maths bars use the existing rectangle annotation type. All
   additions are plain JSON and follow normal undo, save, replay and export.
   modelLabel belongs to the rectangle, so moving/resizing a piece carries
   its quantity with it. Braces and outside labels are ordinary annotations. */
var BM_PALETTE = ['#C8DDF2', '#CBE8D5', '#F8D6BB', '#DDD2F0', '#F5D0D8', '#F4E7AF'];
var bmFill = BM_PALETTE[0];
var bmLastSelection = '';
var bmMeasureContext = null;

function bmIsBar(a) { return !!a && a.type === 'rect' && a.modelBar === true; }
function bmLabel(a) { return String(a.modelLabel || '').replace(/\s+/g, ' ').slice(0, 80); }
function bmRadius(a) { return Math.max(0, Math.min(8, a.w / 4, a.h / 4)); }
function bmColour(a) { return /^#[0-9a-f]{6}$/i.test(a.fill || '') ? a.fill : BM_PALETTE[0]; }
function bmLabelLayout(a, measure) {
  var text = bmLabel(a), size = Math.max(0.1, Math.min(18, a.h * 0.44));
  var maxWidth = Math.max(1, a.w - 12), width = measure(text, size);
  if (width > maxWidth) size *= maxWidth / width;
  return { text: text, size: size, x: a.x + a.w / 2, y: a.y + a.h / 2 };
}
function bmNewBar(page, x, y, w, h, label, fill) {
  return { id: newAnnId(), page: page, type: 'rect', modelBar: true,
    x: x, y: y, w: w, h: h, color: '#526B84', width: 1.4,
    fill: fill || bmFill, modelLabel: String(label || '').slice(0, 80), ts: Date.now() };
}
function bmSplitGeometry(a, fractions) {
  if (!bmIsBar(a) || a.rot || !Number.isFinite(a.w) || !Number.isFinite(a.h) || a.h < 12) throw new Error('Use an unrotated bar at least 12 points high.');
  var stops = [0].concat(fractions).concat([1]);
  if (stops.length > 21 || !stops.every(function (v, i) { return Number.isFinite(v) && v >= 0 && v <= 1 && (!i || v > stops[i - 1]); })) throw new Error('Choose between 2 and 20 equal parts, or cut inside the bar.');
  return stops.slice(1).map(function (stop, i) {
    var w = a.w * (stop - stops[i]);
    if (w < 12) throw new Error('Each piece needs at least 12 points of width. Enlarge the bar first.');
    return { x: a.x + a.w * stops[i], y: a.y, w: w, h: a.h };
  });
}
function bmJoinGeometry(bars) {
  if (bars.length < 2) throw new Error('Lasso two or more neighbouring bar pieces first.');
  var ordered = bars.slice().sort(function (a, b) { return a.x - b.x; });
  var first = ordered[0], right = first.x;
  ordered.forEach(function (a) {
    if (!bmIsBar(a) || a.rot || a.page !== first.page || Math.abs(a.y - first.y) > 1 || Math.abs(a.h - first.h) > 1 || Math.abs(a.x - right) > 3) throw new Error('Join pieces on the same row with matching heights and touching edges.');
    right = a.x + a.w;
  });
  return { x: first.x, y: first.y, w: right - first.x, h: first.h, ordered: ordered };
}

/* Shared visual geometry for the PDF renderer. A sampled rounded outline
   also preserves rotated models without rasterising the printed page. */
function bmOutlinePoints(a) {
  var r = bmRadius(a), pts = [];
  var centres = [[a.x + a.w - r, a.y + r, -90], [a.x + a.w - r, a.y + a.h - r, 0],
    [a.x + r, a.y + a.h - r, 90], [a.x + r, a.y + r, 180]];
  centres.forEach(function (c) {
    for (var i = 0; i <= 8; i++) {
      var angle = (c[2] + i * 90 / 8) * Math.PI / 180;
      var pt = { x: c[0] + r * Math.cos(angle), y: c[1] + r * Math.sin(angle) };
      if (a.rot) pt = rotPt(pt, { x: a.x + a.w / 2, y: a.y + a.h / 2 }, a.rot);
      pts.push(pt);
    }
  });
  return pts;
}
function bmSvgContents(g, a) {
  g.appendChild(el('rect', { x: a.x, y: a.y, width: a.w, height: a.h,
    rx: bmRadius(a), fill: bmColour(a), stroke: a.color || '#526B84', 'stroke-width': a.width || 1.4 }));
  if (!bmLabel(a)) return;
  if (!bmMeasureContext) bmMeasureContext = document.createElement('canvas').getContext('2d');
  var lab = bmLabelLayout(a, function (text, size) { bmMeasureContext.font = size + 'px sans-serif'; return bmMeasureContext.measureText(text).width; });
  var node = el('text', { x: lab.x, y: lab.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-size': lab.size, 'font-family': 'sans-serif', fill: '#26384C', 'pointer-events': 'none' });
  node.textContent = lab.text;
  g.appendChild(node);
}
function bmDrawOnCtx(ctx, a, kx, ky) {
  var x = a.x * kx, y = a.y * ky, w = a.w * kx, h = a.h * ky, rx = bmRadius(a) * kx, ry = bmRadius(a) * ky;
  ctx.beginPath(); ctx.moveTo(x + rx, y); ctx.lineTo(x + w - rx, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + ry); ctx.lineTo(x + w, y + h - ry);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rx, y + h); ctx.lineTo(x + rx, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - ry); ctx.lineTo(x, y + ry);
  ctx.quadraticCurveTo(x, y, x + rx, y); ctx.closePath();
  ctx.fillStyle = bmColour(a); ctx.fill(); ctx.stroke();
  if (!bmLabel(a)) return;
  var lab = bmLabelLayout(a, function (text, size) { ctx.font = size + 'px sans-serif'; return ctx.measureText(text).width; });
  ctx.font = lab.size * ky + 'px sans-serif'; ctx.fillStyle = '#26384C'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lab.text, lab.x * kx, lab.y * ky, Math.max(1, (a.w - 12) * kx));
}
function bmDrawOnPdf(a, page, cv, rgb, font, pageHeight) {
  var fill = hexToRgb01(bmColour(a)), stroke = hexToRgb01(a.color || '#526B84');
  var path = bmOutlinePoints(a).map(function (pt, i) { var q = cv(pt.x, pt.y); return (i ? 'L ' : 'M ') + q.x + ' ' + (pageHeight - q.y); }).join(' ') + ' Z';
  page.drawSvgPath(path, { x: 0, y: pageHeight, color: rgb(fill.r, fill.g, fill.b), borderColor: rgb(stroke.r, stroke.g, stroke.b), borderWidth: a.width || 1.4 });
  if (!bmLabel(a)) return;
  var copy = Object.assign({}, a, { modelLabel: winAnsiSafe(bmLabel(a)) });
  var lab = bmLabelLayout(copy, function (text, size) { return font.widthOfTextAtSize(text, size); });
  var base = { x: lab.x - font.widthOfTextAtSize(lab.text, lab.size) / 2, y: lab.y + lab.size * 0.35 };
  if (a.rot) base = rotPt(base, { x: lab.x, y: lab.y }, a.rot);
  var anchor = cv(base.x, base.y), opts = { x: anchor.x, y: anchor.y, size: lab.size, font: font, color: rgb(0.149, 0.22, 0.298) };
  if (a.rot) opts.rotate = PDFLib.degrees(-a.rot);
  page.drawText(lab.text, opts);
}

/* UI and worksheet operations. No network calls are needed for modelling. */
function bmCanEdit() { return pages.length > 0 && !(isStudent() && !practiceMode) && !reviseMode && !lessonPlayback && !lessonOpening; }
function bmPanel() { return document.getElementById('barModelPanel'); }
function bmSelected() {
  var ids = lassoSel && lassoSel.ids.length ? lassoSel.ids : [selectedId];
  return annotations.filter(function (a) { return ids.indexOf(a.id) !== -1 && bmIsBar(a); });
}
function bmEditableSelection() {
  var bars = bmSelected();
  if (!bars.length) throw new Error('Select a model bar first.');
  if (bars.some(annLocked)) throw new Error('Unlock the selected bars before changing them.');
  return bars;
}
function bmValue(id) { return document.getElementById(id).value; }
function bmDimensions() {
  var w = Number(bmValue('bmWidth')), h = Number(bmValue('bmHeight'));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 12 || h < 12 || w > 2000 || h > 500) throw new Error('Choose a width of 12–2000 and a height of 12–500 points.');
  return { w: w, h: h };
}
function bmParts() {
  var n = Number(bmValue('bmParts'));
  if (!Number.isInteger(n) || n < 2 || n > 20) throw new Error('Choose 2–20 equal parts.');
  return n;
}
function bmSafe(work) {
  try {
    if (!bmCanEdit()) throw new Error(reviseMode ? 'Turn off revision mode to edit models.' : 'Open an editable worksheet first.');
    if (drawing || draggingSel || resizingSel || erasing || lassoing || lassoMoving || lassoResizing || lassoRotating) throw new Error('Finish the current drawing or move first.');
    commitActiveTextEdit();
    work();
  } catch (err) { toast(err.message || 'The model could not be changed.', 4500); }
}
function bmValidatePlacement(additions) {
  additions.forEach(function (a) {
    var p = pages.find(function (item) { return item.num === a.page; }), b = annBounds(a);
    if (a.type === 'brace') {
      var points = bracePoints(a);
      b = { x: Math.min.apply(null, points.map(function (pt) { return pt.x; })), y: Math.min.apply(null, points.map(function (pt) { return pt.y; })),
        x2: Math.max.apply(null, points.map(function (pt) { return pt.x; })), y2: Math.max.apply(null, points.map(function (pt) { return pt.y; })) };
    }
    if (!p || ![b.x,b.y,b.x2,b.y2].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.x2 > p.baseW || b.y2 > p.baseH) throw new Error('The model does not fit on this page. Reduce its size or move it away from the edge.');
  });
}
function bmCommit(removeIds, additions, selectAll) {
  bmValidatePlacement(additions);
  pushUndo();
  annotations = annotations.filter(function (a) { return removeIds.indexOf(a.id) < 0; }).concat(additions);
  clearLassoSel(false); editingId = null; editModeId = null;
  selectedId = additions.length ? additions[0].id : null;
  if (selectAll && additions.length > 1) {
    selectedId = null;
    lassoSel = { page: pages.find(function (p) { return p.num === additions[0].page; }), ids: additions.map(function (a) { return a.id; }) };
  } else if (selectedId && bmIsBar(additions[0])) editModeId = selectedId;
  renderAllOverlays(); setDirty(true);
  if (lassoSel) showLassoBar();
  bmSync(true);
}
function bmAnchor(w, h) {
  var p = pages.find(function (item) { return item.num === currentPageNum(); }) || pages[0];
  if (w > p.baseW - 24 || h > p.baseH - 24) throw new Error('The model is larger than this page. Reduce its size first.');
  var rect = p.svg.getBoundingClientRect(), view = document.getElementById('viewerArea').getBoundingClientRect();
  var midY = (Math.max(rect.top, view.top) + Math.min(rect.bottom, view.bottom)) / 2;
  return { page: p.num, x: Math.max(12, (p.baseW - w) / 2), y: Math.max(12, Math.min(p.baseH - h - 12, (midY - rect.top) * p.baseH / rect.height - h / 2)) };
}
function bmBracket(page, x, y, w, label, below) {
  var labelH = 25;
  var a = { id: newAnnId(), page: page, type: 'brace', color: '#526B84', width: 1.4,
    x1: below ? x + w : x, y1: y, x2: below ? x : x + w, y2: y, ts: Date.now() };
  var depth = braceDepth(a);
  var t = { id: newAnnId(), page: page, type: 'text', x: x, y: below ? y + depth + 5 : y - depth - labelH - 6,
    w: w, h: labelH, text: String(label || '?').slice(0, 80), fontSize: 14, color: '#26384C', align: 'center', kw: [], ts: Date.now() };
  var group = 'model-label-' + newAnnId(); a.grp = group; t.grp = group;
  return [a, t];
}
function bmSplit(a, fractions) {
  if (annLocked(a)) throw new Error('Unlock this bar before cutting it.');
  var boxes = bmSplitGeometry(a, fractions);
  var additions = boxes.map(function (box, i) { return bmNewBar(a.page, box.x, box.y, box.w, box.h, '?', i % 2 ? BM_PALETTE[(BM_PALETTE.indexOf(bmColour(a)) + 1) % BM_PALETTE.length] : bmColour(a)); });
  // Cutting a quantity never silently copies that quantity to every part.
  // Its label becomes the total above the whole span; each part starts unknown.
  var total = bmLabel(a) && bmLabel(a) !== '?';
  if (total) {
    var below = a.y < 76;
    additions = additions.concat(bmBracket(a.page, a.x, below ? a.y + a.h + 8 : a.y - 8, a.w, bmLabel(a), below));
  }
  bmCommit([a.id], additions, false);
  toast(total ? 'Bar cut. Label each part; the original quantity is kept as the whole.' : 'Bar cut. Label each new part.');
}
function bmCutAt(e, p, pt) {
  e.preventDefault();
  bmSafe(function () {
    var node = e.target.closest && e.target.closest('[data-id]');
    var a = node && annotations.find(function (item) { return item.id === node.getAttribute('data-id'); });
    if (!bmIsBar(a) || a.page !== p.num) throw new Error('Tap inside a model bar where you want to cut it.');
    bmSplit(a, [(pt.x - a.x) / a.w]);
  });
}
function bmDrawingStart(p, pt) {
  var a = bmNewBar(p.num, pt.x, pt.y, 0, 0, bmValue('bmLabel'), bmFill);
  a._sx = pt.x; a._sy = pt.y;
  return a;
}
function bmFinishDrawing(a, p, tempNode) {
  if (tempNode && tempNode.parentNode) tempNode.parentNode.removeChild(tempNode);
  delete a._sx; delete a._sy;
  if (a.w < 6 && a.h < 6) {
    try { var dims = bmDimensions(); a.w = dims.w; a.h = dims.h; } catch (err) { toast(err.message); return; }
  }
  a.w = Math.max(24, a.w); a.h = Math.max(20, a.h);
  a.w = Math.min(a.w, p.baseW); a.h = Math.min(a.h, p.baseH);
  a.x = Math.max(0, Math.min(a.x, p.baseW - a.w)); a.y = Math.max(0, Math.min(a.y, p.baseH - a.h));
  bmCommit([], [a], false);
}
function bmTemplate(kind) {
  var dims = bmDimensions(), n = bmParts(), label = bmValue('bmLabel') || '?';
  if (dims.w / n < 12) throw new Error('Increase the width to give each part at least 12 points.');
  var rowGap = 80, top = 76, totalH = top + dims.h + (kind === 'comparison' ? dims.h + rowGap : 0);
  var at = bmAnchor(dims.w, totalH), additions = [];
  function row(count, y, colour, labels) {
    var unit = dims.w / n;
    for (var i = 0; i < count; i++) additions.push(bmNewBar(at.page, at.x + i * unit, y, unit, dims.h, labels(i), colour(i)));
  }
  var y = at.y + top;
  if (kind === 'fraction') {
    row(n, y, function (i) { return i === 0 ? bmFill : '#F3F4F6'; }, function () { return '1/' + n; });
    additions = additions.concat(bmBracket(at.page, at.x, y - 8, dims.w, '1 whole', false));
  } else if (kind === 'comparison') {
    var shorter = Number(bmValue('bmCompareUnits'));
    if (!Number.isInteger(shorter) || shorter < 1 || shorter >= n) throw new Error('The shorter row needs a whole number of units, from 1 to ' + (n - 1) + '.');
    row(n, y, function () { return bmFill; }, function () { return '?'; });
    row(shorter, y + dims.h + rowGap, function () { return BM_PALETTE[1]; }, function () { return '?'; });
    additions = additions.concat(bmBracket(at.page, at.x, y - 8, dims.w, label, false));
    additions = additions.concat(bmBracket(at.page, at.x + shorter * dims.w / n, y + dims.h + rowGap - 8, (n - shorter) * dims.w / n, '? difference', false));
  } else {
    row(n, y, function (i) { return BM_PALETTE[i % BM_PALETTE.length]; }, function () { return '?'; });
    additions = additions.concat(bmBracket(at.page, at.x, y - 8, dims.w, label, false));
  }
  setTool('select'); bmCommit([], additions, true);
}
function bmRun(action) {
  bmSafe(function () {
    var bars, dims, a;
    if (action === 'undo') { undo(); bmSync(true); return; }
    if (action === 'draw' || action === 'cut' || action === 'select' || action === 'lasso') {
      setTool(action === 'draw' ? 'modelbar' : action === 'cut' ? 'modelcut' : action);
      bmSync(true); return;
    }
    if (action === 'add') {
      dims = bmDimensions(); var at = bmAnchor(dims.w, dims.h);
      setTool('select'); bmCommit([], [bmNewBar(at.page, at.x, at.y, dims.w, dims.h, bmValue('bmLabel'), bmFill)], false); return;
    }
    if (action === 'partwhole' || action === 'comparison' || action === 'fraction') { bmTemplate(action); return; }
    bars = bmEditableSelection(); a = bars[0];
    if (action === 'apply') {
      if (bars.length !== 1) throw new Error('Select one bar to change its label and dimensions.');
      dims = bmDimensions();
      var updated = Object.assign({}, a, { w: dims.w, h: dims.h, modelLabel: bmValue('bmLabel').slice(0,80), fill: bmFill });
      bmCommit([a.id], [updated], false);
    } else if (action === 'split') {
      if (bars.length !== 1) throw new Error('Select one bar to split into equal parts.');
      var n = bmParts(), stops = []; for (var i = 1; i < n; i++) stops.push(i / n);
      bmSplit(a, stops);
    } else if (action === 'join') {
      var box = bmJoinGeometry(bars);
      var combined = box.ordered.map(bmLabel).filter(Boolean).join(' + ');
      if (combined.length > 80) throw new Error('Shorten the piece labels before joining them; their combined label must fit 80 characters.');
      var joined = bmNewBar(a.page, box.x, box.y, box.w, box.h, combined, bmColour(a));
      bmCommit(bars.map(function (item) { return item.id; }), [joined], false);
    } else if (action === 'duplicate') {
      var copies = bars.map(function (item) { var copy = JSON.parse(JSON.stringify(item)); copy.id = newAnnId(); delete copy.grp; copy.y += copy.h + 12; copy.ts = Date.now(); return copy; });
      bmCommit([], copies, copies.length > 1);
    } else if (action === 'above' || action === 'below') {
      if (bars.some(function (item) { return item.page !== a.page || item.rot; })) throw new Error('Choose unrotated bars on one page.');
      var x = Math.min.apply(null, bars.map(function (item) { return item.x; }));
      var right = Math.max.apply(null, bars.map(function (item) { return item.x + item.w; }));
      var below = action === 'below';
      var y = below ? Math.max.apply(null, bars.map(function (item) { return item.y + item.h; })) + 8 : Math.min.apply(null, bars.map(function (item) { return item.y; })) - 8;
      bmCommit([], bmBracket(a.page, x, y, right - x, bmValue('bmLabel') || '?', below), true);
    }
  });
}
function bmSync(force) {
  var panel = bmPanel(); if (!panel || panel.hidden) return;
  if (!bmCanEdit()) { panel.hidden = true; document.getElementById('barModelBtn').setAttribute('aria-expanded', 'false'); return; }
  var bars = bmSelected(), one = bars.length === 1 ? bars[0] : null;
  var key = JSON.stringify(bars.map(function (a) { return [a.id, a.w, a.h, a.fill, a.modelLabel]; }));
  if (force || key !== bmLastSelection) {
    if (one) {
      [['bmLabel', bmLabel(one)], ['bmWidth', Math.round(one.w * 10) / 10], ['bmHeight', Math.round(one.h * 10) / 10]].forEach(function (entry) {
        var input = document.getElementById(entry[0]); if (document.activeElement !== input) input.value = entry[1];
      });
      bmFill = bmColour(one);
    }
    bmLastSelection = key;
  }
  document.getElementById('bmStatus').textContent = tool === 'modelcut' ? 'Tap a bar at the cut point.' : tool === 'modelbar' ? 'Drag on the worksheet to draw a bar.' : bars.length ? bars.length + (bars.length === 1 ? ' bar selected · drag to move or resize.' : ' bars selected.') : 'Select a bar, or add a new model.';
  panel.querySelectorAll('[data-bm-fill]').forEach(function (btn) { btn.setAttribute('aria-pressed', String(btn.getAttribute('data-bm-fill') === bmFill)); });
  panel.querySelectorAll('[data-bm-mode]').forEach(function (btn) { btn.setAttribute('aria-pressed', String(btn.getAttribute('data-bm-mode') === tool)); });
}
function bmToggle() {
  if (!bmCanEdit()) { toast('Open an editable worksheet to build a model.'); return; }
  var panel = bmPanel(); panel.hidden = !panel.hidden;
  document.getElementById('barModelBtn').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) bmSync(true);
}
document.getElementById('barModelBtn').addEventListener('click', bmToggle);
document.getElementById('bmClose').addEventListener('click', function () { bmPanel().hidden = true; document.getElementById('barModelBtn').setAttribute('aria-expanded', 'false'); });
bmPanel().addEventListener('click', function (e) {
  var action = e.target.closest('[data-bm-action]');
  if (action) { bmRun(action.getAttribute('data-bm-action')); return; }
  var swatch = e.target.closest('[data-bm-fill]');
  if (swatch) {
    bmFill = swatch.getAttribute('data-bm-fill');
    bmSafe(function () {
      var bars = bmSelected();
      if (bars.length) { bmEditableSelection(); bmCommit(bars.map(function (a) { return a.id; }), bars.map(function (a) { return Object.assign({}, a, { fill: bmFill }); }), bars.length > 1); }
    });
    bmSync();
  }
});
document.getElementById('bmLabel').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); bmRun('apply'); } });
