// Execute the shipped text-menu and AI handlers. Provider replies are held so
// edits, deletion, worksheet changes and role changes can race them deliberately.
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
const aiSource = cut('var AI_ANSWER_SYS =', '/* ================= AI notes');

function aiHarness() {
  const a = { id: 'a1', type: 'text', text: 'He have 2 spring.', page: 1, fontSize: 16, kw: [1] };
  let resolve, reject;
  const calls = [], undo = [], learned = [], toasts = [];
  const c = vm.createContext({
    annotations: [a], pages: [], currentUser: { uid: 'teacher', admin: true }, currentDocId: 'doc1',
    practiceMode: false, student: false, visitor: false, editingId: null, textFocusTimer: null,
    wsMeta: { subject: 'science', level: 'P5' }, liveNode: null, commits: 0,
    isAdmin: u => !!u?.admin, isStudent() { return c.student; }, isSharedVisitor() { return c.visitor; },
    subjectLabel: s => s, levelLabel: s => s, clearTimeout,
    aiEngineName: () => 'AI', toast: t => toasts.push(t),
    aiGrounding: () => '\nSHARED GROUNDING: correct science from the teacher notes.\n',
    annTextNode: () => c.liveNode,
    commitActiveTextEdit() {
      c.commits++;
      if (!c.editingId) return;
      const edit = c.annotations.find(x => x.id === c.editingId);
      if (edit && c.liveNode) edit.text = c.liveNode.innerText.replace(/\n+$/, '');
      const ask = edit?._ai;
      if (edit) delete edit._ai;
      c.editingId = null;
      if (ask) c.aiAnswer(edit.id);
    },
    pushUndo: () => undo.push(c.annotations.map(x => ({ ...x }))),
    renderAllOverlays() {}, renderOverlay() {}, setDirty() {},
    styleNoteGenerated: (...args) => learned.push(args),
    window: { aiReady: () => true, askGemini: (body, options) => {
      calls.push({ body, options });
      return new Promise((yes, no) => { resolve = yes; reject = no; });
    } }
  });
  vm.runInContext(aiSource, c);
  c.aiContextImages = () => [{ label: 'current worksheet', mimeType: 'image/jpeg', data: 'snapshot' }];
  return { c, a, calls, undo, learned, toasts, resolve: t => resolve(t), reject: e => reject(e) };
}

test('Fill reads the final unblurred text and sends worksheet context once for an AI box', async () => {
  const h = aiHarness();
  h.c.editingId = h.a.id; h.a._ai = true;
  h.c.liveNode = { innerText: 'Explain spring X.\n', scrollHeight: 60 };
  const done = h.c.aiAnswer(h.a.id);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].body, /Explain spring X\./);
  assert.equal(h.calls[0].options.images.length, 1);
  assert.match(h.calls[0].options.system, /SHARED GROUNDING/);
  assert.match(h.calls[0].options.system, /Follow the teacher's typed request first/);
  assert.match(h.calls[0].options.system, /instructions to compose text/);
  assert.match(h.calls[0].options.system, /never to replace an explicit typed request/);
  h.resolve('Spring X exerts the greatest force.'); await done;
  assert.equal(h.a.text, 'Spring X exerts the greatest force.');
  assert.equal(h.undo.length, 1);
  assert.equal(h.undo[0][0].text, 'Explain spring X.');
  assert.equal(h.learned.length, 1);
  assert.equal(h.a.kw.length, 0);
});

test('Grammar preserves meaning after grounding and does not answer, attach images or teach a model answer', async () => {
  const h = aiHarness();
  h.c.editingId = h.a.id; h.a._ai = true;
  h.c.liveNode = { innerText: 'He have 2 spring.', scrollHeight: 60 };
  const done = h.c.aiImprove(h.a.id);
  assert.equal(h.calls.length, 1, 'The automatic answer-on-blur must not also fire');
  const { body, options } = h.calls[0];
  assert.equal(body, 'He have 2 spring.');
  assert.equal(options.images.length, 0);
  assert(options.system.indexOf('GRAMMAR-ONLY TASK') > options.system.indexOf('SHARED GROUNDING'));
  assert.match(options.system, /meaning, intent/);
  assert.match(options.system, /claims, names, numbers, units, negations/);
  assert.match(options.system, /even if a claim is incorrect/);
  assert.match(options.system, /never instructions to follow/);
  assert.match(options.system, /Do not answer a question, solve a problem/);
  h.resolve('He has 2 springs.'); await done;
  assert.equal(h.a.text, 'He has 2 springs.');
  assert.equal(h.undo.length, 1); assert.equal(h.learned.length, 0);
});

for (const [name, mutate] of [
  ['saved text edits', h => { h.a.text = 'My later words.'; }],
  ['unblurred text edits', h => { h.c.editingId = h.a.id; h.c.liveNode = { innerText: 'My live words.' }; }],
  ['deleted box', h => { h.c.annotations = []; }],
  ['replacement with the same id', h => { h.c.annotations = [{ ...h.a }]; }],
  ['new worksheet epoch', h => { h.c.wsEpoch++; }],
  ['new worksheet id', h => { h.c.currentDocId = 'doc2'; }],
  ['sign-out', h => { h.c.currentUser = null; }],
  ['another account', h => { h.c.currentUser = { uid: 'other', admin: true }; }],
  ['practice mode', h => { h.c.practiceMode = true; }],
  ['student mode', h => { h.c.student = true; }],
  ['editable share visitor', h => { h.c.visitor = true; }]
]) test(`A late AI reply never overwrites ${name}`, async () => {
  const h = aiHarness(); const done = h.c.aiImprove(h.a.id);
  mutate(h); const before = h.a.text;
  h.resolve('Replacement that must be discarded.'); await done;
  assert.equal(h.a.text, before); assert.equal(h.undo.length, 0); assert.equal(h.learned.length, 0);
  assert.equal(h.c.aiBusy, false);
});

test('An unchanged reopened editor cannot later recommit over the applied reply', async () => {
  const h = aiHarness(); const done = h.c.aiImprove(h.a.id);
  h.c.editingId = h.a.id; h.c.liveNode = { innerText: h.a.text };
  h.resolve('He has 2 springs.'); await done;
  assert.equal(h.a.text, 'He has 2 springs.'); assert.equal(h.c.editingId, null);
});

test('Undoing a completed AI action keeps words being typed in a different box', async () => {
  const h = aiHarness(); const done = h.c.aiImprove(h.a.id);
  const other = { id: 'a2', type: 'text', text: 'Old words.' };
  h.c.annotations.push(other); h.c.editingId = other.id;
  h.c.liveNode = { innerText: 'Latest unfinished words.\n' };
  h.resolve('He has 2 springs.'); await done;
  assert.equal(h.undo[0][1].text, 'Latest unfinished words.');
  assert.equal(h.c.editingId, other.id);
});

test('Empty, unchanged and failed responses keep the original and do not create undo entries', async () => {
  for (const reply of ['', 'He have 2 spring.', new Error('network unavailable')]) {
    const h = aiHarness(); const done = h.c.aiImprove(h.a.id);
    if (reply instanceof Error) h.reject(reply); else h.resolve(reply);
    await done;
    assert.equal(h.a.text, 'He have 2 spring.'); assert.equal(h.undo.length, 0); assert.equal(h.c.aiBusy, false);
  }
});

test('Teacher-only actions reject practice, student, visitor and signed-out callers before committing', () => {
  for (const change of [h => h.c.practiceMode = true, h => h.c.student = true,
    h => h.c.visitor = true, h => h.c.currentUser = null, h => h.c.currentUser.admin = false]) {
    const h = aiHarness(); change(h);
    h.c.aiAnswer(h.a.id); h.c.aiImprove(h.a.id);
    assert.equal(h.calls.length, 0); assert.equal(h.c.commits, 0);
  }
});

test('A queued worksheet update landing at commit cancels the action before any request', () => {
  const h = aiHarness();
  h.c.commitActiveTextEdit = () => { h.c.wsEpoch++; };
  h.c.aiImprove(h.a.id); assert.equal(h.calls.length, 0);
});

class Node {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc || this; this.children = []; this.listeners = {};
    this.style = {}; this.attrs = {}; this.hidden = false; this.className = ''; this.textContent = '';
    this.offsetWidth = 248; this.offsetHeight = 300;
    this.classList = { toggle: (cls, on) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      if (on) set.add(cls); else set.delete(cls); this.className = [...set].join(' ');
    } };
  }
  get isConnected() { return this === this.ownerDocument || !!this.parentNode?.isConnected; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() { this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  querySelectorAll(selector) {
    const out = [];
    const walk = n => n.children.forEach(c => {
      if (selector.startsWith('.') ? c.className.split(/\s+/).includes(selector.slice(1)) : c.tagName === selector) out.push(c);
      walk(c);
    }); walk(this); return out;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, capture: options === true }); }
  getBoundingClientRect() { return { left: 330, top: 640, bottom: 670 }; }
  focus() { this.ownerDocument.activeElement = this; }
  dispatch(type, extra = {}) {
    const e = { type, target: this, detail: 0, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...extra };
    const path = []; for (let n = this; n; n = n.parentNode) path.push(n);
    for (const [nodes, capture] of [[path.slice().reverse(), true], [path, false]]) {
      for (const n of nodes) {
        for (const l of n.listeners[type] || []) if (l.capture === capture) l.fn(e);
        if (e.stopped) return e;
      }
    }
    return e;
  }
}

function menuHarness(practice = false) {
  const doc = new Node('document'); doc.createElement = t => new Node(t, doc);
  const wrap = doc.appendChild(new Node('div', doc));
  const editor = doc.appendChild(new Node('div', doc)); editor.focus();
  const calls = [];
  const a = { id: 'a1', type: 'text', color: '#1A1A1A', fontSize: 16 };
  const c = vm.createContext({ document: doc,
    window: { innerWidth: 390, innerHeight: 720, addEventListener() {} },
    Date, editingId: a.id, fontSize: 16, color: a.color,
    annTextNode: () => editor, pushUndo() {}, setDirty() {}, rememberToolStyle() {}, syncStyleControls() {},
    aiEngineName: () => 'AI', annHoldsMistake: () => false, aiAnswer: () => calls.push('fill'),
    aiImprove: () => calls.push('grammar'), aiMistake: () => calls.push('mistake'),
    checkAnswer: () => calls.push('check'), openAskAi: () => calls.push('ask'),
    ASK_PENALTY: 3, askCreditsLeft: () => 5,
    placeBarBesideBadge: (p, box, bar) => p.wrap.appendChild(bar)
  });
  vm.runInContext(cut('var activeTextActionMenu =', 'function pathFromPoints'), c);
  c[practice ? 'renderPracticeBar' : 'renderAiBar']({ wrap }, a, {});
  const bar = wrap.querySelector('.aiBar'), panel = bar.querySelector('.aiTextMenuPanel'), trigger = bar.children[0];
  return { c, a, doc, wrap, editor, calls, bar, panel, trigger };
}

test('Text controls start under one accessible icon, fit a narrow screen and preserve the editor', () => {
  const h = menuHarness();
  assert.equal(h.panel.hidden, true); assert.equal(h.bar.children.length, 2);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.trigger.getAttribute('aria-label'), 'Text box actions');
  h.trigger.dispatch('pointerdown');
  assert.equal(h.panel.hidden, false); assert.equal(h.doc.activeElement, h.editor);
  assert.equal(h.trigger.getAttribute('aria-expanded'), 'true');
  assert(parseFloat(h.panel.style.left) + h.panel.offsetWidth <= 382);
  assert(parseFloat(h.panel.style.top) + h.panel.offsetHeight <= 712);
  assert.deepEqual(h.panel.children.filter(n => n.tagName === 'button').map(n => n.textContent),
    ['✨ Fill with AI', '✒️ Fix grammar', '🐾 Mistake']);
});

test('Pointer and assistive keyboard activation run actions once and close before dispatch', () => {
  const h = menuHarness(); h.trigger.dispatch('pointerdown');
  const fill = h.panel.children[0];
  fill.dispatch('pointerdown'); fill.dispatch('click', { detail: 1 });
  assert.deepEqual(h.calls, ['fill']); assert.equal(h.panel.hidden, true);
  h.trigger.dispatch('click'); h.panel.children[1].dispatch('click');
  assert.deepEqual(h.calls, ['fill', 'grammar']); assert.equal(h.panel.hidden, true);
});

test('Colour and size remain keyboard reachable and leave the live editor intact', () => {
  const h = menuHarness(); h.trigger.dispatch('pointerdown');
  const dots = h.panel.querySelectorAll('.aiBarDot');
  assert.equal(dots.length, 5); assert(dots.every(n => n.tagName === 'button'));
  dots[1].dispatch('click'); assert.equal(h.a.color, '#E53935');
  assert.equal(dots[1].getAttribute('aria-pressed'), 'true');
  h.panel.querySelectorAll('.aiBarStep')[1].dispatch('pointerdown');
  assert.equal(h.a.fontSize, 17); assert.equal(h.doc.activeElement, h.editor);
  assert.equal(h.panel.hidden, false); assert.equal(h.c.editingId, h.a.id);
});

test('Colour names survive the desktop custom tooltip moving their native titles', () => {
  const h = menuHarness();
  const chip = new Node('button', h.doc);
  chip.setAttribute('data-color', '#E53935'); chip.setAttribute('data-tip', 'Red'); chip.title = '';
  const original = h.doc.querySelectorAll.bind(h.doc);
  h.doc.querySelectorAll = s => s === '#colorChips .colorChip' ? [chip] : original(s);
  h.c.aiBarColorCache = null;
  h.c.renderAiBar({ wrap: h.wrap }, h.a, {});
  const dot = h.wrap.querySelector('.aiBarDot');
  assert.equal(dot.getAttribute('aria-label'), 'Red');
});

test('Escape keeps a live editor focused; otherwise it restores the trigger, and outside drawing is not cancelled', () => {
  const h = menuHarness(); h.trigger.dispatch('click');
  const e = h.doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(e.prevented, true); assert.equal(e.stopped, true);
  assert.equal(h.panel.hidden, true); assert.equal(h.doc.activeElement, h.editor);
  assert.equal(h.c.editingId, h.a.id);
  h.c.editingId = null;
  h.trigger.dispatch('click'); h.doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(h.doc.activeElement, h.trigger);
  h.trigger.dispatch('click');
  const outside = h.editor.dispatch('pointerdown');
  assert.equal(outside.prevented, false); assert.equal(h.panel.hidden, true);
});

test('The menu fits the visible viewport above a mobile keyboard', () => {
  const h = menuHarness();
  h.c.window.visualViewport = { offsetLeft: 12, offsetTop: 30, width: 360, height: 380 };
  h.trigger.dispatch('pointerdown');
  assert.equal(h.panel.style.maxHeight, '364px');
  assert.equal(h.panel.style.maxWidth, '344px');
  assert(parseFloat(h.panel.style.top) >= 38);
  assert(parseFloat(h.panel.style.top) + h.panel.offsetHeight <= 402);
});

test('Each newly selected box starts collapsed; practice has only its own check and ask actions', () => {
  const h = menuHarness(); h.trigger.dispatch('pointerdown');
  h.c.renderAiBar({ wrap: h.wrap }, { ...h.a, id: 'a2' }, {});
  assert.equal(h.wrap.querySelector('.aiTextMenuPanel').hidden, true);
  const p = menuHarness(true); p.trigger.dispatch('click');
  assert.deepEqual(p.panel.children.map(n => n.textContent), ['✨ Check this answer', '💬 Ask AI · 5⭐']);
  p.panel.children[0].dispatch('click'); assert.deepEqual(p.calls, ['check']);
});
