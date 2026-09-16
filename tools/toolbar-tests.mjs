// Execute the shipped toolbar markup and handlers with a small event/DOM
// harness. These checks cover actions and focus, not a device layout benchmark.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function cut(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return html.slice(a, b);
}
function simpleMatch(n, selector) {
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && n.tagName !== tag.toUpperCase()) return false;
  for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (n.id !== id) return false;
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!n.classList.contains(name)) return false;
  for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!n.hasAttribute(name) || (value !== undefined && n.getAttribute(name) !== value)) return false;
  }
  return true;
}
function matches(n, selector) {
  const parts = selector.trim().split(/\s+/);
  if (!simpleMatch(n, parts.pop())) return false;
  for (let i = parts.length - 1; i >= 0; i--) {
    n = n.parentElement;
    while (n && !simpleMatch(n, parts[i])) n = n.parentElement;
    if (!n) return false;
  }
  return true;
}
class Node {
  constructor(tag, attrs = {}, doc) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.ownerDocument = doc;
    this.children = []; this.listeners = {}; this.style = { setProperty(k, v) { this[k] = v; } }; this.textContent = '';
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = false; this.value = attrs.value || '';
    this.offsetWidth = 248; this.offsetHeight = 180;
    for (const part of (attrs.style || '').split(';')) {
      const [key, value] = part.split(':'); if (key && value) this.style[key.trim()] = value.trim();
    }
    this.classList = {
      contains: c => (this.attrs.class || '').split(/\s+/).includes(c),
      toggle: (c, on) => { const all = new Set((this.attrs.class || '').split(/\s+/).filter(Boolean)); if (on) all.add(c); else all.delete(c); this.attrs.class = [...all].join(' '); }
    };
  }
  get id() { return this.attrs.id || ''; }
  get innerHTML() { return ''; }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; }
  appendChild(n) { if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n); this.children.push(n); n.parentElement = this; return n; }
  insertBefore(n, before) {
    if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n);
    const i = this.children.indexOf(before); assert(i >= 0); this.children.splice(i, 0, n); n.parentElement = this; return n;
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelectorAll(selector) {
    const out = [];
    const visit = n => { for (const child of n.children) { if (selector.split(',').some(s => matches(child, s))) out.push(child); visit(child); } };
    visit(this); return out;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  closest(s) { for (let n = this; n; n = n.parentElement) if (matches(n, s)) return n; return null; }
  contains(target) { for (let n = target; n; n = n.parentElement) if (n === this) return true; return false; }
  cloneNode(deep) { const n = new Node(this.tagName, this.attrs, this.ownerDocument); if (deep) this.children.forEach(c => n.appendChild(c.cloneNode(true))); return n; }
  getBoundingClientRect() { return this.rect || { left: 260, right: 300, top: 140, bottom: 170 }; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, capture: options === true }); }
  dispatch(type, values = {}) {
    const e = { type, target: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    const path = []; for (let n = this; n; n = n.parentElement) path.push(n);
    for (const [nodes, capture] of [[path.slice().reverse(), true], [path, false]]) {
      for (const n of nodes) {
        for (const l of n.listeners[type] || []) if (l.capture === capture) l.fn(e);
        if (e.stopped) return e;
      }
    }
    return e;
  }
  click() { if (!this.disabled) return this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; this.focusValue = this.value; this.dispatch('focusin'); }
  blur() { if (this.tagName === 'INPUT' && this.value !== this.focusValue) this.dispatch('change'); this.ownerDocument.activeElement = this.ownerDocument; }
}

function parseToolbar() {
  const doc = new Node('document'); doc.ownerDocument = doc;
  const stack = [doc], ids = new Set();
  const markup = cut('<div id="toolbar">', '<div id="favBar"');
  const tokens = markup.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { const tag = token.match(/^<\/([\w]+)/)[1].toUpperCase(); assert.equal(stack.pop().tagName, tag); continue; }
    if (!token.startsWith('<')) { stack.at(-1).textContent += token; continue; }
    const tag = token.match(/^<([\w]+)/)[1];
    const attrs = {};
    for (const [, name, value] of token.slice(tag.length + 1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[name] = value ?? '';
    const n = new Node(tag, attrs, doc);
    if (n.id) { assert(!ids.has(n.id), 'Duplicate toolbar id: ' + n.id); ids.add(n.id); }
    stack.at(-1).appendChild(n);
    if (!token.endsWith('/>') && !['input', 'br', 'hr'].includes(tag)) stack.push(n);
  }
  assert.equal(stack.length, 1, 'Balanced toolbar markup');
  doc.getElementById = id => doc.querySelector('#' + id);
  doc.createElement = tag => new Node(tag, {}, doc);
  return doc;
}

function harness(saved = []) {
  const document = parseToolbar(), $ = id => document.getElementById(id), calls = { undo: 0, dirty: 0, start: 0, end: 0 };
  const window = new Node('window', {}, document); window.innerWidth = 320; window.innerHeight = 360;
  const stored = new Map(saved);
  const c = vm.createContext({ document, window, $, console, selectedId: null, annotations: [], tool: 'pen', color: '#1A1A1A', strokeW: 3, fontSize: 16,
    lineDash: 'solid', lineHeads: 'end', practiceMode: false, teacherAnswers: null, pdfDoc: null, admin: true, shared: false, currentUser: {}, actingStudent: null,
    localStorage: { getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v) },
    ANN_DASH_STYLES: { solid: true, dashed: true, dotted: true }, ANN_HEAD_ORDER: ['none', 'end', 'both'],
    annDashName: a => a.dash || 'solid', annHeads: a => a.heads || (a.type === 'arrow' ? 'end' : 'none'),
    isStudent: () => !c.admin || !!c.actingStudent, isSharedVisitor: () => c.shared, isAdmin: () => c.admin,
    pushUndo: () => calls.undo++, setDirty: () => calls.dirty++, scheduleOverlays() {}, renderAllOverlays() {},
    commitActiveTextEdit() {}, clearLassoSel() {}, updateToolCursor() {},
    startPractice() { calls.start++; }, endPractice() { calls.end++; }
  });
  vm.runInContext(cut('var STYLE_KEY =', 'var selectedId ='), c);
  vm.runInContext(cut('function setTool(t)', 'function updateToolCursor()'), c);
  vm.runInContext(cut('/* ================= Toolbar dropdowns ================= */', '/* ================= End toolbar dropdowns ================= */'), c);
  vm.runInContext(cut("document.querySelectorAll('#toolButtons .toolBtn[data-tool]').forEach(function (b) {\n  b.addEventListener", 'var fontUndoPushed ='), c);
  vm.runInContext(cut('function applyNotesVisibility()', 'function openNotesModal()'), c);
  vm.runInContext(cut('function favCandidates()', 'function renderFavBar()'), c);
  c.initToolbarMenus();
  return { c, document, window, $, calls, stored };
}

test('related controls live in labelled dropdowns with their original action identities', () => {
  const { document, $ } = harness();
  for (const kind of ['line', 'arrow', 'brace', 'rect', 'ellipse']) assert(document.querySelector('#shapeMenu [data-tool="' + kind + '"]'));
  for (const id of ['printQBtn', 'printABtn', 'downloadBtn', 'keyPdfBtn']) assert($('printMenu').contains($(id)));
  for (const id of ['notesBtn', 'quickNoteBtn', 'mmBtn', 'practiceMenuBtn']) assert($('lessonMenu').contains($(id)));
  assert.equal(document.querySelectorAll('#colorMenu button.colorChip').length, 5);
  assert.equal($('strokeVal').getAttribute('type'), 'number');
  assert.equal($('strokeRange').getAttribute('step'), 'any');
});

test('Tools starts compact and expands the same working controls, preserving saved layout', () => {
  const { c, document, $, stored } = harness();
  const lasso = document.querySelector('[data-tool="lasso"]');
  assert($('selectionMenu').contains(lasso)); assert($('expandedTools').hidden);
  $('selectionMenuBtn').click(); lasso.click();
  assert.equal(c.tool, 'lasso'); assert($('selectionMenu').hidden);
  assert.equal($('selectionMenuBtn').getAttribute('aria-label'), 'Tools: Lasso');
  $('selectionMenuBtn').click(); $('expandToolsBtn').click();
  assert($('expandedTools').contains(lasso)); assert(!$('expandedTools').hidden);
  assert.equal(stored.get('annotToolsExpanded'), 'true');
  assert.equal(document.querySelectorAll('[data-tool="lasso"]').length, 1);
  assert.equal(c.favSourceEl('tool:lasso'), lasso); lasso.click(); assert.equal(c.tool, 'lasso');
  $('selectionMenuBtn').click(); $('expandToolsBtn').click();
  assert($('selectionMenu').contains(lasso)); assert($('expandedTools').hidden);
  assert.equal(stored.get('annotToolsExpanded'), 'false');
  assert.equal(document.activeElement, $('selectionMenuBtn'));
  assert(!c.favCandidates().some(x => x.key === 'id:expandToolsBtn'));
  const restored = harness([['annotToolsExpanded', 'true']]);
  assert(!restored.$('expandedTools').hidden);
});

test('frequent pencil, text and keyword controls keep distinct visual accents', () => {
  const { document } = harness();
  for (const [tool, accent] of [['pen','popularPen'], ['text','popularText'], ['keyword','popularKeyword']]) {
    const button = document.querySelector('[data-tool="' + tool + '"]');
    assert(button.classList.contains('popularTool')); assert(button.classList.contains(accent));
    assert(button.getAttribute('aria-label'));
  }
});

test('Day offers full day names and All days; choices close the menu and preserve filtering', () => {
  const { c, document, $ } = harness();
  c.qDayFilter = 'all'; c.DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  c.dayColour = () => ({ ink: '#123', tint: '#eee', line: '#ddd' });
  c.renderDayFilterBar = () => {}; c.toggleQuestionsDrawer = () => { c.opened = true; };
  const drawer = document.appendChild(new Node('div', {id:'qDrawer'}, document));
  vm.runInContext(cut('var DAY_DOT_DAYS =', "/* The banner in the drawer's head"), c);
  c.renderDayDots();
  const days = $('dayDots').children;
  assert.deepEqual(days.map(b => b.textContent), ['All days','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']);
  $('dayMenuBtn').click(); days[2].click();
  assert.equal(c.qDayFilter, 'Tuesday'); assert(c.opened); assert($('dayMenu').hidden);
  assert.equal($('dayMenuBtn').getAttribute('aria-label'), 'Day: Tuesday');
  $('dayMenuBtn').click(); $('dayDots').children[0].click();
  assert.equal(c.qDayFilter, 'all'); assert($('dayMenu').hidden);
});

test('shape choice selects its real tool; dash controls never select an empty tool', () => {
  const { c, document, $ } = harness();
  $('shapeMenuBtn').click(); document.querySelector('#shapeMenu [data-tool="arrow"]').click();
  assert.equal(c.tool, 'arrow'); assert.equal($('shapeMenu').hidden, true);
  assert.equal($('shapeMenuLabel').textContent, 'Arrow');
  $('shapeMenuBtn').click(); document.querySelector('[data-dash="dashed"]').click();
  assert.equal(c.tool, 'arrow'); assert.equal(c.lineDash, 'dashed'); assert.equal($('shapeMenu').hidden, false);
});

test('exact widths preserve decimals, edit selected ink once and survive tool switching', () => {
  const { c, $, calls, stored } = harness();
  c.annotations = [{ id: 'ink', type: 'pen', width: 3 }]; c.selectedId = 'ink';
  $('strokeVal').value = '3.25'; $('strokeVal').dispatch('change');
  assert.equal(c.annotations[0].width, 3.25); assert.equal(calls.undo, 1);
  assert.equal(Number($('strokeRange').value), 3.25);
  $('strokeVal').dispatch('change'); assert.equal(calls.undo, 1);
  c.setTool('arrow'); c.setTool('pen');
  assert.equal(c.strokeW, 3.25); assert.equal($('strokeVal').value, '3.25');
  assert.equal(JSON.parse(stored.get('annotToolStyles')).pen.width, 3.25);
});

test('slider drags remain one undo step and invalid exact input cannot damage ink', () => {
  const { c, $, calls } = harness();
  c.annotations = [{ id: 'ink', type: 'line', width: 3 }]; c.selectedId = 'ink';
  for (const n of ['4', '4.75', '5.5']) { $('strokeRange').value = n; $('strokeRange').dispatch('input'); }
  $('strokeRange').dispatch('change'); assert.equal(calls.undo, 1);
  for (const bad of ['', 'Infinity', '3px']) { $('strokeVal').value = bad; $('strokeVal').dispatch('change'); assert.equal(c.strokeW, 5.5); }
  $('strokeVal').value = '100'; $('strokeVal').dispatch('change'); assert.equal(c.strokeW, 24);
  $('strokeVal').value = '0.1'; $('strokeVal').dispatch('change'); assert.equal(c.strokeW, 0.5);
});

test('Enter commits an exact value and Escape cancels an unfinished edit', () => {
  const { c, $ } = harness();
  const input = $('strokeVal'); input.focus(); input.value = '2.75'; input.dispatch('keydown', { key: 'Enter' });
  assert.equal(c.strokeW, 2.75);
  input.focus(); input.value = '19'; const escape = input.dispatch('keydown', { key: 'Escape' });
  assert.equal(c.strokeW, 2.75); assert.equal(input.value, '2.75'); assert(escape.stopped);
});

test('keyboard navigation skips hidden controls and Escape restores trigger focus', () => {
  const { document, $ } = harness(); let appEscape = 0;
  document.addEventListener('keydown', () => appEscape++);
  $('shapeMenuBtn').dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement.getAttribute('data-tool'), 'line');
  document.activeElement.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement.getAttribute('data-tool'), 'ellipse'); // hidden line settings skipped
  document.activeElement.dispatch('keydown', { key: 'Escape' });
  assert.equal(document.activeElement, $('shapeMenuBtn')); assert.equal(appEscape, 0);
  assert.equal($('shapeMenuBtn').getAttribute('aria-expanded'), 'false');
});

test('outside pen events close the dropdown without cancelling the worksheet event', () => {
  const { c, document, $ } = harness(); const page = document.appendChild(new Node('canvas', {}, document));
  let received = 0; page.addEventListener('pointerdown', () => received++);
  $('colorMenuBtn').click(); const event = page.dispatch('pointerdown', { pointerType: 'pen' });
  assert.equal(c.openToolbarMenu, null); assert.equal(received, 1); assert.equal(event.defaultPrevented, false);
});

test('an action can focus its modal after the menu closes', () => {
  const { document, $ } = harness(); const dialogInput = document.appendChild(new Node('input', {}, document));
  $('notesBtn').style.display = '';
  $('notesBtn').addEventListener('click', () => dialogInput.focus());
  $('lessonMenuBtn').click(); $('notesBtn').click();
  assert.equal(document.activeElement, dialogInput); assert.equal($('lessonMenu').hidden, true);
});

test('moved favourites still reach the real action while closed menus stay closed', () => {
  const { c, $ } = harness();
  assert(c.favCandidates().some(x => x.key === 'tool:arrow'));
  assert(!c.favCandidates().some(x => x.key === 'id:shapeMenuBtn'));
  c.favSourceEl('tool:arrow').click(); assert.equal(c.tool, 'arrow'); assert.equal($('shapeMenu').hidden, true);
  assert.equal(c.favSourceEl('id:printQBtn'), $('printQBtn'));
});

test('teacher-only notes remain hidden and practice reuses start/end with readiness checks', () => {
  const { c, $, calls } = harness();
  c.applyNotesVisibility(); assert.equal($('notesBtn').style.display, '');
  c.actingStudent = {}; c.applyNotesVisibility();
  assert(!c.toolbarMenuOptions($('lessonMenu')).includes($('notesBtn')));
  assert(!c.toolbarMenuOptions($('lessonMenu')).includes($('quickNoteBtn')));
  $('practiceMenuBtn').click(); assert.equal(calls.start, 0);
  c.pdfDoc = {}; c.annotations = [{}]; c.syncToolbarMenuState(); $('practiceMenuBtn').click(); assert.equal(calls.start, 1);
  c.practiceMode = true; c.teacherAnswers = [{}]; c.syncToolbarMenuState(); $('practiceMenuBtn').click();
  assert.equal(calls.end, 1); assert.equal($('practiceMenuLabel').textContent, 'End practice');
});

test('dropdown placement stays within a narrow viewport', () => {
  const { $, window } = harness(); window.innerHeight = 220;
  $('printMenuBtn').click();
  assert.equal($('printMenu').style.left, '64px');
  assert(Number.parseFloat($('printMenu').style.top) >= 8);
  assert(Number.parseFloat($('printMenu').style.top) + $('printMenu').offsetHeight <= window.innerHeight - 8);
});
