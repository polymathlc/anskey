// 🧙 The quest on the worksheet (v1.193.0): the pure parts of quest-stage.js.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const S = require('../quest-stage.js');
const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('settings default to off, labelled, unflipped and solid at the normal size', () => {
  const d = S.defaults();
  assert.deepEqual(d, { v: 1, on: false, x: null, y: null, k: 1, labels: true, flip: false, faint: false });
  assert.deepEqual(S.parseSettings(''), d);
  assert.deepEqual(S.parseSettings('not json'), d);
  assert.deepEqual(S.parseSettings('null'), d);
  assert.deepEqual(S.parseSettings(undefined), d);
});

test('saved settings are cleaned one field at a time', () => {
  const s = S.parseSettings(JSON.stringify({ on: true, x: 120.4, y: '80', k: 1.25, labels: false, flip: true, faint: true }));
  assert.deepEqual(s, { v: 1, on: true, x: 120, y: 80, k: 1.25, labels: false, flip: true, faint: true });
  // A bad scale falls back or is clamped; the rest survives.
  assert.equal(S.parseSettings(JSON.stringify({ on: true, k: 'huge' })).k, 1);
  assert.equal(S.parseSettings(JSON.stringify({ k: 99 })).k, S.K_MAX);
  assert.equal(S.parseSettings(JSON.stringify({ k: 0.01 })).k, S.K_MIN);
  assert.equal(S.parseSettings(JSON.stringify({ on: 'yes' })).on, false, 'only a real true turns it on');
  // Half a position is no position: the stage lands in its default corner.
  const half = S.parseSettings(JSON.stringify({ x: 40, y: 'nowhere' }));
  assert.equal(half.x, null); assert.equal(half.y, null);
});

test('a new stage lands in the lower right, inside the screen', () => {
  const b = S.defaultBox(1440, 900, 260);
  assert.equal(b.k, 1);
  assert.ok(b.x + S.BASE_W * b.k <= 1440 - 20);
  assert.ok(b.y + 260 * b.k <= 900 - 20);
  assert.ok(b.x > 1440 / 2, 'right half');
  assert.ok(b.y > 900 / 3, 'lower part');
  // A phone gets a smaller stage that still fits.
  const p = S.defaultBox(390, 700, 300);
  assert.ok(p.k < 1 && p.k >= S.K_MIN);
  assert.ok(p.x >= 0 && p.x + S.BASE_W * p.k <= 390);
});

test('clampBox keeps the whole stage on screen and shrinks it before it can overflow', () => {
  const vw = 1200, vh = 800, h = 300;
  for (const box of [{ x: -500, y: -500, k: 1 }, { x: 5000, y: 5000, k: 1 }, { x: 300, y: 200, k: 1.5 }]) {
    const c = S.clampBox(box, vw, vh, h);
    assert.ok(c.x >= 0 && c.y >= 0, JSON.stringify(c));
    assert.ok(c.x + S.BASE_W * c.k <= vw + 1, JSON.stringify(c));
    assert.ok(c.y + h * c.k <= vh + 1, JSON.stringify(c));
  }
  // An untouched box inside the screen is left exactly where it is.
  assert.deepEqual(S.clampBox({ x: 100, y: 120, k: 1.2 }, vw, vh, h), { x: 100, y: 120, k: 1.2 });
  // Too big for the screen: the scale comes down to fit.
  const big = S.clampBox({ x: 0, y: 0, k: 3 }, 800, 600, 300);
  assert.ok(big.k <= 2 + 1e-9);
  assert.ok(S.BASE_W * big.k <= 800 + 1 && 300 * big.k <= 600 + 1);
  // A screen smaller than even K_MIN still leaves a handle reachable.
  const tiny = S.clampBox({ x: 9999, y: 9999, k: 1 }, 100, 60, 400);
  assert.equal(tiny.k, S.K_MIN);
  assert.ok(tiny.x <= 100 - S.KEEP && tiny.y <= 60 - S.KEEP);
});

test('the corner drag follows the diagonal and keeps proportions', () => {
  const w = 460, h = 260;
  assert.equal(S.resizeK(1, w, h, 0, 0), 1);
  const right = S.resizeK(1, w, h, 92, 0), down = S.resizeK(1, w, h, 0, 52), diag = S.resizeK(1, w, h, 92, 52);
  assert.ok(right > 1 && down > 1, 'right and down both grow it');
  assert.ok(diag > right && diag > down, 'diagonal grows it most');
  assert.ok(Math.abs(diag - 1.2) < 0.001, 'dragging the corner by 20% of the diagonal gives 1.2×');
  assert.ok(S.resizeK(1, w, h, -92, -52) < 1, 'up-left shrinks it');
  assert.equal(S.resizeK(1, w, h, -99999, -99999), S.K_MIN);
  assert.equal(S.resizeK(1, w, h, 99999, 99999), S.K_MAX);
  assert.equal(S.resizeK(2, w * 2, h * 2, 0, 0), 2, 'starts from the current scale');
});

test('keys move, resize and reset; other keys are left alone', () => {
  const b = { x: 100, y: 100, k: 1 };
  assert.deepEqual(S.keyStep('ArrowLeft', false, b), { x: 90, y: 100, k: 1 });
  assert.deepEqual(S.keyStep('ArrowRight', true, b), { x: 140, y: 100, k: 1 });
  assert.deepEqual(S.keyStep('ArrowUp', false, b), { x: 100, y: 90, k: 1 });
  assert.deepEqual(S.keyStep('ArrowDown', false, b), { x: 100, y: 110, k: 1 });
  assert.equal(S.keyStep('+', false, b).k, 1.1);
  assert.equal(S.keyStep('=', false, b).k, 1.1);
  assert.equal(S.keyStep('-', false, b).k, 0.9);
  assert.equal(S.keyStep('0', false, { x: 0, y: 0, k: 2.4 }).k, 1);
  assert.equal(S.keyStep('a', false, b), null);
  assert.equal(S.keyStep('Enter', false, b), null);
  assert.deepEqual(b, { x: 100, y: 100, k: 1 }, 'the box passed in is not changed');
});

test('the stage holds the duel only when every condition is met', () => {
  const ok = { on: true, wheelOpen: true, quickOn: true, manual: false, hasDuel: true };
  assert.equal(S.shouldHold(ok), true);
  for (const key of ['on', 'wheelOpen', 'quickOn', 'hasDuel']) assert.equal(S.shouldHold({ ...ok, [key]: false }), false, key);
  assert.equal(S.shouldHold({ ...ok, manual: true }), false, 'the manual Battle arena keeps its own');
  assert.equal(S.shouldHold(null), false);
});

test('the page wires the stage in: button, files, close, and the compact window lets go', () => {
  const html = read('index.html');
  assert.match(html, /id="wheelStageBtn"[^>]*>🧙<\/button>/, 'the 🧙 button sits in the wheel title bar');
  assert.ok(html.indexOf('id="wheelStageBtn"') < html.indexOf('id="wheelMinBtn"'), 'before the minimise button');
  assert.match(html, /<link rel="stylesheet" href="quest-stage\.css\?v=1\.193\.0">/);
  assert.match(html, /<script src="quest-stage\.js\?v=1\.193\.0"><\/script>/);
  assert.ok(html.indexOf('quest-stage.js?v=') > html.indexOf('compact-wheel.js?v='), 'loads after the compact window');
  const close = html.slice(html.indexOf('function closeWheel()'), html.indexOf('function toggleWheel()'));
  assert.match(close, /QuestStage\.stop\(\)/, 'closing the wheel gives the duel back');
  const compact = read('compact-wheel.js');
  assert.match(compact, /function staged\(id\)/);
  assert.match(compact, /if\(staged\(id\)\)return;/, 'restore leaves a staged duel alone');
  assert.match(compact, /\|\|staged\(id\)\)return;/, 'move leaves a staged duel alone');
  assert.match(read('classroom-battle.js'), /QuestStage\.refresh\(\)/, 'the manual arena takes it back');
  assert.match(read('battle-animation.js'), /function stageScale\(node\)/, 'travelling effects divide by the stage scale');
});

test('the stage is unframed, printable-free and scaled as one picture', () => {
  const css = read('quest-stage.css');
  assert.match(css, /#questStage\s*\{[^}]*pointer-events:\s*none/, 'empty parts let presses through');
  assert.match(css, /#questStage\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /#questStage \.cbQuickDuel\s*\{[^}]*background:\s*transparent !important/);
  assert.match(css, /@media print\s*\{\s*#questStage\s*\{\s*display:\s*none !important/);
  assert.match(css, /transform-origin:\s*0 0/);
  // Inside the compact window, the note follows --cw-k like everything else there.
  const compactBlock = css.slice(css.indexOf('#wheelCard .cwBattle .qsNote {'), css.indexOf('/* The wheel\'s 🧙 button'));
  const bare = compactBlock.match(/:\s*\d+px/g);
  assert.equal(bare, null, 'no bare pixel lengths in the compact note');
  const js = read('quest-stage.js');
  assert.match(js, /inner\.style\.transform='scale\('/);
  assert.doesNotMatch(js, /annotations\.push|markDirty|pushUndo/, 'never an annotation');
});
