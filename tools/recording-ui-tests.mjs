/* Run the actual lesson adapter in a deterministic browser/media simulation.
   No microphone, account, upload or playback happens outside this process. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert(a >= 0 && b > a, 'shipped recording section must exist');
  return html.slice(a, b);
}
const actual = cut('/* ================= Lesson replay core ================= */', '/* ================= End lesson replay core ================= */') +
  cut('/* ================= Lesson recording backgrounds ================= */', '/* ================= End lesson recording backgrounds ================= */') +
  cut('/* ================= Seekable lesson audio ================= */', '/* ================= Synchronized lesson recording ================= */') +
  cut('/* ================= Synchronized lesson recording ================= */', '/* ================= End synchronized lesson recording ================= */') +
  cut('function setDirty(v) {', '/* ================= Undo / redo ================= */');
const bootstrap = `
var now = 0, counter = 0, nextTimer = 0, timers = new Map(), messages = [], writes = [], uploads = [], renders = [], recovery = new Map();
var failWrite = false, failUpload = false, failRecovery = false, recoveryWait = null, microphoneWait = null, manifestWait = null;
class Node {
  constructor() { this.hidden = true; this.style = {}; this.attrs = {}; this.children = []; this.listeners = {}; this.textContent = ''; this.innerText = ''; this.scrollHeight = 40; this.checked = false; this.paused = true; this.currentTime = 0; this.clientWidth = 600; this.clientHeight = 800; this.scrollLeft = 0; this.scrollTop = 0; this.classes = new Set(); var self = this;
    this.classList = { add: function(x){ self.classes.add(x); }, remove: function(x){ self.classes.delete(x); }, contains: function(x){ return self.classes.has(x); } };
  }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  emit(name, event) { (this.listeners[name] || []).forEach(function(fn){ fn(event || {}); }); }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; if (name === 'src') this.src = ''; }
  appendChild(node) { this.children.push(node); node.parent = this; return node; }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  click() {}
}
var nodes = Object.create(null);
function $(id) { return nodes[id] || (nodes[id] = new Node()); }
var document = new Node(); document.body = new Node(); document.createElement = function(){ return new Node(); };
var window = new Node(); window.isSecureContext = true;
function stream() { var track = { enabled: true, stopped: 0, stop: function(){ this.stopped++; }, getSettings: function(){ return { noiseSuppression: true }; } }; return { track: track, getTracks: function(){ return [track]; }, getAudioTracks: function(){ return [track]; } }; }
var mic = stream(), micConstraints = null;
var navigator = { mediaDevices: { getUserMedia: function(opts){ micConstraints = opts; return microphoneWait || Promise.resolve(mic); } } };
class Source { constructor(){ this.connections = []; this.disconnected = false; } connect(to){ this.connections.push(to); } disconnect(){ this.disconnected = true; } }
class Context { constructor(){ this.state = 'running'; this.destination = {}; } resume(){ return Promise.resolve(); } close(){ this.state = 'closed'; return Promise.resolve(); } createMediaStreamDestination(){ return { stream: stream() }; } createMediaStreamSource(){ return new Source(); } }
var recorders = [];
class Recorder {
  constructor(s, opts){ this.state = 'inactive'; this.stream = s; this.mimeType = opts.mimeType || 'audio/mp4'; recorders.push(this); }
  start(){ this.state = 'recording'; }
  fireStart(){ if (this.onstart) this.onstart(); }
  stop(){ this.state = 'inactive'; this.pendingStop = true; }
  async finishStop(){ this.ondataavailable({ data: new Blob(['voice'], { type: this.mimeType }) }); this.onstop(); await tickTask(); }
}
window.MediaRecorder = Recorder; window.AudioContext = Context; var MediaRecorder = Recorder;
var Audio = Node;
var performance = { now: function(){ return now; } };
function setInterval(fn){ var id = ++nextTimer; timers.set(id, fn); return id; }
function clearInterval(id){ timers.delete(id); }
function setTimeout(fn){ var id = ++nextTimer; timers.set(id, fn); return id; }
function clearTimeout(id){ timers.delete(id); }
function requestAnimationFrame(fn){ var id = ++nextTimer; timers.set(id, fn); return id; }
function cancelAnimationFrame(id){ timers.delete(id); }
var currentUser = { uid: 'teacher', getIdToken: async function(){ return 'test-token'; } }, currentDocId = 'worksheet', wsEpoch = 1;
var actingStudent = false, practiceMode = false, shared = false, admin = true;
var annotations = [], drawing = null, editingId = null, scale = 1, fittedWidth = true;
var pages = [{ num: 1, baseW: 600, baseH: 800, wrap: new Node() }, { num: 2, baseW: 600, baseH: 800, wrap: new Node() }];
var pdfBytes = new Uint8Array([1, 2, 3]);
function isAdmin(u){ return !!u && admin; } function isSharedVisitor(){ return shared; }
function currentPageNum(){ return 1; } function applyScale(){}
function el(){ return new Node(); }
function annNode(a){ renders.push(a); var n = new Node(); n.annotation = a; n.setAttribute('data-id', a.id); return n; }
function annTextNode(id){ return $('text-' + id); }
function toast(text){ messages.push(text); }
function recBusy(){ return false; }
function recDropSpot(){ return { page: pages[0], x: 50, y: 60 }; }
function newAnnId(){ return 'lesson' + (++counter); }
// Simulated MP4 exercises the real finalizer's pass-through path. Real WebM
// byte containers and seeking metadata have their own audio finalizer tests.
function recPickMime(){ return 'audio/mp4'; } function recExt(){ return 'm4a'; }
function recFmtTime(ms){ return Math.floor(ms / 1000) + 's'; }
var autoSaveInFlight = false, autoSaveTimer = null, autoSaveQueued = false, dirty = false, scheduled = 0, undoCount = 0;
function pushUndo(){ undoCount++; } function renderAllOverlays(){} function setDirty(v){ dirty = v; }
function scheduleAutoSave(){ scheduled++; } function pageStarFields(){ return { stars: [] }; }
async function writeAnnotations(docId, json, fields){ writes.push({ docId: docId, json: json, fields: fields }); if (failWrite) throw new Error('write refused'); }
var STORAGE_DIR = 'pdf-annotator', VIDEO_BTN_H = 30;
function asset(path){ return 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(path) + '?alt=media'; }
var storage = { ref: function(path){ return { fullPath: path, put: async function(blob){ uploads.push({ path: path, size: blob.size, text: path.endsWith('.json') ? await blob.text() : '' }); if (failUpload) throw new Error('offline'); }, getDownloadURL: async function(){ return asset(path); } }; } };
function confirm(){ return true; }
var liveOptions = null, liveClosed = 0;
var AnsKeyLive = { connect: async function(opts){ liveOptions = opts; return { close: async function(){ liveClosed++; } }; } };
window.liveAppCheckToken = async function(){ return 'test-appcheck'; };
function aiNotePageImage(){ return 'test-page-image'; } function aiGrounding(){ return 'grounded'; }
async function loadTeachingNotes(){}
window.askGemini = async function(){ return 'Short teaching explanation'; };
function ink(id){ return { id: id || 'ink', page: 1, type: 'pen', color: '#000', width: 2, points: [{x: 1, y: 1}] }; }
function words(){ return { id: 'words', type: 'text', page: 1, x: 5, y: 6, w: 100, h: 40, fontSize: 16, color: '#000', text: 'Start', kw: [0] }; }
function deferred(){ var resolve, reject; var promise = new Promise(function(a,b){ resolve = a; reject = b; }); return { promise: promise, resolve: resolve, reject: reject }; }
`;
function harness() {
  const context = vm.createContext({ Blob, URL, TextEncoder, TextDecoder, AbortController, DOMException, atob, crypto: webcrypto, structuredClone, console, tickTask: () => new Promise(resolve => setImmediate(resolve)) });
  vm.runInContext(bootstrap + actual + `
lessonRecovery = async function(action, key, value) {
  if (recoveryWait) return recoveryWait;
  if (failRecovery) throw new Error('local storage blocked');
  if (action === 'put') recovery.set(key, structuredClone(value));
  if (action === 'delete') recovery.delete(key);
  return action === 'get' ? recovery.get(key) : undefined;
};
lessonPdfHash = async function(){ return 'pdf-hash'; };
function savedManifest(){ var core = LessonReplayCore.createRecorder([ink(), words()], { page: 1, x: 100, y: 120, zoom: 1.5 });
  var a = ink(); a.points.push({x: 20, y: 30}); core.capture(500, [a, words()], {page: 2, x: 200, y: 220, zoom: 2});
  return { version: 1, worksheetId: currentDocId, pdfHash: 'pdf-hash', pageCount: pages.length, timeline: core.finish(1000) };
}
lessonReadManifest = async function(){ return manifestWait || savedManifest(); };
var attachment = { url: asset('pdf-annotator/lesson-worksheet-test.webm'), lessonRecording: { manifestUrl: asset('pdf-annotator/lesson-worksheet-test.json') } };
`, context);
  return { context, run: source => vm.runInContext(source, context), json: source => JSON.parse(vm.runInContext('JSON.stringify(' + source + ')', context)) };
}
let passed = 0;
async function check(name, run) {
  try { await run(); passed++; }
  catch (error) { console.error('FAIL: ' + name); throw error; }
}

await check('live pencil and typed input are sampled without mutating saved work', () => {
  const h = harness();
  h.run(`annotations = [words(), { id: 'media', type: 'video' }]; drawing = { ann: ink('active') }; editingId = 'words'; $('text-words').innerText = 'Typed now' + String.fromCharCode(10); $('text-words').scrollHeight = 70; var sample = lessonSnapshot();`);
  assert.deepEqual(h.json('sample.map(function(a){ return a.id; })'), ['words', 'active']);
  assert.equal(h.run('sample[0].text'), 'Typed now');
  assert.equal(h.run('sample[0].h'), 70);
  assert.equal(h.run('annotations[0].text'), 'Start');
  assert.equal(h.run('annotations[0].h'), 40);
});

await check('record, stop and save persist synchronized audio and a page attachment', async () => {
  const h = harness();
  await h.run('annotations = [ink()]; lessonStart();');
  h.run('recorders[0].fireStart(); now = 250; annotations[0].points.push({x: 2, y: 4}); setDirty(true); lessonCaptureTick(); now = 500; lessonStop();');
  assert.equal(h.run('mic.track.enabled'), false, 'stop silences the microphone immediately');
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('uploads.length'), 2);
  assert.equal(h.run('writes.length'), 1);
  const attachment = h.json('annotations[1]');
  assert.equal(attachment.type, 'video');
  assert.equal(attachment.page, 1);
  assert.equal(attachment.lessonRecording.duration, 500);
  assert.equal(h.run('dirty'), false);
  assert.equal(h.run('recovery.size'), 0);
  assert.equal(h.run('JSON.parse(uploads[1].text).timeline.events[0].t'), 250, 'the real dirty hook records the edit at its capture tick');
  assert.equal(h.run('micConstraints.audio.noiseSuppression'), true);
  assert(h.run('mic.track.stopped') > 0);
});

await check('cancelled transient ink disappears on the next capture tick', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 50; drawing = { ann: ink("temporary") }; lessonCaptureTick(); now = 100; drawing = null; lessonCaptureTick(); now = 200; lessonStop();');
  await h.run('recorders[0].finishStop();');
  const events = h.json('JSON.parse(uploads[1].text).timeline.events');
  assert.equal(events.find(e => e.type === 'remove').t, 100, 'cancelled stroke must disappear before recording ends');
});

await check('adding a card stops recording and saves the portion before pictures diverge', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run(`recorders[0].fireStart(); now = 50; annotations.push(ink()); setDirty(true); lessonCaptureTick();
    annotations.push({id:'new-card', type:'ainote', page:1, kind:'notes', x:20, y:30, w:160, h:100, title:'New note', text:'Added during recording'});
    now = 100; lessonCaptureTick();`);
  assert.equal(h.run('lessonCapture.phase'), 'stopping');
  assert.equal(h.run('recorders[0].pendingStop'), true);
  assert(h.run('messages.some(function(m){ return m.indexOf("picture or card changed") >= 0; })'));
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('writes.length'), 1);
  assert.equal(h.run('JSON.parse(uploads[1].text).timeline.duration'), 100);
  assert.equal(h.run('JSON.parse(uploads[1].text).timeline.events[0].t'), 50);
  assert.deepEqual(h.json('JSON.parse(uploads[1].text).backgrounds'), []);
  assert(h.run('annotations.some(function(a){ return a.id === "new-card"; })'), 'the new card remains ordinary worksheet work');
  assert(h.run('annotations.some(function(a){ return !!a.lessonRecording; })'), 'the captured portion is attached');
});

await check('card changes between preparation and recorder onstart never start a timeline', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run(`annotations.push({id:'late-card', type:'ainote', page:1, kind:'notes', x:20, y:30, w:160, h:100, title:'Late note', text:'Changed during preparation'});
    recorders[0].fireStart();`);
  assert.equal(h.run('lessonCapture.core'), undefined);
  assert.equal(h.run('lessonCapture.phase'), 'stopping');
  assert.equal(h.run('timers.size'), 0, 'preparation race must not launch the capture interval');
  assert.equal(h.run('liveOptions'), null);
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('writes.length'), 0);
  assert.equal(h.run('uploads.length'), 0);
  assert(h.run('mic.track.stopped') > 0);
});

await check('cancel before microphone permission resolves releases the late stream', async () => {
  const h = harness();
  const start = h.run('var permission = deferred(); microphoneWait = permission.promise; var starting = lessonStart(); starting;');
  await Promise.resolve(); await Promise.resolve();
  h.run('lessonStop(); permission.resolve(mic);');
  await start;
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('recorders.length'), 0);
  assert(h.run('mic.track.stopped') > 0);
});

await check('cancel before the queued recorder start event cannot restart recording', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('lessonStop(); recorders[0].fireStart();');
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('writes.length'), 0);
  assert.equal(h.run('timers.size'), 0);
});

await check('upload failure keeps local recovery and retry creates just one attachment', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 750; failUpload = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('lessonPending.duration'), 750);
  assert.equal(h.run('recovery.size'), 1);
  assert.equal(h.run('annotations.length'), 0);
  assert.equal(h.run('lessonGuardChange()'), false);
  await h.run('failUpload = false; lessonSavePending();');
  assert.equal(h.run('annotations.length'), 1);
  assert.equal(h.run('writes.length'), 1);
  assert.equal(h.run('recovery.size'), 0);
});

await check('worksheet save failure retains retry data and reuses uploaded assets', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 300; failWrite = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('uploads.length'), 2);
  assert.equal(h.run('lessonPending.saving'), false);
  assert.equal(h.run('recovery.size'), 1);
  await h.run('failWrite = false; lessonSavePending();');
  assert.equal(h.run('uploads.length'), 2);
  assert.equal(h.run('annotations.length'), 1);
  assert.equal(h.run('lessonPending'), null);
});

await check('attachment save waits for normal autosave and preserves edits made while waiting', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 300; failUpload = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  const saving = h.run('failUpload = false; autoSaveInFlight = true; lessonSavePending();');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.run('writes.length'), 0);
  h.run('annotations.push(ink("written-while-uploading")); autoSaveInFlight = false; Array.from(timers.values()).forEach(function(fn){ fn(); }); timers.clear();');
  await saving;
  const written = h.json('JSON.parse(writes[0].json)');
  assert(written.some(a => a.id === 'written-while-uploading'));
  assert(written.some(a => a.lessonRecording));
  assert.equal(h.run('lessonPending'), null);
});

await check('account change stops capture and prevents attachment under the new account', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run(`recorders[0].fireStart(); now = 150; currentUser = { uid: 'student' }; admin = false; lessonRoleChanged();`);
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('writes.length'), 0);
  assert.equal(h.run('uploads.length'), 0);
  assert.equal(h.run('lessonPending.uid'), 'teacher');
  assert.equal(h.run('recovery.size'), 1);
  assert.equal(h.run("$('lessonBar').hidden"), true);
});

await check('students can navigate and replay while the teacher has an unsaved backup', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 150; failUpload = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  h.run("currentUser = { uid: 'student' }; admin = false; lessonRoleChanged();");
  assert.equal(h.run('lessonBusy()'), false);
  assert.equal(h.run('lessonGuardChange()'), true);
  await h.run("currentDocId = 'student-worksheet'; wsEpoch++; lessonPlay(attachment);");
  assert.equal(h.run('lessonPlayback.overlays.length'), 2);
  assert.equal(h.run("$('lessonAudio').paused"), false);
  assert.equal(h.run('lessonPending.uid'), 'teacher');
  assert.equal(h.run('writes.length'), 0);
  assert.equal(h.run('lessonGuardChange()'), true);
  assert.equal(h.run('lessonPlayback'), null);
  assert.equal(h.run('recovery.size'), 1, 'student navigation must preserve the teacher backup');
});

await check('manual save and page mutations block recording startup', async () => {
  for (const id of ['saveBtn', 'blankPageBtn', 'deletePageBtn']) {
    const h = harness();
    await h.run(`$('${id}').disabled = true; lessonStart();`);
    assert.equal(h.run('lessonCapture'), null, id);
    assert.equal(h.run('recorders.length'), 0, id);
    assert.equal(h.run('micConstraints'), null, id + ' must block before requesting a microphone');
    await h.run(`$('${id}').disabled = false; lessonStart();`);
    assert.equal(h.run('recorders.length'), 1, id + ' releases startup when finished');
    h.run('lessonStop();');
    await h.run('recorders[0].finishStop();');
  }
});

await check('failed attachment leaves no playable pill and discard cannot save it', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 250; failWrite = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run('annotations.length'), 0, 'failed cloud write must not alter the editable worksheet');
  assert.equal(h.run('undoCount'), 0);
  assert.equal(h.run('writes.length'), 1);
  assert.equal(h.run('lessonPending.audioFinalized'), true, 'real audio preparation ran before uploads');
  await h.run('lessonDismissPending();');
  assert.equal(h.run('annotations.length'), 0);
  assert.equal(h.run('writes.length'), 1, 'discard must not retry attachment saving');
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('recovery.size'), 0);
});

await check('retry rebinds only the same teacher and original unchanged worksheet', async () => {
  const h = harness();
  await h.run('lessonStart();');
  h.run('recorders[0].fireStart(); now = 250; failUpload = true; lessonStop();');
  await h.run('recorders[0].finishStop();');
  await h.run("failUpload = false; currentDocId = 'another-worksheet'; wsEpoch = 2; lessonSavePending();");
  assert.equal(h.run('lessonPending.epoch'), 1, 'another worksheet cannot rebind the backup');
  assert.equal(h.run('writes.length'), 0);
  await h.run("currentDocId = 'worksheet'; currentUser = {uid: 'other-teacher'}; wsEpoch = 3; lessonSavePending();");
  assert.equal(h.run('lessonPending.epoch'), 1, 'another teacher cannot rebind the backup');
  assert.equal(h.run('writes.length'), 0);
  await h.run("currentUser = {uid: 'teacher'}; wsEpoch = 4; lessonPdfHash = async function(){ return 'changed-pdf'; }; lessonSavePending();");
  assert.equal(h.run('writes.length'), 0, 'a changed PDF cannot receive stale page coordinates');
  assert.equal(h.run('annotations.length'), 0);
  assert.equal(h.run('recovery.size'), 1);
  await h.run("wsEpoch = 5; lessonPdfHash = async function(){ return 'pdf-hash'; }; lessonSavePending();");
  assert.equal(h.run('lessonPending'), null);
  assert.equal(h.run('annotations.length'), 1);
  assert.equal(h.run('writes[0].docId'), 'worksheet');
  assert.equal(h.run('recovery.size'), 0);
});

await check('failed recovery cannot open a stale modal after the account changes', async () => {
  const h = harness();
  const opening = h.run(`var lookup = deferred(); recoveryWait = lookup.promise; lessonOpen();`);
  h.run(`currentUser = null; admin = false; lookup.reject(new Error('storage blocked'));`);
  await opening;
  assert.equal(h.run("$('lessonModal').classList.contains('open')"), false);
});

await check('playback uses audio time, isolates annotations and restores the original view', async () => {
  const h = harness();
  await h.run('annotations = [words()]; var original = JSON.stringify(annotations); lessonPlay(attachment);');
  assert.equal(h.run('lessonPlayback.overlays.length'), 2);
  assert.equal(h.run('scale'), 1.5);
  assert(h.run('renders.every(function(a){ return a.id.indexOf("lesson-replay-") === 0 && a.kw.length === 0; })'));
  h.run("$('lessonAudio').currentTime = 0.6; lessonReplayFrame();");
  assert.equal(h.run('scale'), 2);
  assert.equal(h.run('lessonPlayback.overlays[0].children[0].annotation.points.length'), 2);
  h.run("$('lessonAudio').currentTime = 0.1; lessonReplayFrame();");
  assert.equal(h.run('scale'), 1.5);
  assert.equal(h.run('lessonPlayback.overlays[0].children[0].annotation.points.length'), 1);
  h.run('lessonExitPlayback();');
  assert.equal(h.run('JSON.stringify(annotations) === original'), true);
  assert.equal(h.run('scale'), 1);
  assert.equal(h.run('fittedWidth'), true);
  assert.equal(h.run('pages[0].wrap.children.length'), 0);
  assert.equal(h.run("$('lessonAudio').paused"), true);
});

await check('late manifest from a closed player never starts audio or overlays', async () => {
  const h = harness();
  const opening = h.run('var waiting = deferred(); manifestWait = waiting.promise; var originalManifest = savedManifest(); lessonPlay(attachment);');
  h.run('lessonExitPlayback(); waiting.resolve(originalManifest);');
  await opening;
  assert.equal(h.run('lessonPlayback'), null);
  assert.equal(h.run('pages[0].wrap.children.length'), 0);
  assert.equal(h.run("$('lessonAudio').paused"), true);
});

await check('mismatched PDF and untrusted asset hosts never start playback', async () => {
  const h = harness();
  await h.run(`manifestWait = savedManifest(); manifestWait.pdfHash = 'different-pdf'; lessonPlay(attachment);`);
  assert.equal(h.run('lessonPlayback'), null);
  assert(h.run('messages.some(function(m){ return m.indexOf("earlier version") >= 0; })'));
  await h.run(`manifestWait = null; attachment.url = 'https://evil.invalid/audio'; lessonPlay(attachment);`);
  assert.equal(h.run('lessonPlayback'), null);
  assert.equal(h.run("$('lessonAudio').paused"), true);
});

await check('voice helper stream is both heard and mixed into the recording', async () => {
  const h = harness();
  await h.run("$('lessonUseLive').checked = true; lessonStart();");
  h.run('recorders[0].fireStart();');
  await Promise.resolve(); await Promise.resolve();
  h.run('liveOptions.onRemoteStream(stream());');
  assert.equal(h.run('lessonCapture.remoteSource.connections.length'), 2);
  assert.equal(h.run('liveOptions.worksheetId'), 'worksheet');
  assert.equal(h.run('lessonCapture.remoteAudio.muted'), true);
  h.run('now = 100; lessonStop();');
  await h.run('recorders[0].finishStop();');
  assert(h.run('liveClosed') > 0);
});

await check('teacher lesson-pill gesture opens replay instead of the ordinary video editor', () => {
  const h = harness();
  const routing = cut('    var vHost = e.target.closest ?', '    // The buttons on an AI note card');
  const popup = cut('function openVideoPop(p, a) {', '/* ================= Google Drive =================');
  h.run(popup + `
    var played = [], edited = [], tool = 'pen';
    function isStudent(){ return false; }
    lessonPlay = function(a){ played.push(a.id); };
    function openVideoBtnModal(options){ edited.push(options.id); }
    function routePill(e, p){ ${routing} }
    annotations = [{id:'lesson-pill', type:'video', lessonRecording:{version:1}}];
    var group = {getAttribute:function(){ return 'lesson-pill'; }};
    var host = {closest:function(){ return group; }};
    var event = {target:{closest:function(){ return host; }}, preventDefault:function(){}};
    routePill(event, pages[0]);
  `);
  assert.deepEqual(h.json('played'), ['lesson-pill']);
  assert.deepEqual(h.json('edited'), []);
  h.run('tool = "select"; routePill(event, pages[0]);');
  assert.deepEqual(h.json('played'), ['lesson-pill'], 'selection tool keeps the pill available for moving');
});

console.log(`${passed} lesson UI integration checks passed.`);
