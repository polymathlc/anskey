/* Manual Singapore maths templates. These are deterministic annotation
   layouts: a quantity stays unknown until the author supplies its value. */
function bmTemplateCount(value, name, min, max) {
  var n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' must be a whole number from ' + min + ' to ' + max + '.');
  return n;
}
function bmTemplateText(value, fallback) {
  var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length > 40) throw new Error('Keep template names and quantities to 40 characters.');
  return text || fallback;
}
function bmTemplateField(id, fallback) {
  var input = document.getElementById(id);
  return input ? input.value : fallback;
}
function bmTemplateNamedTotal(name, total) {
  var label = bmTemplateText(name, '') + ': ' + bmTemplateText(total, '?');
  if (label.length > 80) throw new Error('Keep a row name and quantity together to 80 characters.');
  return label;
}
function bmTemplateFitLabel(a, left, modelWidth) {
  if (!bmMeasureContext) bmMeasureContext = document.createElement('canvas').getContext('2d');
  bmMeasureContext.font = '14px Arial';
  var textWidth = bmMeasureContext.measureText(a.text).width;
  var boxWidth = Math.min(modelWidth, Math.max(a.w, textWidth + 12));
  var font = Math.min(14, 14 * Math.max(1, boxWidth - 12) / Math.max(1, textWidth));
  if (font < 8) throw new Error('Increase the model width or shorten its row names and quantities so the labels stay readable.');
  a.x = Math.max(left, Math.min(left + modelWidth - boxWidth, a.x + a.w / 2 - boxWidth / 2));
  a.w = boxWidth; a.fontSize = font; a.fontFamily = 'arial';
}

/* All coordinates are relative to a single model origin. Keeping this
   geometry separate makes ratios and page-fit decisions inspectable. */
function bmManualTemplateSpec(kind, options) {
  var w = Number(options.w), h = Number(options.h), top = 76, gap = 88;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 12 || h < 12 || w > 2000 || h > 500) throw new Error('Choose a width of 12–2000 and a height of 12–500 points.');
  var spec = { w: w, h: top + h, bars: [], brackets: [], texts: [] };
  function row(count, denominator, y, label, fill, pieceLabel, space) {
    var unit = (w - (denominator - 1) * (space || 0)) / denominator;
    if (unit < 12) throw new Error('Increase the width to give every unit at least 12 points.');
    for (var i = 0; i < count; i++) spec.bars.push({ x: i * (unit + (space || 0)), y: y, w: unit, h: h, label: pieceLabel(i), fill: fill(i) });
    var span = count * unit + (count - 1) * (space || 0);
    spec.brackets.push({ x: 0, y: y - 8, w: span, label: label, below: false });
  }
  var first = options.fill || BM_PALETTE[0];
  var second = BM_PALETTE.find(function (colour) { return colour !== first; }) || BM_PALETTE[1];
  if (kind === 'ratio' || kind === 'beforeafter') {
    var a = bmTemplateCount(options.a, kind === 'ratio' ? 'First ratio' : 'Before units', 1, 12);
    var b = bmTemplateCount(options.b, kind === 'ratio' ? 'Second ratio' : 'After units', 1, 12);
    var units = Math.max(a, b), y2 = top + h + gap;
    row(a, units, top, bmTemplateNamedTotal(bmTemplateText(options.nameA, kind === 'ratio' ? 'A' : 'Before'), options.totalA), function () { return first; }, function () { return '?'; });
    row(b, units, y2, bmTemplateNamedTotal(bmTemplateText(options.nameB, kind === 'ratio' ? 'B' : 'After'), options.totalB), function () { return second; }, function () { return '?'; });
    spec.h = y2 + h;
  } else if (kind === 'equalgroups') {
    var groups = bmTemplateCount(options.count, 'Number of groups', 1, 12);
    var quantity = bmTemplateText(options.quantity, '?');
    row(groups, groups, top, bmTemplateText(options.total, '?'), function () { return first; }, function () { return quantity; }, 8);
  } else if (kind === 'fraction') {
    var denominator = bmTemplateCount(options.denominator, 'Denominator', 2, 20);
    var numerator = bmTemplateCount(options.numerator, 'Numerator', 0, denominator);
    row(denominator, denominator, top, '1 whole', function (i) { return i < numerator ? first : '#F3F4F6'; }, function () { return '1/' + denominator; });
    if (numerator) spec.brackets.push({ x: 0, y: top + h + 8, w: w * numerator / denominator, label: numerator + '/' + denominator, below: true });
    else spec.texts.push({ x: 0, y: top + h + 18, w: w, h: 25, label: '0/' + denominator + ' shaded' });
    spec.h += 76;
  } else {
    throw new Error('Choose a model template.');
  }
  return spec;
}
function bmManualTemplate(kind) {
  var dims = bmDimensions();
  var options = { w: dims.w, h: dims.h, fill: bmFill };
  if (kind === 'ratio' || kind === 'beforeafter') {
    options.a = bmTemplateField(kind === 'ratio' ? 'bmRatioTemplateA' : 'bmBeforeParts', kind === 'ratio' ? 2 : 3);
    options.b = bmTemplateField(kind === 'ratio' ? 'bmRatioTemplateB' : 'bmAfterParts', kind === 'ratio' ? 3 : 5);
    options.nameA = bmTemplateField('bmRowNameA', '') || (kind === 'ratio' ? 'A' : 'Before');
    options.nameB = bmTemplateField('bmRowNameB', '') || (kind === 'ratio' ? 'B' : 'After');
    options.totalA = bmTemplateField('bmRowTotalA', '?');
    options.totalB = bmTemplateField('bmRowTotalB', '?');
  } else if (kind === 'equalgroups') {
    options.count = bmTemplateField('bmGroupCount', 3);
    options.quantity = bmTemplateField('bmGroupQuantity', '?');
    options.total = bmValue('bmLabel');
  } else if (kind === 'fraction') {
    options.denominator = bmValue('bmParts');
    options.numerator = bmTemplateField('bmNumerator', 1);
  }
  var spec = bmManualTemplateSpec(kind, options), at = bmAnchor(spec.w, spec.h);
  var additions = spec.bars.map(function (b) { return bmNewBar(at.page, at.x + b.x, at.y + b.y, b.w, b.h, b.label, b.fill); });
  spec.brackets.forEach(function (b) {
    var bracket = bmBracket(at.page, at.x + b.x, at.y + b.y, b.w, b.label, b.below);
    bmTemplateFitLabel(bracket[1], at.x, spec.w);
    additions = additions.concat(bracket);
  });
  spec.texts.forEach(function (t) {
    var text = { id: newAnnId(), page: at.page, type: 'text', modelObject: true, x: at.x + t.x, y: at.y + t.y, w: t.w, h: t.h,
      text: t.label, fontSize: 14, color: '#26384C', align: 'center', kw: [], ts: Date.now() };
    bmTemplateFitLabel(text, at.x, spec.w);
    additions.push(text);
  });
  var group = 'model-' + newAnnId();
  additions.forEach(function (a) { a.grp = group; });
  setTool('select'); bmCommit([], additions, true);
}
