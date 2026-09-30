import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return html.slice(a, b);
}
const vision = section('function aiViewRect(', '/* ---- Worksheet snapshots for Gemini ----');
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const canvases = [], drawings = [], requests = [];
  let sequence = 0;
  function canvas() {
    const c = { width: 0, height: 0, id: ++sequence, ops: [] };
    const ctx = {
      canvas: c, fillRect() {}, save() {}, restore() {}, scale() {},
      drawImage(...args) { c.ops.push(args); }
    };
    c.getContext = () => ctx;
    c.toDataURL = () => 'data:image/jpeg;base64,' + Buffer.from('canvas-' + c.id).toString('base64');
    canvases.push(c);
    return c;
  }
  function page(num, top) {
    return { num, baseW: 600, baseH: 800,
      svg: { getBoundingClientRect: () => ({ left: 0, top, right: 600, bottom: top + 800, width: 600, height: 800 }) },
      page: { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render: ({ canvasContext }) => { drawings.push(['pdf', num, canvasContext.canvas.id]); return { promise: Promise.resolve(), cancel() {} }; } }
    };
  }
  const pages = [page(1, 100), page(2, 1000)];
  const box = {
    currentDocId: 'paper', currentUser: { uid: 'teacher' }, wsEpoch: 4, practiceMode: false,
    pages, selectedId: 'draft', currentPageNum: () => 1,
    annotations: [
      { id: 'draft', type: 'text', page: 1, x: 60, y: 320, w: 130, h: 30, text: 'Saved words' },
      { id: 'pic', type: 'ainote', kind: 'paste', page: 1, x: 30, y: 200, w: 80, h: 60, src: 'data:image/png;base64,abc' },
      { id: 'ink', type: 'pen', page: 1, points: [{ x: 30, y: 220 }, { x: 100, y: 220 }] },
      { id: 'part-b', type: 'text', page: 2, x: 20, y: 150, w: 100, h: 30, text: 'Page two working' }
    ],
    teacherAnswers: [{ type: 'text', page: 1, text: 'HIDDEN TEACHER ANSWER' }],
    lessonSnapshot: () => [{ ...box.annotations[0], text: 'The live unsaved sentence' }],
    voiceCursorPoint: () => ({ page: 1, x: 400, y: 650 }),
    aiQuestionFocusCurrent: () => null,
    aiScreenFrame: () => ({ mimeType: 'image/jpeg', data: 'SCREEN', label: 'actual shared display' }),
    annBounds: a => ({ x: a.x, y: a.y, x2: a.x + a.w, y2: a.y + a.h }),
    annNoteMin: a => !!a.min,
    document: { createElement: tag => { assert.equal(tag, 'canvas'); return canvas(); } },
    $: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600 }) }),
    window: { innerWidth: 900, innerHeight: 700 },
    aiThrowIfAborted: signal => { if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } },
    drawAnnsOnCtx: (_ctx, _kx, _ky, anns) => drawings.push(...anns.map(a => ['annotation', a.id, a.text])),
    lessonBackgroundImage: async src => ({ src }),
    lessonBackgroundPainter: () => ({ page: {}, cv() {}, rgb() {}, font: {}, fontBold: {} }),
    drawAiNoteOnPdf: ({ ann, image }) => drawings.push(['card', ann.id, image?.src]),
    console: { warn() {} }, Map, AbortController, Promise
  };
  vm.createContext(box); vm.runInContext(vision, box);
  return { box, pages, canvases, drawings, requests };
}

test('a snapshot freezes draft text and screen pixels without changing saved annotations', async () => {
  const h = harness(), saved = JSON.stringify(h.box.annotations);
  const view = h.box.aiViewSnapshot();
  h.box.annotations[0].text = 'Changed after the request';
  h.box.lessonSnapshot = () => [{ ...h.box.annotations[0], text: 'Later typing' }];
  h.box.aiScreenFrame = () => ({ data: 'LATER SCREEN' });
  const result = await h.box.aiViewImages(view);
  assert.match(result.prompt, /The live unsaved sentence/);
  assert.doesNotMatch(result.prompt, /Changed after|Later typing|HIDDEN TEACHER/);
  assert.equal(result.images.at(-1).data, 'SCREEN');
  assert.match(result.prompt, /actual display at request time/);
  assert.equal(JSON.parse(saved)[0].text, 'Saved words');
  assert.equal(view.annotations[0].text, 'The live unsaved sentence');
});

test('visible viewport is mapped through the real page rectangle and explicit focus can be on another page', async () => {
  const h = harness();
  h.box.aiQuestionFocusCurrent = () => ({ page: 2, x: 20, y: 150, w: 250, h: 100 });
  const view = h.box.aiViewSnapshot({ pageRef: h.pages[0] });
  const visible = view.crops.find(c => c.kind === 'visible');
  assert.deepEqual(plain(visible.rect), { page: 1, x: 0, y: 0, w: 600, h: 500 });
  assert.equal(view.crops[0].kind, 'focus');
  assert.equal(view.crops[0].rect.page, 2);
  assert.equal(view.questionPage, 2);
  assert.deepEqual(plain(view.pages.map(p => p.num)), [1, 2]);
  const result = await h.box.aiViewImages(view);
  assert.match(result.prompt, /explicitly selected the question region on page 2/);
  assert.match(result.prompt, /cursor is the answer destination/);
  assert.match(result.images[0].label, /explicitly selected/);
  assert.ok(result.images.some(image => /full page 2/.test(image.label)));
  assert.ok(result.images.some(image => /full page 1/.test(image.label)));
});

test('compositing preserves ink and picture stacking order and releases temporary canvases', async () => {
  const h = harness();
  const view = h.box.aiViewSnapshot();
  await h.box.aiViewImages(view);
  assert.deepEqual(h.drawings.filter(row => row[0] !== 'pdf').map(row => row.slice(0, 2)), [
    ['annotation', 'draft'], ['card', 'pic'], ['annotation', 'ink']
  ]);
  assert.equal(h.drawings.find(row => row[0] === 'annotation')[2], 'The live unsaved sentence');
  assert.ok(h.canvases.every(c => c.width === 0 && c.height === 0));
});

test('a worksheet or role change while a picture loads stops the request before a provider sees it', async () => {
  for (const change of [b => b.wsEpoch++, b => { b.currentUser = { uid: 'other' }; }, b => { b.practiceMode = true; },
    b => { b.reviseMode = true; }, b => { b.isStudent = () => true; }, b => { b.isSharedVisitor = () => true; }]) {
    const h = harness();
    let finish;
    h.box.lessonBackgroundImage = () => new Promise(resolve => { finish = resolve; });
    const view = h.box.aiViewSnapshot();
    const pending = h.box.aiPrepareViewRequest('Answer this', { viewContext: view });
    while (!finish) await Promise.resolve();
    change(h.box); finish({});
    await assert.rejects(pending, /worksheet changed/);
    assert.ok(h.canvases.every(c => c.width === 0 && c.height === 0));
  }
});

test('a cancelled view cannot send partial images and unreadable pictures fail visibly', async () => {
  const h = harness(), controller = new AbortController();
  const view = h.box.aiViewSnapshot(); controller.abort();
  await assert.rejects(h.box.aiViewImages(view, controller.signal), /aborted/);
  h.box.lessonBackgroundImage = async () => { throw new Error('Picture failed to load'); };
  await assert.rejects(h.box.aiPrepareViewRequest('Read the diagram', { viewContext: view }), /Picture failed to load/);
});

test('a per-page marking view excludes unrelated focus, hidden teacher answers and shared display', async () => {
  const h = harness(); h.box.practiceMode = true;
  h.box.aiQuestionFocusCurrent = () => ({ page: 2, x: 20, y: 150, w: 100, h: 100 });
  const view = h.box.aiViewSnapshot({ pageRef: h.pages[0], includeFocus: false, includeViewport: false, includeScreen: false,
    target: { page: 1, x: 0, y: 300, w: 600, h: 100 } });
  assert.equal(view.focus, null); assert.equal(view.screen, null);
  assert.deepEqual(plain(view.pages.map(p => p.num)), [1]);
  const result = await h.box.aiViewImages(view);
  assert.doesNotMatch(result.prompt, /HIDDEN TEACHER|explicitly selected|Page two working/);
  assert.ok(result.images.every(image => image.data !== 'SCREEN'));
});

test('revision snapshots show only the keywords already revealed on the worksheet', async () => {
  const h = harness();
  Object.assign(h.box, { reviseMode: true, revealedKw: { oxygen: true }, kwResults: { 'draft:2': { correct: false, guess: 'lungs' } },
    normWord: word => word.toLowerCase().replace(/\W/g, ''),
    splitKwToken: word => ({ lead: '', core: word.replace(/[.!]$/, ''), trail: /[.!]$/.test(word) ? word.slice(-1) : '' }) });
  h.box.annotations[0].text = 'Carbon oxygen nitrogen.';
  h.box.annotations[0].kw = [0, 1, 2];
  h.box.lessonSnapshot = () => [];
  const view = h.box.aiViewSnapshot();
  assert.equal(view.annotations[0].text, '______ oxygen nitrogen.');
  const result = await h.box.aiPrepareViewRequest('Help with this revision', { viewContext: view, images: [{ data: 'OLD UNMASKED COMPOSITE' }] });
  assert.doesNotMatch(result.prompt, /Carbon/);
  assert.match(result.prompt, /Revision mode is active/);
  assert.ok(result.opts.images.every(image => image.data !== 'OLD UNMASKED COMPOSITE'));
  assert.equal(h.box.annotations[0].text, 'Carbon oxygen nitrogen.');
});

test('whole-document page readers paint only their explicit frozen annotation set including pictures', async () => {
  const h = harness();
  vm.runInContext(section('async function keyPageJpeg(', '/* Question numbers'), h.box);
  const selected = [h.box.annotations[1]];
  const pending = h.box.keyPageJpeg(h.pages[0], selected, 2200);
  selected[0] = { ...selected[0], id: 'different' };
  await pending;
  assert.deepEqual(h.drawings.filter(row => row[0] !== 'pdf').map(row => row.slice(0, 2)), [['card', 'pic']]);
  assert.ok(h.canvases.every(c => c.width === 0 && c.height === 0));
});

test('replay vision freezes the displayed writing and recorded picture layer, without final answers', async () => {
  const h = harness(), seenTimes = [], loaded = [];
  const media = { currentTime: 7.5 };
  const playback = h.box.lessonPlayback = { duration: 30000, backgrounds: [{ page: 1, data: 'REPLAY PICTURE' }],
    player: { stateAt: time => { seenTimes.push(time); return { annotations: [{ id: 'step-one', type: 'text', page: 1,
      x: 30, y: 250, w: 180, h: 40, text: 'Only step one is visible', kw: [1] }] }; } } };
  h.box.lessonMedia = () => media;
  h.box.lessonBackgroundImage = async src => { loaded.push(src); return { src }; };
  const view = h.box.aiViewSnapshot({ annotations: h.box.annotations });
  media.currentTime = 19;
  const result = await h.box.aiPrepareViewRequest('Explain this step', { viewContext: view, images: [{ data: 'FINAL ANSWER IMAGE' }] });
  assert.deepEqual(seenTimes, [7500]);
  assert.deepEqual(loaded, ['REPLAY PICTURE']);
  assert.deepEqual(h.drawings.filter(row => row[0] !== 'pdf').map(row => row.slice(0, 2)), [['annotation', 'step-one']]);
  assert.match(result.prompt, /replay at 7.5 seconds/);
  assert.match(result.prompt, /Only step one is visible/);
  assert.doesNotMatch(result.prompt, /Saved words|live unsaved sentence/);
  assert.ok(result.opts.images.every(image => image.data !== 'FINAL ANSWER IMAGE'));
  h.box.lessonPlayback = null;
  await assert.rejects(h.box.aiViewImages(view), /worksheet changed/);
  assert.equal(playback.backgrounds[0].data, 'REPLAY PICTURE');
});

test('all text providers and fallback receive the same frozen views after task-specific references', async () => {
  for (const engine of ['openai', 'kimi', 'gemini', 'fallback']) {
    const h = harness();
    h.box.aiWithDeadline = (work, _ms, signal) => work(signal);
    h.box.openAiOn = () => engine === 'openai' || engine === 'fallback';
    h.box.kimiOn = () => engine === 'kimi';
    const respond = name => async (prompt, opts) => {
      h.requests.push({ name, prompt, opts });
      if (engine === 'fallback' && name === 'openai') throw new Error('temporarily unavailable');
      return 'Answer';
    };
    h.box.window.askOpenAI = respond('openai'); h.box.window.askKimi = respond('kimi');
    h.box.askGeminiDirect = respond('gemini');
    vm.runInContext(section('window.askGemini = async function askGemini(', "// Gemini's ceiling"), h.box);
    const view = h.box.aiViewSnapshot();
    await h.box.window.askGemini('Answer part a', { system: 'Teacher guidance', images: [{ mimeType: 'image/png', data: 'TASK REF' }], viewContext: view });
    assert.equal(h.requests[0].opts.images[0].data, 'TASK REF');
    assert.equal(h.requests[0].opts.images.at(-1).data, 'SCREEN');
    assert.match(h.requests[0].prompt, /Image 2 =/);
    assert.match(h.requests[0].prompt, /live unsaved sentence/);
    assert.equal(h.requests[0].opts.system, 'Teacher guidance');
    if (engine === 'fallback') assert.deepEqual(plain(h.requests[0].opts.images), plain(h.requests[1].opts.images));
  }
});

test('Gemini image generation receives supplied worksheet references alongside the instruction', async () => {
  const h = harness(); let request;
  h.box.geminiImageModel = { generateContent: async value => { request = value; return { response: { candidates: [
    { content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'OUTPUT' } }] } }
  ] } }; } };
  vm.runInContext(section('async function askGeminiImageDirect(', '</script>'), h.box);
  const result = await h.box.askGeminiImageDirect('Make a labelled diagram of this question', { refs: ['data:image/jpeg;base64,YWJj'] });
  assert.equal(result.data, 'OUTPUT');
  assert.deepEqual(plain(request.contents[0].parts), [{ text: 'Make a labelled diagram of this question' }, { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } }]);
});
