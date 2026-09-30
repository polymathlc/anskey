/* Manual model editing. These tools only change local worksheet annotations;
   they use the same save, undo, rendering and group fields as normal drawing. */
function bmSuiteSelection() {
  var ids = lassoSel && lassoSel.ids.length ? lassoSel.ids : [selectedId];
  var chosen = annotations.filter(function (a) { return ids.indexOf(a.id) !== -1; });
  return annotations.filter(function (a) {
    return ids.indexOf(a.id) !== -1 || chosen.some(function (seed) {
      return seed.grp && seed.grp === a.grp && seed.page === a.page;
    });
  });
}
function bmSuiteEditable(items) {
  if (!items.length) throw new Error('Select a model bar, label or brace first.');
  if (items.some(function (a) { return a.page !== items[0].page; })) throw new Error('Select objects on one page at a time.');
  if (items.some(annLocked)) throw new Error('Unlock every selected object and group member before changing the model.');
  if (typeof lessonCapture !== 'undefined' && lessonCapture && items.some(function (a) { return a.type === 'ainote' || a.type === 'embed'; })) {
    throw new Error('Finish recording before changing a group containing a note or widget.');
  }
  return items;
}
function bmSuiteNumber(id, min, max, label) {
  var raw = bmValue(id).trim(), number = Number(raw);
  if (!raw || !Number.isFinite(number) || number < min || number > max) throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
  return number;
}
function bmSuiteRatioStops(raw) {
  var values = String(raw).trim().split(/\s*:\s*/);
  if (values.length < 2 || values.length > 20 || values.some(function (value) { return !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value); })) {
    throw new Error('Enter 2–20 positive ratio parts separated by colons, such as 2:3:1.');
  }
  values = values.map(Number);
  var total = values.reduce(function (sum, value) { return sum + value; }, 0), sum = 0;
  if (!Number.isFinite(total) || values.some(function (value) { return !Number.isFinite(value) || value <= 0; })) throw new Error('Every ratio part must be a positive number.');
  return values.slice(0, -1).map(function (value) { sum += value; return sum / total; });
}
function bmSuiteBounds(items) {
  var boxes = items.map(function (a) {
    if (a.type !== 'brace') return annBounds(a);
    var pts = bracePoints(a);
    return { x: Math.min.apply(null, pts.map(function (p) { return p.x; })), y: Math.min.apply(null, pts.map(function (p) { return p.y; })),
      x2: Math.max.apply(null, pts.map(function (p) { return p.x; })), y2: Math.max.apply(null, pts.map(function (p) { return p.y; })) };
  });
  var bounds = { x: Math.min.apply(null, boxes.map(function (b) { return b.x; })), y: Math.min.apply(null, boxes.map(function (b) { return b.y; })),
    x2: Math.max.apply(null, boxes.map(function (b) { return b.x2; })), y2: Math.max.apply(null, boxes.map(function (b) { return b.y2; })) };
  bounds.w = bounds.x2 - bounds.x; bounds.h = bounds.y2 - bounds.y;
  return bounds;
}
function bmSuiteCopy(a) { return JSON.parse(JSON.stringify(a)); }
function bmSuiteReplace(items, copies) {
  // Invalid geometry never reaches history. An unchanged command is a no-op.
  bmValidatePlacement(copies);
  if (JSON.stringify(items) === JSON.stringify(copies)) return;
  bmCommit(items.map(function (a) { return a.id; }), copies, copies.length > 1);
}
function bmSuiteSelect(items) {
  if (!items.length) throw new Error('There are no model objects to select on this page.');
  if (items.some(function (a) { return a.page !== items[0].page; })) throw new Error('Select objects on one page at a time.');
  setTool('select'); clearLassoSel(false); editingId = null; editModeId = null;
  selectedId = items.length === 1 ? items[0].id : null;
  if (items.length > 1) lassoSel = { page: pages.find(function (p) { return p.num === items[0].page; }), ids: items.map(function (a) { return a.id; }) };
  else if (bmIsBar(items[0])) editModeId = items[0].id;
  renderAllOverlays(); if (lassoSel) showLassoBar(); bmSync(true);
}
function bmSuiteUnits(items) {
  var units = [], seen = new Set();
  items.forEach(function (a) {
    var key = a.grp ? 'group:' + a.grp : 'object:' + a.id;
    if (seen.has(key)) return;
    seen.add(key);
    var members = a.grp ? items.filter(function (b) { return b.grp === a.grp; }) : [a];
    units.push({ items: members, bounds: bmSuiteBounds(members) });
  });
  return units;
}
function bmSuiteArrange(action, items) {
  var units = bmSuiteUnits(items);
  if (units.length < 2) throw new Error('Select at least two bars or groups. Ungroup a model to arrange its individual parts.');
  var bounds = bmSuiteBounds(items), changes = new Map(), gap, cursor;
  if (action === 'row' || action === 'stack') {
    gap = bmSuiteNumber('bmGap', 0, 500, 'Gap');
    units.sort(function (a, b) { return action === 'row' ? a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y : a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x; });
    cursor = action === 'row' ? bounds.x : bounds.y;
  }
  units.forEach(function (unit) {
    var b = unit.bounds, dx = 0, dy = 0;
    if (action === 'align-left') dx = bounds.x - b.x;
    else if (action === 'align-right') dx = bounds.x2 - b.x2;
    else if (action === 'align-top') dy = bounds.y - b.y;
    else if (action === 'align-bottom') dy = bounds.y2 - b.y2;
    else if (action === 'row') { dx = cursor - b.x; dy = bounds.y - b.y; cursor += b.w + gap; }
    else if (action === 'stack') { dx = bounds.x - b.x; dy = cursor - b.y; cursor += b.h + gap; }
    unit.items.forEach(function (a) { var copy = bmSuiteCopy(a); translateAnn(copy, dx, dy); changes.set(a.id, copy); });
  });
  bmSuiteReplace(items, items.map(function (a) { return changes.get(a.id); }));
}
function bmSuiteEqualSize(action, items) {
  if (items.length < 2 || items.some(function (a) { return !bmIsBar(a) || a.grp || a.rot; })) {
    throw new Error('Select at least two unrotated, ungrouped bars. Ungroup models before resizing their individual parts.');
  }
  var dimension = action === 'equal-width' ? 'w' : 'h';
  var size = Math.max.apply(null, items.map(function (a) { return a[dimension]; }));
  bmSuiteReplace(items, items.map(function (a) { var copy = bmSuiteCopy(a); copy[dimension] = size; return copy; }));
}
function bmSuiteRun(action) {
  var actions = ['ratio-split', 'percent-cut', 'align-left', 'align-right', 'align-top', 'align-bottom', 'equal-width', 'equal-height',
    'stack', 'row', 'nudge-left', 'nudge-right', 'nudge-up', 'nudge-down', 'group', 'ungroup', 'duplicate-model', 'delete', 'redo', 'select-model', 'select-page-models'];
  if (actions.indexOf(action) < 0) return false;
  bmSafe(function () {
    if (action === 'redo') { redo(); bmSync(true); return; }
    var items = bmSuiteSelection();
    if (action === 'select-model') { bmSuiteSelect(items); return; }
    if (action === 'select-page-models') {
      var page = currentPageNum(), groups = new Set(annotations.filter(function (a) { return a.page === page && bmIsBar(a) && a.grp; }).map(function (a) { return a.grp; }));
      bmSuiteSelect(annotations.filter(function (a) { return a.page === page && (bmIsBar(a) || a.modelObject === true || (a.grp && (groups.has(a.grp) || a.grp.indexOf('model-label-') === 0))); }));
      return;
    }
    bmSuiteEditable(items);
    if (action === 'ratio-split' || action === 'percent-cut') {
      var bars = bmSelected();
      if (bars.length !== 1) throw new Error('Select one bar to cut. Ungroup a model to select one of its parts.');
      var stops = action === 'ratio-split' ? bmSuiteRatioStops(bmValue('bmRatio')) : [bmSuiteNumber('bmCutPercent', 1, 99, 'Cut position (%)') / 100];
      bmSplit(bars[0], stops); return;
    }
    if (action.indexOf('align-') === 0 || action === 'row' || action === 'stack') { bmSuiteArrange(action, items); return; }
    if (action === 'equal-width' || action === 'equal-height') { bmSuiteEqualSize(action, items); return; }
    if (action === 'delete') { bmCommit(items.map(function (a) { return a.id; }), [], false); return; }
    var copies = items.map(bmSuiteCopy);
    if (action.indexOf('nudge-') === 0) {
      var step = bmSuiteNumber('bmStep', 0.1, 500, 'Move step');
      var dx = action === 'nudge-left' ? -step : action === 'nudge-right' ? step : 0;
      var dy = action === 'nudge-up' ? -step : action === 'nudge-down' ? step : 0;
      copies.forEach(function (a) { translateAnn(a, dx, dy); });
    } else if (action === 'group') {
      if (items.length < 2) throw new Error('Select at least two model objects to group.');
      if (items.every(function (a) { return a.grp && a.grp === items[0].grp; })) return;
      var group = 'model-' + newAnnId(); copies.forEach(function (a) { a.grp = group; });
    } else if (action === 'ungroup') {
      var modelGroups = new Set(items.filter(function (a) { return bmIsBar(a) && a.grp; }).map(function (a) { return a.grp; }));
      copies.forEach(function (a) {
        if ((a.type === 'text' || a.type === 'brace') && a.grp && (modelGroups.has(a.grp) || a.grp.indexOf('model-') === 0)) a.modelObject = true;
        delete a.grp;
      });
    } else if (action === 'duplicate-model') {
      var box = bmSuiteBounds(items), offset = box.h + bmSuiteNumber('bmGap', 0, 500, 'Gap'), groups = new Map();
      copies.forEach(function (a) {
        a.id = newAnnId(); a.ts = Date.now();
        if (a.grp) { if (!groups.has(a.grp)) groups.set(a.grp, 'model-' + newAnnId()); a.grp = groups.get(a.grp); }
        translateAnn(a, 0, offset);
      });
      bmCommit([], copies, copies.length > 1); return;
    }
    bmSuiteReplace(items, copies);
  });
  return true;
}
