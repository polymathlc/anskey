/* Loads the REAL line-style vocabulary out of anskey's index.html and runs it.
   Every one of these fails SILENTLY on the page: a dash pattern that comes
   back null draws a solid line and nothing anywhere says the teacher asked
   for dotted; heads read off the wrong end put the arrow the wrong way round
   in a diagram that still looks like a diagram; and a brace that samples to
   nothing is a bracket that simply is not on the sheet.

   It is pure geometry — no DOM — because the three renderers all read these
   functions and nothing else. Getting them right is what makes the screen,
   the flatten that goes to the AI, and the printed PDF agree. */
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var ANN_DASH_STYLES = {');
const end = html.indexOf('function annNode(a) {', start);
if (start < 0 || end < 0) { console.error('line-style section not found'); process.exit(1); }
const src = html.slice(start, end);

const mod = new Function(src + `
  return { ANN_DASH_STYLES, ANN_DASH_ORDER, ANN_HEAD_ORDER, annDashName, annDashPattern,
           annHeads, annHasHeadAtStart, annHasHeadAtEnd, arrowHeadPoints,
           braceDepth, bracePoints, dashPolyline,
           BRACE_DEPTH_MIN, BRACE_DEPTH_MAX };
`)();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.error('FAIL: ' + name + (extra === undefined ? '' : '  (' + extra + ')'));
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

/* ---------- the three styles ---------- */
ok('the three styles are solid, dashed, dotted',
  mod.ANN_DASH_ORDER.join(',') === 'solid,dashed,dotted', mod.ANN_DASH_ORDER.join(','));
ok('every style in the order really exists',
  mod.ANN_DASH_ORDER.every((k) => mod.ANN_DASH_STYLES[k]));

/* A missing or nonsense `dash` must read as solid rather than throwing or
   drawing something nobody asked for — every line already saved has none. */
ok('no dash reads as solid', mod.annDashName({}) === 'solid');
ok('an unknown dash reads as solid', mod.annDashName({ dash: 'wiggly' }) === 'solid');
ok('solid has NO pattern', mod.annDashPattern({ dash: 'solid', width: 3 }) === null);
ok('a line already saved has no pattern', mod.annDashPattern({ width: 3 }) === null);

/* THE PATTERN SCALES WITH THE PEN. A fixed pattern reads as dashed at 1px and
   as a solid line at 12px, which is the whole reason it is stored as a
   multiple of the stroke width rather than in page units. */
const d3 = mod.annDashPattern({ dash: 'dashed', width: 3 });
const d6 = mod.annDashPattern({ dash: 'dashed', width: 6 });
ok('dashed yields a pattern', Array.isArray(d3) && d3.length === 2, JSON.stringify(d3));
ok('a fatter pen gives longer dashes', d6[0] > d3[0] && d6[1] > d3[1], JSON.stringify([d3, d6]));
ok('doubling the pen doubles the pattern', near(d6[0], d3[0] * 2, 1e-6));
const dot = mod.annDashPattern({ dash: 'dotted', width: 3 });
ok('a dot is much shorter than its gap', dot[0] < dot[1] / 4, JSON.stringify(dot));
ok('a dot still has positive length', dot[0] > 0, JSON.stringify(dot));
ok('a hairline still gets a usable pattern',
  mod.annDashPattern({ dash: 'dashed', width: 0.5 }).every((n) => n > 0));

/* ---------- heads ---------- */
/* The TYPE is the fallback, and that is what lets every line and arrow
   already in the bank keep the shape it was drawn with. Break it and every
   arrow on every saved worksheet quietly loses its point. */
ok('an old arrow still has a head at the end', mod.annHeads({ type: 'arrow' }) === 'end');
ok('an old line still has none', mod.annHeads({ type: 'line' }) === 'none');
ok('an explicit setting beats the type',
  mod.annHeads({ type: 'line', heads: 'both' }) === 'both');
ok('an explicit none beats an arrow type',
  mod.annHeads({ type: 'arrow', heads: 'none' }) === 'none');
ok('nonsense falls back to the type', mod.annHeads({ type: 'arrow', heads: 'squiggle' }) === 'end');

ok('both means a head at each end',
  mod.annHasHeadAtStart({ heads: 'both' }) && mod.annHasHeadAtEnd({ heads: 'both' }));
ok('end means one head, and it is at the END',
  !mod.annHasHeadAtStart({ type: 'arrow' }) && mod.annHasHeadAtEnd({ type: 'arrow' }));
ok('none means neither',
  !mod.annHasHeadAtStart({ type: 'line' }) && !mod.annHasHeadAtEnd({ type: 'line' }));
ok('the picker offers none / end / both',
  mod.ANN_HEAD_ORDER.join(',') === 'none,end,both', mod.ANN_HEAD_ORDER.join(','));

/* THE BARBS MUST BE AT THE END THEY WERE ASKED FOR. Read the wrong way round
   the arrow points backwards, which in a labelled diagram is not a cosmetic
   fault — it is the opposite of what the teacher drew. */
const ln = { x1: 0, y1: 0, x2: 100, y2: 0, width: 2 };
const hEnd = mod.arrowHeadPoints(ln, false);
const hStart = mod.arrowHeadPoints(ln, true);
ok('the end barbs sit BEHIND x2', hEnd[0].x < 100 && hEnd[1].x < 100, JSON.stringify(hEnd));
ok('the end barbs straddle the line', Math.sign(hEnd[0].y) === -Math.sign(hEnd[1].y) && hEnd[0].y !== 0, JSON.stringify(hEnd));
ok('the start barbs sit AHEAD of x1', hStart[0].x > 0 && hStart[1].x > 0, JSON.stringify(hStart));
ok('the two ends are not the same points', hEnd[0].x !== hStart[0].x);
ok('a fatter pen gets bigger barbs',
  Math.abs(mod.arrowHeadPoints({ x1: 0, y1: 0, x2: 100, y2: 0, width: 8 }, false)[0].x - 100) >
  Math.abs(hEnd[0].x - 100));

/* ---------- the brace ---------- */
const br = { x1: 0, y1: 0, x2: 200, y2: 0, width: 3 };
const bp = mod.bracePoints(br);
ok('a brace samples to a real polyline', bp.length > 20, bp.length);
ok('a brace starts at the drag start', near(bp[0].x, 0) && near(bp[0].y, 0), JSON.stringify(bp[0]));
ok('a brace ends at the drag end',
  near(bp[bp.length - 1].x, 200, 0.01) && near(bp[bp.length - 1].y, 0, 0.01),
  JSON.stringify(bp[bp.length - 1]));
/* The tip is the deepest point and it belongs in the MIDDLE — a brace whose
   tip has wandered is not a bracket, it is a squiggle. */
let deepest = bp[0];
bp.forEach((q) => { if (Math.abs(q.y) > Math.abs(deepest.y)) deepest = q; });
ok('the tip is in the middle of the span', Math.abs(deepest.x - 100) < 12, JSON.stringify(deepest));
ok('the tip is as deep as braceDepth says',
  near(Math.abs(deepest.y), mod.braceDepth(br), 0.01),
  Math.abs(deepest.y) + ' vs ' + mod.braceDepth(br));
/* Everything is on ONE side. A brace that crosses its own baseline reads as
   a wave, and that is what a sign error in the perpendicular looks like. */
ok('a brace stays on one side of its baseline',
  bp.every((q) => q.y <= 0.01) || bp.every((q) => q.y >= -0.01));

/* Dragging the other way flips the bulge — that IS the control, so it has to
   really flip rather than draw the same shape twice. */
const flip = mod.bracePoints({ x1: 200, y1: 0, x2: 0, y2: 0, width: 3 });
let fDeep = flip[0];
flip.forEach((q) => { if (Math.abs(q.y) > Math.abs(fDeep.y)) fDeep = q; });
ok('dragging the other way bulges the other way',
  Math.sign(fDeep.y) === -Math.sign(deepest.y), deepest.y + ' vs ' + fDeep.y);

/* The depth is bounded at both ends: a tiny brace must still read as a
   bracket, and a brace across a whole page must not bulge off the sheet. */
ok('a tiny brace still has a visible bulge',
  mod.braceDepth({ x1: 0, y1: 0, x2: 20, y2: 0 }) >= mod.BRACE_DEPTH_MIN);
ok('a page-wide brace is capped',
  mod.braceDepth({ x1: 0, y1: 0, x2: 2000, y2: 0 }) <= mod.BRACE_DEPTH_MAX);
ok('a zero-length drag does not throw and yields something',
  mod.bracePoints({ x1: 5, y1: 5, x2: 5, y2: 5, width: 2 }).length >= 1);

/* A brace on a slope is drawn along the slope, not along the page. */
const diag = mod.bracePoints({ x1: 0, y1: 0, x2: 100, y2: 100, width: 3 });
ok('a diagonal brace ends where it was dragged to',
  near(diag[diag.length - 1].x, 100, 0.01) && near(diag[diag.length - 1].y, 100, 0.01));

/* ---------- dashPolyline: the PDF's own dashing ---------- */
/* pdf-lib has no dash the strokePath here uses, so the dashes are CUT. Every
   failure below prints a solid line on paper under a dotted line on screen. */
ok('no pattern hands the points straight back',
  mod.dashPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], null).length === 2);
const cut = mod.dashPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], [10, 10]);
ok('a dashed line really is cut into pieces',
  cut.filter((q) => q === null).length >= 4, JSON.stringify(cut.length));
ok('the cut starts where the line starts',
  cut[0] && near(cut[0].x, 0) && near(cut[0].y, 0), JSON.stringify(cut[0]));
ok('the cut never ENDS on a break marker',
  cut[cut.length - 1] !== null);
ok('the cut never STARTS on a break marker', cut[0] !== null);
/* Two consecutive nulls would make strokePath emit "M M" and lose a piece. */
ok('no two break markers in a row',
  !cut.some((q, i) => q === null && cut[i + 1] === null));
/* Every drawn piece must be shorter than the whole line, or the "dashes" are
   the line again with gaps nobody can see. */
let longest = 0, run = null;
cut.forEach((q) => {
  if (q === null) { run = null; return; }
  if (run) longest = Math.max(longest, Math.abs(q.x - run.x));
  else run = q;
});
ok('each dash is about the pattern length', longest > 0 && longest <= 10.01, longest);
ok('a single point is handed back untouched',
  mod.dashPolyline([{ x: 1, y: 2 }], [4, 4]).length === 1);
ok('a dotted pattern also cuts',
  mod.dashPolyline([{ x: 0, y: 0 }, { x: 40, y: 0 }], [0.3, 6]).some((q) => q === null));
/* The cut follows the polyline round its corners — this is what a brace is. */
const corner = mod.dashPolyline(
  [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], [5, 5]);
ok('a cut polyline stays on its own path',
  corner.filter(Boolean).every((q) => (near(q.y, 0) && q.x >= -0.01 && q.x <= 20.01) ||
                                      (near(q.x, 20) && q.y >= -0.01 && q.y <= 20.01)),
  JSON.stringify(corner.filter(Boolean).slice(0, 6)));

/* ---------- the page itself ---------- */
/* All three renderers have to read the same functions, or the screen, the
   flatten and the PDF disagree about a line the teacher drew once. */
ok('the SVG overlay dashes the shaft', /shaft\['stroke-dasharray'\]/.test(html));
ok('the canvas flatten dashes', /ctx\.setLineDash\(lpat/.test(html));
ok('the PDF cuts its own dashes', /dashPolyline\(shaft, annDashPattern\(a\)\)/.test(html));
ok('the SVG overlay draws braces', /a\.type === 'brace'/.test(html.slice(html.indexOf('function annNode'))));
ok('the canvas flatten draws braces', /bracePoints\(a\);\s*\n\s*var bpat/.test(html));
ok('the PDF draws braces', /dashPolyline\(bracePoints\(a\), annDashPattern\(a\)\)/.test(html));
/* The head is what says which way an arrow points, so it must never be
   dashed — a dotted arrowhead is two dots where the point should be. */
ok('the SVG overlay does not dash the heads',
  /if \(hd\) g\.appendChild\(el\('path', Object\.assign\(\{\}, dashAttrs, \{ d: hd\.trim\(\) \}\)\)\);/.test(html));
ok('the canvas flatten clears the dash before the barbs',
  /ctx\.stroke\(\);\s*\n\s*ctx\.setLineDash\(\[\]\);/.test(html));

/* The brace tool has to be reachable, remembered and drawable. */
ok('there is a brace tool button', /data-tool="brace"/.test(html));
ok('B picks the brace', /b: 'brace'/.test(html));
ok('the brace is a drawing tool', /t === 'brace'/.test(html));
ok('the brace remembers its own style', /brace:\s*\{ color: '#1A1A1A', width: 3, dash: 'solid' \}/.test(html));
/* A brace labels a span; it never points, so it must not carry heads. */
ok('the brace has no heads entry', !/brace:\s*\{[^}]*heads:/.test(html));

/* The two setters must restyle what is SELECTED, or a style you can only set
   before you draw is one you have to undo and redraw to change. */
ok('setLineDash restyles the selection', /function setLineDash\([\s\S]{0,700}?pushUndo\(\);/.test(html));
ok('setLineHeads restyles the selection', /function setLineHeads\([\s\S]{0,700}?pushUndo\(\);/.test(html));
/* Solid is the ABSENCE of the field, so every line already saved stays
   byte-for-byte what it was rather than growing a "solid" nobody typed. */
ok('setting solid deletes the field', /if \(d === 'solid'\) delete a\.dash;/.test(html));

/* The group is only about a line, an arrow or a brace, and it must follow the
   SELECTION as well as the tool — otherwise it says "dotted" over a solid
   line somebody has just clicked on. */
ok('the group is synced from renderAllOverlays',
  /renderAllOverlays\(\) \{[\s\S]{0,200}?syncLineStyleCtl\(\)/.test(html));
ok('the group reflects the selected annotation, not the pen',
  /var kind = a \? a\.type : tool;/.test(html));
ok('a student never gets the group', /var allowed = !isStudent\(\) \|\| practiceMode;/.test(html));
/* A dashed line is mostly gaps, so it needs something to be clicked ON. */
ok('a line has an invisible stroke to catch clicks',
  /stroke: 'transparent',\s*\n\s*'stroke-width': Math\.max\(14/.test(html));

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
