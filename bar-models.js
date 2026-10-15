/* The MANUAL model suite's bars, kept only so the worksheets that carry them
   still draw, print and export (v1.141.0).

   The suite itself — the panel, the draw / cut / join / arrange tools and the
   ready-made templates (model-suite.js, model-templates.js) — was replaced by
   the model studio (model-studio.js, polymathlc/model's drawing board), whose
   models land on the page as pictures. Bars made before that are ordinary
   `rect` annotations with `modelBar: true`, a pastel `fill` and a
   `modelLabel`; they still move, resize, save, replay and print as they always
   did, through the three renderers below. Nothing here makes a new bar. */
var BM_PALETTE = ['#C8DDF2', '#CBE8D5', '#F8D6BB', '#DDD2F0', '#F5D0D8', '#F4E7AF'];
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
