/* =====================================================================
   🎥 THE LESSON WINDOW'S CAMERA AND MICROPHONE, AND A LESSON RECORDED
   WITH THE CAMERA — the shipped code, in a simulated browser.
   ---------------------------------------------------------------------
   Every failure here is silent, and most of them are worse than silent:
   a preview that outlives its window is a camera light left on over a
   classroom; a remembered camera that is quietly swapped for the laptop's
   own is a lesson filmed from the wrong lens; a recording that opens the
   devices while the window still holds them is, on an iPad, a recording
   whose microphone Safari has just silenced. None of it throws.

   So this cuts the REAL sections out of index.html — the device window,
   the recorder, the replay and the voice helper beside them — and runs
   them against fakes of every browser surface they touch: devices that
   can be listed named or unnamed, plugged in and pulled out; permission
   prompts that can be answered late, refused or found busy; a level meter
   that can be made to hear a voice; a recorder whose stream can be
   inspected track by track. Nothing here opens a real camera.

     node --test tools/recording-camera-tests.mjs
   ===================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function cut(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert(a >= 0 && b > a, 'shipped section must exist: ' + from);
  return html.slice(a, b);
}
const deviceSection = cut('/* ================= Lesson camera and microphone ================= */',
  '/* ================= End lesson camera and microphone ================= */');
const actual = cut('/* ================= AI request deadlines ================= */', '/* ================= End AI request deadlines ================= */') +
  cut('/* ================= Lesson replay core ================= */', '/* ================= End lesson replay core ================= */') +
  cut('/* ================= Lesson recording backgrounds ================= */', '/* ================= End lesson recording backgrounds ================= */') +
  cut('/* ================= Seekable lesson audio ================= */', '/* ================= Synchronized lesson recording ================= */') +
  cut('/* ================= Synchronized lesson recording ================= */', '/* ================= End synchronized lesson recording ================= */') +
  cut('/* ================= Chung GPT Voice AI', '/* ================= End Chung GPT Voice AI ================= */') +
  cut('function setDirty(v) {', '/* ================= Undo / redo ================= */');

const bootstrap = `
var now = 0, counter = 0, nextTimer = 0, timeouts = new Map(), intervals = new Map(), frames = new Map();
var messages = [], writes = [], uploads = [], renders = [], recovery = new Map(), log = [], statuses = [], progress = [];
var failWrite = false, failUpload = false;
var store = new Map();
var localStorage = { getItem: function(k){ return store.has(k) ? store.get(k) : null; },
  setItem: function(k, v){ store.set(k, String(v)); }, removeItem: function(k){ store.delete(k); } };
class Node {
  constructor(id) { this.id = id || ''; this.hidden = true; this.style = {}; this.attrs = {}; this.children = []; this.listeners = {};
    this.textContent = ''; this.innerText = ''; this.scrollHeight = 40; this.checked = false; this.paused = true; this.currentTime = 0;
    this.clientWidth = 600; this.clientHeight = 800; this.scrollLeft = 0; this.scrollTop = 0; this.classes = new Set(); this.src = '';
    this.srcObject = null; this.value = ''; this.disabled = false; this.plays = 0; var self = this;
    this.classList = { add: function(x){ self.classes.add(x); }, remove: function(x){ self.classes.delete(x); }, contains: function(x){ return self.classes.has(x); },
      toggle: function(x, on){ if (on === undefined) on = !self.classes.has(x); if (on) self.classes.add(x); else self.classes.delete(x); return on; } };
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
  getBoundingClientRect() {
    var w = parseFloat(this.style.width) || this.clientWidth, h = this.clientHeight;
    var left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
    return { left: left, top: top, width: w, height: h, right: left + w, bottom: top + h };
  }
  play() { this.paused = false; this.plays++; log.push('play:' + this.id); return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  click() {}
  focus() { focused = this; }
}
var focused = null;
var nodes = Object.create(null);
function $(id) { return nodes[id] || (nodes[id] = new Node(id)); }
var document = new Node('document'); document.body = new Node('body'); document.hidden = false;
document.createElement = function (tag) { var n = new Node(); n.tagName = String(tag).toUpperCase(); return n; };
var window = new Node('window'); window.isSecureContext = true; window.innerWidth = 1200; window.innerHeight = 800;

/* ---- devices, tracks and permission prompts ---- */
var trackSeq = 0;
function track(kind, deviceId, label) {
  return { id: 't' + (++trackSeq), kind: kind, label: label || '', deviceId: deviceId, enabled: true, readyState: 'live', stopped: 0, onended: null,
    stop: function () { this.stopped++; this.readyState = 'ended'; log.push('stop:' + this.kind + ':' + this.deviceId); },
    getSettings: function () { return { deviceId: this.deviceId, noiseSuppression: true }; },
    end: function () { this.readyState = 'ended'; if (this.onended) this.onended(); } };
}
function streamOf(tracks) {
  return { tracks: tracks, getTracks: function () { return this.tracks.slice(); },
    getAudioTracks: function () { return this.tracks.filter(function (t) { return t.kind === 'audio'; }); },
    getVideoTracks: function () { return this.tracks.filter(function (t) { return t.kind === 'video'; }); } };
}
class MediaStream { constructor(tracks) { Object.assign(this, streamOf((tracks || []).slice())); } }
var NAMED = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - Desk Mic' },
  { kind: 'audioinput', deviceId: 'mic-desk', label: 'Desk Mic' },
  { kind: 'audioinput', deviceId: 'mic-usb', label: 'USB Mic' },
  { kind: 'videoinput', deviceId: 'cam-front', label: 'Front Camera' },
  { kind: 'videoinput', deviceId: 'cam-doc', label: 'Document Camera' },
  { kind: 'audiooutput', deviceId: 'default', label: 'Speakers' }
];
// What a browser lists before access is allowed: one of each kind, no id, no name.
var UNNAMED = [{ kind: 'audioinput', deviceId: '', label: '' }, { kind: 'videoinput', deviceId: '', label: '' }];
var devices = NAMED.slice(), namedAfterGrant = true;
var gum = [], gumWait = {}, gumFail = {}, opened = [], deviceListeners = [];
function deferred(){ var resolve, reject; var promise = new Promise(function(a,b){ resolve = a; reject = b; }); return { promise: promise, resolve: resolve, reject: reject }; }
var navigator = { mediaDevices: {
  enumerateDevices: async function () { log.push('enumerate'); return devices.map(function (d) { return Object.assign({}, d); }); },
  getUserMedia: function (c) {
    var kind = c.video ? 'video' : 'audio', spec = c.video || c.audio;
    gum.push(JSON.parse(JSON.stringify(c)));
    log.push('gum:' + kind);
    var fail = gumFail[kind];
    if (fail) {
      if (fail.once) delete gumFail[kind];
      var err = new Error(fail.message || ''); err.name = fail.name;
      return Promise.reject(err);
    }
    var ask = spec && spec.deviceId ? (spec.deviceId.exact || spec.deviceId.ideal) : '';
    var pool = NAMED.filter(function (d) { return d.kind === kind + 'input' && d.deviceId !== 'default' && devices.some(function (x) { return x.deviceId === d.deviceId || !x.deviceId; }); });
    var hit = pool.filter(function (d) { return d.deviceId === ask; })[0];
    if (spec && spec.deviceId && spec.deviceId.exact && !hit) { var e = new Error(''); e.name = 'OverconstrainedError'; return Promise.reject(e); }
    var dev = hit || (kind === 'audio' && !ask ? { deviceId: 'default', label: 'Default - Desk Mic' } : pool[0]) || { deviceId: kind + '-only', label: '' };
    var s = streamOf([track(kind, dev.deviceId, dev.label)]);
    opened.push(s);
    // Allowed now: the browser names what it had been hiding.
    if (namedAfterGrant) devices = NAMED.filter(function (d) { return !removed.has(d.deviceId); });
    var wait = gumWait[kind];
    if (wait) { delete gumWait[kind]; return wait.promise.then(function () { return s; }); }
    return Promise.resolve(s);
  },
  addEventListener: function (name, fn) { if (name === 'devicechange') deviceListeners.push(fn); }
} };
var removed = new Set();
function unplug(id) { removed.add(id); devices = devices.filter(function (d) { return d.deviceId !== id; }); deviceListeners.forEach(function (fn) { fn(); }); }
function plugIn(id) { removed.delete(id); devices = NAMED.filter(function (d) { return !removed.has(d.deviceId); }); deviceListeners.forEach(function (fn) { fn(); }); }
function liveTracks() { return opened.reduce(function (n, s) { return n + s.getTracks().filter(function (t) { return t.readyState === 'live'; }).length; }, 0); }

/* ---- audio: a meter that can be made to hear a voice ---- */
var level = 0, contexts = [];
class Source { constructor(s){ this.stream = s; this.connections = []; this.disconnected = false; } connect(to){ this.connections.push(to); } disconnect(){ this.disconnected = true; } }
class Analyser { constructor(){ this.fftSize = 2048; }
  getFloatTimeDomainData(buf){ for (var i = 0; i < buf.length; i++) buf[i] = i % 2 ? level : -level; }
  getByteTimeDomainData(buf){ for (var i = 0; i < buf.length; i++) buf[i] = 128 + Math.round((i % 2 ? level : -level) * 127); } }
class Context { constructor(){ this.state = 'running'; this.destination = {}; this.sources = 0; this.analysers = 0; this.closed = 0; this.feeds = []; contexts.push(this); }
  resume(){ this.state = 'running'; return Promise.resolve(); }
  close(){ this.state = 'closed'; this.closed++; return Promise.resolve(); }
  createMediaStreamDestination(){ return { stream: streamOf([track('audio', 'mixed', 'Mixed')]) }; }
  createMediaStreamSource(s){ this.sources++; this.feeds.push(s); return new Source(s); }
  createAnalyser(){ this.analysers++; return new Analyser(); } }
// The smallest WebM a browser writes: EBML header, a Segment and a Cluster of
// unknown size, an Info with its timestamp scale and no Duration. A recorder
// handing this over sends the save through the REAL finalizer, as Firefox does.
var WEBM = new Uint8Array([0x1A,0x45,0xDF,0xA3,0x87,0x42,0x82,0x84,0x77,0x65,0x62,0x6D,
  0x18,0x53,0x80,0x67,0x01,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
  0x15,0x49,0xA9,0x66,0x87,0x2A,0xD7,0xB1,0x83,0x0F,0x42,0x40,
  0x1F,0x43,0xB6,0x75,0x01,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
  0xE7,0x81,0x00,0xA3,0x84,0x81,0x00,0x00,0x80]);
var recorders = [];
class Recorder {
  constructor(s, opts){ opts = opts || {}; this.state = 'inactive'; this.stream = s; this.options = JSON.parse(JSON.stringify(opts));
    this.mimeType = opts.mimeType || (s.getVideoTracks && s.getVideoTracks().length ? 'video/webm' : 'audio/webm'); recorders.push(this); log.push('recorder'); }
  start(){ this.state = 'recording'; }
  fireStart(){ if (this.onstart) this.onstart(); }
  stop(){ this.state = 'inactive'; this.pendingStop = true; }
  async finishStop(){ if (this.ondataavailable) this.ondataavailable({ data: new Blob([/webm/.test(this.mimeType) ? WEBM : 'media'], { type: this.mimeType }) }); if (this.onstop) this.onstop(); await tickTask(); }
}
window.MediaRecorder = Recorder; window.AudioContext = Context; var MediaRecorder = Recorder;
var performance = { now: function(){ return now; } };
function setInterval(fn){ var id = ++nextTimer; intervals.set(id, fn); return id; }
function clearInterval(id){ intervals.delete(id); }
function setTimeout(fn){ var id = ++nextTimer; timeouts.set(id, fn); return id; }
function clearTimeout(id){ timeouts.delete(id); }
function requestAnimationFrame(fn){ var id = ++nextTimer; frames.set(id, fn); return id; }
function cancelAnimationFrame(id){ frames.delete(id); }
function runFrames(){ var list = Array.from(frames.values()); frames.clear(); list.forEach(function (fn) { fn(); }); }
function runIntervals(){ Array.from(intervals.values()).forEach(function (fn) { fn(); }); }
function runTimeouts(){ var list = Array.from(timeouts.values()); timeouts.clear(); list.forEach(function (fn) { fn(); }); }

/* ---- the worksheet the recorder sits on ---- */
var currentUser = { uid: 'teacher', getIdToken: async function(){ return 'test-token'; } }, currentDocId = 'worksheet', wsEpoch = 1, lastAnswerKey = null;
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
function recPickMime(withVideo){ return withVideo ? 'video/webm;codecs=vp8,opus' : 'audio/mp4'; }
function recExt(mime){ return /video\\/webm/.test(mime) ? 'webm' : /video\\/mp4/.test(mime) ? 'mp4' : 'm4a'; }
function recFmtTime(ms){ var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
var autoSaveInFlight = false, autoSaveTimer = null, autoSaveQueued = false, dirty = false, scheduled = 0, undoCount = 0;
function pushUndo(){ undoCount++; } function renderAllOverlays(){} function setDirty(v){ dirty = v; }
function scheduleAutoSave(){ scheduled++; } function pageStarFields(){ return { stars: [] }; }
async function writeAnnotations(docId, json, fields){ writes.push({ docId: docId, json: json, fields: fields }); if (failWrite) throw new Error('write refused'); }
var STORAGE_DIR = 'pdf-annotator', VIDEO_BTN_H = 30;
function asset(path){ return 'https://firebasestorage.googleapis.com/v0/b/mathgen--app.firebasestorage.app/o/' + encodeURIComponent(path) + '?alt=media'; }
// A Firebase upload task: awaitable, and it reports its progress.
var storage = { ref: function(path){ return { fullPath: path,
  put: function(blob, meta){
    var done = (async function () { uploads.push({ path: path, size: blob.size, type: meta && meta.contentType, blob: blob, text: path.endsWith('.json') ? await blob.text() : '' }); if (failUpload) throw new Error('offline'); })();
    return { then: done.then.bind(done), catch: done.catch.bind(done),
      on: function (name, next) { progress.push(path); next({ bytesTransferred: 42, totalBytes: 100 }); } };
  },
  getDownloadURL: async function(){ return asset(path); } }; } };
function confirm(){ return true; }
var liveOptions = null, liveClosed = 0;
var AnsKeyLive = { connect: async function(opts){ liveOptions = opts; return { close: async function(){ liveClosed++; } }; } };
window.liveAppCheckToken = async function(){ return 'test-appcheck'; };
function aiNotePageImage(){ return 'test-page-image'; } function aiGrounding(){ return 'grounded'; }
function tutorMethodRule(){ return 'Use arithmetic.'; } function aiEngineName(){ return 'Chung GPT'; }
var selectedId = null;
async function loadTeachingNotes(){}
window.askGemini = async function(){ return 'Short teaching explanation'; };
function ink(id){ return { id: id || 'ink', page: 1, type: 'pen', color: '#000', width: 2, points: [{x: 1, y: 1}] }; }
`;

function harness(setup = '') {
  const context = vm.createContext({ Blob, URL, TextEncoder, TextDecoder, AbortController, DOMException, atob, crypto: webcrypto,
    structuredClone, console, Float32Array, Uint8Array, tickTask: () => new Promise(resolve => setImmediate(resolve)) });
  vm.runInContext(bootstrap + setup + actual + `
lessonRecovery = async function(action, key, value) {
  if (action === 'put') recovery.set(key, structuredClone(value));
  if (action === 'delete') recovery.delete(key);
  return action === 'get' ? recovery.get(key) : undefined;
};
lessonPdfHash = async function(){ return 'pdf-hash'; };
var shippedStatus = lessonStatus;
lessonStatus = function (text) { statuses.push(text); shippedStatus(text); };
function savedManifest(){ var core = LessonReplayCore.createRecorder([ink()], { page: 1, x: 100, y: 120, zoom: 1.5 });
  var a = ink(); a.points.push({x: 20, y: 30}); core.capture(500, [a], {page: 2, x: 200, y: 220, zoom: 2});
  return { version: 1, worksheetId: currentDocId, pdfHash: 'pdf-hash', pageCount: pages.length, timeline: core.finish(1000) };
}
lessonReadManifest = async function(){ return savedManifest(); };
`, context);
  const h = {
    context,
    run: source => vm.runInContext(source, context),
    json: source => JSON.parse(vm.runInContext('JSON.stringify(' + source + ')', context)),
    async settle(n = 12) { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); }
  };
  return h;
}
const TEACHER_CAM = JSON.stringify({ id: 'cam-doc', label: 'Document Camera' });

/* ---------------------------------------------------------------------
   What each list offers, and where a choice lands — pure, every shape
   --------------------------------------------------------------------- */
test('the device lists are built from one enumeration, whatever shape the browser hands back', () => {
  const h = harness();
  const unnamed = h.json(`(function(){ var c = lessonDevOptions(UNNAMED, 'videoinput'), m = lessonDevOptions(UNNAMED, 'audioinput');
    return { cams: c, camNamed: c.named, mics: m, micNamed: m.named }; })()`);
  assert.deepEqual(unnamed.cams.map(o => o.value), ['', '__any__'], 'an unnamed camera is offered as "a camera", which is what asks');
  assert.equal(unnamed.camNamed, false);
  assert.deepEqual(unnamed.mics.map(o => o.value), [''], 'before access only the default microphone can be named');
  assert.equal(unnamed.micNamed, false);

  const chrome = h.json(`(function(){ var d = NAMED.concat([{ kind: 'audioinput', deviceId: 'communications', label: 'Communications - Desk Mic' },
      { kind: 'videoinput', deviceId: 'cam-front-2', label: 'Front Camera' }]);
    return { cams: lessonDevOptions(d, 'videoinput'), mics: lessonDevOptions(d, 'audioinput') }; })()`);
  assert.equal(chrome.mics[0].label, 'Default — Desk Mic', 'Chrome’s "default" alias names the default rather than appearing twice');
  assert.ok(!chrome.mics.some(o => o.value === 'default' || o.value === 'communications'), 'aliases are never offered as devices');
  assert.deepEqual(chrome.mics.map(o => o.value), ['', 'mic-desk', 'mic-usb']);
  assert.deepEqual(chrome.cams.map(o => o.label), ['No camera — voice and writing only', 'Front Camera', 'Document Camera', 'Front Camera (2)'],
    'two cameras of the same make can be told apart');

  const none = h.json(`(function(){ var c = lessonDevOptions([], 'videoinput'); return { cams: c, named: c.named }; })()`);
  assert.deepEqual(none.cams.map(o => o.value), [''], 'a laptop with no camera offers only "No camera"');
  assert.equal(none.named, true, 'an EMPTY list is a named one: nothing is being hidden');

  const nameless = h.json(`lessonDevOptions([{ kind: 'videoinput', deviceId: 'x1', label: '' }, { kind: 'audioinput', deviceId: 'y1', label: '' }], 'videoinput')`);
  assert.equal(nameless[1].label, 'Camera 1', 'an id with no name still gets a name a teacher can read');
});

test('a remembered device is found by its id, then by its NAME, and never swapped for another', () => {
  const h = harness();
  const r = h.json(`(function(){
    var named = lessonDevOptions(NAMED, 'videoinput'), unnamed = lessonDevOptions(UNNAMED, 'videoinput');
    var moved = lessonDevOptions(NAMED.map(function (d) { return d.deviceId === 'cam-doc' ? Object.assign({}, d, { deviceId: 'cam-doc-new-port' }) : d; }), 'videoinput');
    var mics = lessonDevOptions(NAMED, 'audioinput'), unnamedMics = lessonDevOptions(UNNAMED, 'audioinput');
    return {
      none: lessonDevResolve(named, null),
      byId: lessonDevResolve(named, { id: 'cam-doc', label: 'Document Camera' }),
      byName: lessonDevResolve(moved, { id: 'cam-doc', label: 'Document Camera' }),
      hidden: lessonDevResolve(unnamed, { id: 'cam-doc', label: 'Document Camera' }),
      missing: lessonDevResolve(named, { id: 'cam-gone', label: 'Old Webcam' }),
      anyHidden: lessonDevResolve(unnamed, { any: true }),
      anyNamed: lessonDevResolve(named, { any: true }),
      micHidden: lessonDevResolve(unnamedMics, { id: 'mic-usb', label: 'USB Mic' }),
      micMissing: lessonDevResolve(mics, { id: 'mic-gone', label: 'Headset' })
    }; })()`);
  assert.equal(r.none.value, '');
  assert.equal(r.byId.value, 'cam-doc');
  assert.deepEqual(r.byName, { value: 'cam-doc-new-port', missing: '', want: { id: 'cam-doc-new-port', label: 'Document Camera' } },
    'a camera plugged into another port comes back under its new id, and that id is what is remembered');
  assert.equal(r.hidden.value, '__any__', 'while the browser hides names the remembered camera opens as "a camera"');
  assert.equal(r.hidden.missing, '', 'nothing is MISSING from a list that is not named yet');
  assert.deepEqual([r.missing.value, r.missing.missing], ['', '“Old Webcam”'], 'a remembered camera that is not plugged in turns the camera OFF and is named');
  assert.equal(r.anyHidden.value, '__any__');
  assert.equal(r.anyNamed.value, 'cam-front', '"a camera" named since is the first camera, the one the browser would open');
  assert.deepEqual([r.micHidden.value, r.micHidden.missing], ['', ''], 'an unnamed microphone list leaves the default in place, missing nothing');
  assert.deepEqual([r.micMissing.value, r.micMissing.missing], ['', '“Headset”']);
  assert.equal(h.run("lessonDevResolve(lessonDevOptions(NAMED, 'videoinput'), { id: 'cam-gone', label: '' }).missing"), 'The camera you chose',
    'a remembered camera with no name is still said plainly, not quoted as if it were one');
});

test('the window says what a minute costs and how long one recording holds, from the real bitrates', () => {
  const h = harness();
  assert.equal(h.run('lessonSizeHint(false)'), 'Voice and writing only: under 1 MB a minute, so one recording holds about 1½ hours.');
  assert.equal(h.run('lessonSizeHint(true)'), 'Camera on: about 4.3 MB a minute, so one recording holds about 2 hours.');
  assert.equal(h.run('lessonPillWidth("Play lesson · 12:34")'), 180, 'an audio lesson’s pill is the width it always was');
  assert.ok(h.run('lessonPillWidth("Play video lesson · 1:02:03")') > 220, 'a long video label gets the room to be read');
});

/* ---------------------------------------------------------------------
   The window: nothing opened that was not asked for, everything let go
   --------------------------------------------------------------------- */
test('with nothing remembered the window opens the MICROPHONE only — the camera light never comes on', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  assert.equal(h.run("$('lessonModal').classList.contains('open')"), true);
  assert.deepEqual(h.json('gum.map(function (c) { return c.video ? "video" : "audio"; })'), ['audio'], 'no camera was asked for');
  const mic = h.json('gum[0].audio');
  assert.deepEqual([mic.echoCancellation, mic.noiseSuppression, mic.autoGainControl], [true, true, true],
    'the preview hears through the same processing as a lesson, so the sound test is honest');
  assert.equal(mic.deviceId, undefined, 'the default microphone, with no device forced');
  assert.equal(h.run("$('lessonCamSelect').value"), '');
  assert.match(h.run("$('lessonCamOffText').textContent"), /Camera off/);
  assert.equal(h.run("$('lessonMirrorRow').hidden"), true, 'no mirror switch without a camera');
  assert.match(h.run("$('lessonSizeHint').textContent"), /^Voice and writing only/);
  assert.equal(h.run("$('lessonTestBtn').disabled"), false, 'Test sound is ready once the microphone is');
  assert.deepEqual(h.json("$('lessonMicSelect').children.map(function (o) { return o.textContent; })"), ['Default — Desk Mic', 'Desk Mic', 'USB Mic']);
  assert.equal(h.run('focused'), h.run("$('lessonCard')"), 'the focus goes INTO the window, onto nothing Enter would press');
});

test('the level meter moves with a voice, and says so; a silent microphone earns a warning', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  h.run('runFrames();');
  assert.equal(h.run("$('lessonMeterFill').style.width"), '0%', 'silence reads as an empty bar');
  assert.match(h.run("$('lessonMicHint').textContent"), /Say something/);
  h.run('lessonDev.micSince -= 7000; runFrames();');
  assert.match(h.run("$('lessonMicHint').textContent"), /Nothing is coming through/, 'a muted headset reads like a quiet room — so it is said');
  h.run('level = 0.1; runFrames();');   // -20 dBFS: a teacher talking
  const width = parseFloat(h.run("$('lessonMeterFill').style.width"));
  assert.ok(width > 55 && width < 75, 'speech fills the bar on a decibel scale, not a sliver: ' + width);
  assert.match(h.run("$('lessonMicHint').textContent"), /can hear you/);
  assert.equal(h.run("$('lessonMicHint').className"), 'lessonDevHint ok');
  assert.equal(h.run("$('lessonMeter').attrs['aria-valuenow']"), String(Math.round(width)));
  h.run('level = 0; runFrames();');
  assert.ok(parseFloat(h.run("$('lessonMeterFill').style.width")) > 40, 'the bar falls gently rather than blinking out between words');
  assert.equal(h.run('contexts[0].feeds.length'), 1);
  assert.equal(h.run('contexts[0].analysers'), 1, 'the meter measures one microphone and plays nothing');
});

test('a remembered camera opens with the microphone, EXACTLY, and the preview is mirrored', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('lessonOpenModal();');
  await h.settle();
  const video = h.json('gum.filter(function (c) { return c.video; })');
  assert.equal(video.length, 1, 'one camera, opened once');
  assert.deepEqual(video[0].video.deviceId, { exact: 'cam-doc' });
  assert.deepEqual([video[0].video.width.ideal, video[0].video.height.ideal], [640, 360], 'the preview shows the framing the recording will have');
  assert.equal(h.run("$('lessonCamSelect').value"), 'cam-doc');
  assert.equal(h.run("$('lessonCamPreview').srcObject === lessonDev.camStream"), true);
  assert.equal(h.run("$('lessonCamPreview').hidden"), false);
  assert.equal(h.run("$('lessonCamPreview').classList.contains('mirror')"), true, 'mirrored by default, like every video call');
  assert.match(h.run("$('lessonSizeHint').textContent"), /^Camera on/);
  h.run("$('lessonMirror').checked = false; $('lessonMirror').emit('change');");
  assert.equal(h.run("$('lessonCamPreview').classList.contains('mirror')"), false, 'a document camera can switch the mirror off');
  assert.equal(h.run("store.get('polymath.lessonMirror')"), 'false', 'and that is remembered on the device');
});

test('choosing another camera lets go of the first BEFORE opening the next; "No camera" turns the light off', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('lessonOpenModal();');
  await h.settle();
  const first = h.run('lessonDev.camStream.getVideoTracks()[0]');
  h.run("log.length = 0; $('lessonCamSelect').value = 'cam-front'; $('lessonCamSelect').emit('change');");
  await h.settle();
  const order = h.json('log').filter(entry => /^(stop:video|gum:video)/.test(entry));
  assert.deepEqual(order, ['stop:video:cam-doc', 'gum:video'], 'the old camera is released first, never two at once');
  assert.equal(first.readyState, 'ended');
  assert.equal(h.run('JSON.parse(store.get("polymath.lessonCamera")).id'), 'cam-front', 'the choice is remembered');
  h.run("$('lessonCamSelect').value = ''; $('lessonCamSelect').emit('change');");
  await h.settle();
  assert.equal(h.run('lessonDev.camStream'), null);
  assert.equal(h.run('opened.filter(function (s) { return s.getVideoTracks().length; }).every(function (s) { return s.getVideoTracks()[0].readyState === "ended"; })'), true,
    'every camera the window opened is closed');
  assert.equal(h.run("store.has('polymath.lessonCamera')"), false, '"No camera" is remembered as no camera');
  assert.equal(h.run("$('lessonCamPreview').hidden"), true);
});

test('choosing another microphone reopens it exactly, and the old one and its meter are let go', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  const firstMic = h.run('lessonDev.micStream.getAudioTracks()[0]'), firstCtx = h.run('contexts[0]');
  h.run("$('lessonMicSelect').value = 'mic-usb'; $('lessonMicSelect').emit('change');");
  await h.settle();
  assert.deepEqual(h.json('gum[gum.length - 1].audio.deviceId'), { exact: 'mic-usb' });
  assert.equal(firstMic.readyState, 'ended');
  assert.equal(firstCtx.state, 'closed', 'the old meter’s audio context is closed, not left running');
  assert.equal(h.run('lessonDev.micId'), 'mic-usb');
  assert.equal(h.run('JSON.parse(store.get("polymath.lessonMic")).label'), 'USB Mic');
});

test('a remembered camera that is not plugged in is OFF and named — and comes back by itself when it is', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}'); removed.add('cam-doc'); devices = NAMED.filter(function (d) { return d.deviceId !== 'cam-doc'; });`);
  h.run('lessonOpenModal();');
  await h.settle();
  assert.equal(h.run('gum.filter(function (c) { return c.video; }).length'), 0, 'the laptop’s own lens is NOT quietly used instead');
  assert.equal(h.run("$('lessonCamSelect').value"), '');
  assert.match(h.run("$('lessonCamOffText').textContent"), /“Document Camera” is not connected/);
  h.run("plugIn('cam-doc'); runTimeouts();");
  await h.settle();
  assert.equal(h.run("$('lessonCamSelect').value"), 'cam-doc', 'plugged back in, it is chosen again');
  assert.equal(h.run('lessonDev.camState'), 'live');
  h.run("unplug('cam-doc'); runTimeouts();");
  await h.settle();
  assert.equal(h.run('lessonDev.camStream'), null, 'pulled out mid-preview, the camera turns off');
  assert.match(h.run("$('lessonCamOffText').textContent"), /not connected/);
});

test('before access is allowed a remembered camera opens as "a camera", and is named once it has', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}'); devices = UNNAMED.slice();`);
  h.run('lessonOpenModal();');
  await h.settle();
  const video = h.json('gum.filter(function (c) { return c.video; })');
  assert.equal(video.length, 1, 'opened once — naming it afterwards does not reopen it');
  assert.deepEqual(video[0].video.deviceId, { ideal: 'cam-doc' }, 'leaning towards the remembered camera without insisting on an id the browser has hidden');
  assert.equal(h.run("$('lessonCamSelect').value"), 'cam-doc', 'the list names it now that access is allowed');
  assert.deepEqual(h.json('JSON.parse(store.get("polymath.lessonCamera"))'), { id: 'cam-doc', label: 'Document Camera' });
});

test('closing the window lets go of EVERYTHING it holds, however it closes', async () => {
  for (const close of ["lessonCloseModal();", "$('lessonCancelBtn').emit('click');", "$('lessonCloseBtn').emit('click');",
    "currentUser = { uid: 'student' }; admin = false; lessonRoleChanged();", "window.emit('pagehide');"]) {
    const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
    h.run('lessonOpenModal();');
    await h.settle();
    h.run('runFrames();');
    assert.equal(h.run('liveTracks()'), 2, 'camera and microphone were live');
    h.run(close);
    assert.equal(h.run('liveTracks()'), 0, 'nothing is still capturing after: ' + close);
    assert.equal(h.run('contexts.every(function (c) { return c.state === "closed"; })'), true, 'the meter is closed after: ' + close);
    assert.equal(h.run('frames.size'), 0, 'and it has stopped drawing after: ' + close);
    assert.equal(h.run("$('lessonModal').classList.contains('open')"), false);
  }
});

test('a camera allowed AFTER the window closed is let go at once — its light never stays on', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('var late = deferred(); gumWait.video = late; lessonOpenModal();');
  await h.settle();
  assert.equal(h.run('lessonDev.camState'), 'opening');
  h.run('lessonCloseModal(); late.resolve();');
  await h.settle();
  assert.equal(h.run('liveTracks()'), 0);
  assert.equal(h.run('lessonDev.camStream'), null);
});

test('a refused or busy camera says so in the window, and is not retried in a loop', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}'); gumFail.video = { name: 'NotReadableError' };`);
  h.run('lessonOpenModal();');
  await h.settle();
  assert.equal(h.run('lessonDev.camState'), 'error');
  assert.match(h.run("$('lessonCamOffText').textContent"), /busy/);
  assert.equal(h.run("$('lessonCamRetry').hidden"), false, 'a Try again button is offered');
  const tries = h.run('gum.filter(function (c) { return c.video; }).length');
  h.run("plugIn('mic-usb'); runTimeouts();");   // any later device list
  await h.settle();
  assert.equal(h.run('gum.filter(function (c) { return c.video; }).length'), tries, 'a failed camera is not reopened by itself');
  h.run("delete gumFail.video; $('lessonCamRetry').emit('click');");
  await h.settle();
  assert.equal(h.run('lessonDev.camState'), 'live', 'Try again reopens it');
  const denied = harness(`gumFail.audio = { name: 'NotAllowedError' };`);
  denied.run('lessonOpenModal();');
  await denied.settle();
  assert.match(denied.run("$('lessonMicHint').textContent"), /not allowed the microphone/);
  assert.equal(denied.run("$('lessonMicHint').className"), 'lessonDevHint bad');
  assert.equal(denied.run("$('lessonTestBtn').disabled"), true, 'no sound test without a microphone');
  assert.equal(denied.run("$('lessonMicRetry').hidden"), false);
});

/* ---------------------------------------------------------------------
   🔊 The sound test
   --------------------------------------------------------------------- */
test('Test sound records a few seconds and plays them straight back, then lets go', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  h.run("$('lessonTestBtn').emit('click');");
  assert.equal(h.run('recorders.length'), 1);
  assert.equal(h.run('recorders[0].stream === lessonDev.micStream'), true, 'the test records the very microphone the window shows');
  assert.equal(h.run('recorders[0].options.mimeType'), 'audio/mp4');
  assert.match(h.run("$('lessonTestBtn').textContent"), /Listening… 4/);
  assert.match(h.run("$('lessonMicHint').textContent"), /Recording a short test/);
  h.run('runIntervals(); runIntervals(); runIntervals();');
  assert.match(h.run("$('lessonTestBtn').textContent"), /Listening… 1/);
  h.run('runIntervals();');
  assert.equal(h.run('recorders[0].pendingStop'), true, 'four seconds, then it stops by itself');
  await h.run('recorders[0].finishStop();');
  assert.match(h.run("$('lessonTestAudio').src"), /^blob:/, 'played back from memory — nothing is uploaded');
  assert.equal(h.run("$('lessonTestAudio').paused"), false);
  assert.match(h.run("$('lessonMicHint').textContent"), /Playing it back/);
  assert.equal(h.run("$('lessonTestBtn').textContent"), '■ Stop');
  const url = h.run("$('lessonTestAudio').src");
  h.run("$('lessonTestAudio').onended();");
  assert.equal(h.run('lessonDev.test'), null);
  assert.match(h.run("$('lessonMicHint').textContent"), /how you will sound/);
  assert.equal(h.run("$('lessonTestAudio').src"), '');
  assert.throws(() => h.run(`URL.revokeObjectURL('${url}'); (function(){ throw new Error('revoked'); })()`), /revoked/);
  assert.equal(h.run('liveTracks()'), 1, 'the microphone is still open for the meter');
});

test('pressing Test sound while it listens stops early and still plays back; closing the window ends a test at once', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  h.run("$('lessonTestBtn').emit('click'); runIntervals(); $('lessonTestBtn').emit('click');");
  assert.equal(h.run('recorders[0].pendingStop'), true);
  await h.run('recorders[0].finishStop();');
  assert.equal(h.run("$('lessonTestAudio').paused"), false, 'what was said is still played back');
  h.run('lessonCloseModal();');
  assert.equal(h.run('lessonDev.test'), null);
  assert.equal(h.run("$('lessonTestAudio').paused"), true, 'closing the window silences the playback');
  assert.equal(h.run('liveTracks()'), 0);

  const mid = harness();
  mid.run('lessonOpenModal();');
  await mid.settle();
  mid.run("$('lessonTestBtn').emit('click'); lessonCloseModal();");
  assert.equal(mid.run('recorders[0].state'), 'inactive', 'a test still listening is stopped with the window');
  assert.equal(mid.run('recorders[0].onstop'), null, 'and it never plays back into a closed window');
});

/* ---------------------------------------------------------------------
   🎥 Recording with the camera
   --------------------------------------------------------------------- */
async function recordWithCamera(h) {
  h.run('lessonOpenModal();');
  await h.settle();
  h.run("$('lessonMicSelect').value = 'mic-usb'; $('lessonMicSelect').emit('change');");
  await h.settle();
  h.run('log.length = 0; gum.length = 0;');
  await h.run('lessonStart();');
}

test('Start lets go of the preview FIRST, then records the chosen camera and microphone into ONE file', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  await recordWithCamera(h);
  const order = h.json('log').filter(entry => /^(stop:|gum:)/.test(entry));
  const firstGum = order.findIndex(entry => entry.startsWith('gum:'));
  assert.ok(order.slice(0, firstGum).includes('stop:video:cam-doc') && order.slice(0, firstGum).includes('stop:audio:mic-usb'),
    'both preview devices are released before the recording asks for its own: ' + order.join(', '));
  assert.deepEqual(h.json('gum.map(function (c) { return c.video ? "video" : "audio"; })'), ['audio', 'video']);
  const mic = h.json('gum[0].audio'), cam = h.json('gum[1].video');
  assert.deepEqual(mic.deviceId, { exact: 'mic-usb' }, 'the microphone that was tested is the one recorded');
  assert.equal(mic.noiseSuppression, true);
  assert.deepEqual(cam.deviceId, { exact: 'cam-doc' }, 'the camera that was previewed is the one recorded');
  assert.equal(h.run("$('lessonModal').classList.contains('open')"), false);
  const rec = h.run('recorders[recorders.length - 1]');
  assert.equal(h.run('recorders[recorders.length - 1].stream.getVideoTracks().length'), 1);
  assert.equal(h.run('recorders[recorders.length - 1].stream.getVideoTracks()[0] === lessonCapture.camStream.getVideoTracks()[0]'), true);
  assert.equal(h.run('recorders[recorders.length - 1].stream.getAudioTracks().length'), 1);
  assert.equal(h.run('recorders[recorders.length - 1].stream.getAudioTracks()[0] === lessonCapture.destination.stream.getAudioTracks()[0]'), true,
    'the audio is the MIXED track, the same an audio-only lesson carries — never the raw microphone beside it');
  assert.equal(h.run('lessonCapture.audioCtx.sources'), 1, 'the recording mixes the microphone and nothing else');
  assert.deepEqual([rec.options.videoBitsPerSecond, rec.options.audioBitsPerSecond, rec.options.mimeType], [500000, 96000, 'video/webm;codecs=vp8,opus']);
  assert.equal(h.run("$('lessonLiveCam').srcObject === lessonCapture.camStream"), true, 'the teacher sees themselves in the recording bar');
  assert.equal(h.run("$('lessonLiveCam').hidden"), false);
  assert.equal(h.run("$('lessonLiveCam').classList.contains('mirror')"), true);
  h.run('recorders[recorders.length - 1].fireStart();');
  assert.match(h.run("$('lessonStatus').textContent"), /^Recording you and your explanation/);
});

test('a video lesson is saved as a video: its own file type, its own label, its own flag', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  await recordWithCamera(h);
  h.run('var r = recorders[recorders.length - 1]; r.fireStart(); now = 62000; annotations = [ink()]; setDirty(true); lessonCaptureTick(); lessonStop();');
  await h.run('r.finishStop();');
  await h.settle();
  const media = h.json('uploads[0]');
  assert.match(media.path, /^pdf-annotator\/lesson-worksheet-lesson\d+\.webm$/);
  assert.match(media.type, /^video\/webm/, 'uploaded as the video it is');
  const sent = Buffer.from(await h.run('uploads[0].blob.arrayBuffer()'));
  assert.ok(sent.includes(Buffer.from([0x44, 0x89, 0x88])), 'the WebM went through the finalizer and is seekable: it carries a Duration');
  const pill = h.json('annotations.filter(function (a) { return a.lessonRecording; })[0]');
  assert.equal(pill.lessonRecording.video, true);
  assert.equal(pill.label, 'Play video lesson · 1:02');
  assert.equal(pill.w, h.run('lessonPillWidth("Play video lesson · 1:02")'));
  assert.ok(pill.w > 180);
  assert.ok(h.run('messages.some(function (m) { return m.indexOf("Video lesson saved") === 0; })'));
  assert.ok(h.json('statuses').includes('Uploading the lesson video… 42%'), 'a long upload says how far along it is');
  assert.equal(h.run('liveTracks()'), 0, 'the camera and the microphone are both released when it is saved');
  assert.equal(h.run("$('lessonLiveCam').hidden"), true);
  assert.equal(h.run("$('lessonLiveCam').srcObject"), null);
});

test('an audio lesson is saved exactly as it always was', async () => {
  const h = harness();
  h.run('lessonOpenModal();');
  await h.settle();
  await h.run('lessonStart();');
  assert.equal(h.run('gum.filter(function (c) { return c.video; }).length'), 0);
  h.run('var r = recorders[recorders.length - 1]; r.fireStart(); now = 1500; lessonStop();');
  assert.equal(h.run('r.stream === lessonCapture.destination.stream'), true, 'the recorder still gets the mixed audio stream itself');
  assert.equal(h.run('r.options.videoBitsPerSecond'), undefined);
  await h.run('r.finishStop();');
  await h.settle();
  const pill = h.json('annotations.filter(function (a) { return a.lessonRecording; })[0]');
  assert.equal(Object.prototype.hasOwnProperty.call(pill.lessonRecording, 'video'), false, 'no new field on an audio lesson');
  assert.equal(pill.label, 'Play lesson · 0:01');
  assert.equal(pill.w, 180);
  assert.ok(h.json('statuses').includes('Uploading the lesson… 42%'));
});

test('a camera that disconnects mid-lesson stops the recording and SAVES what was captured', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  await recordWithCamera(h);
  h.run('var r = recorders[recorders.length - 1]; r.fireStart(); now = 4000; lessonCaptureTick(); lessonCapture.camStream.getVideoTracks()[0].end();');
  assert.equal(h.run('lessonCapture.phase'), 'stopping');
  assert.match(h.run("$('lessonStatus').textContent"), /camera disconnected/);
  await h.run('r.finishStop();');
  await h.settle();
  assert.equal(h.run('annotations.filter(function (a) { return a.lessonRecording && a.lessonRecording.video; }).length'), 1);
});

test('a camera refused at Start stops the start LOUDLY and releases the microphone', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('lessonOpenModal();');
  await h.settle();
  h.run("gumFail.video = { name: 'NotAllowedError' };");
  await h.run('lessonStart();');
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('recorders.length'), 0, 'nothing was recorded in the teacher’s belief that they were on camera');
  assert.equal(h.run('liveTracks()'), 0, 'the microphone it had opened is let go');
  assert.ok(h.run('messages.some(function (m) { return /not allowed the camera/.test(m) && /No camera/.test(m); })'),
    'the message names the camera and the way to record without one');
  assert.equal(h.run("$('lessonBar').hidden"), true);
});

test('a camera still busy from the preview is asked for once more before the start is refused', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('lessonOpenModal();');
  await h.settle();
  h.run("gumFail.video = { name: 'NotReadableError', once: true }; var starting = lessonStart();");
  await h.settle();
  assert.equal(h.run('timeouts.size') >= 1, true, 'a short pause, not an immediate second try');
  h.run('runTimeouts();');
  await h.run('starting');
  assert.equal(h.run('lessonCapture && lessonCapture.camStream ? "camera" : "none"'), 'camera');
  assert.equal(h.run('gum.filter(function (c) { return c.video; }).length'), 3, 'preview, the busy try and the retry');
  const denied = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  denied.run('lessonOpenModal();');
  await denied.settle();
  denied.run("gumFail.video = { name: 'NotAllowedError' };");
  await denied.run('lessonStart();');
  assert.equal(denied.run('timeouts.size'), 0, 'a REFUSAL is never retried');
});

test('cancelling while the camera permission is still open releases the microphone AND the late camera', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  h.run('lessonOpenModal();');
  await h.settle();
  h.run('var late = deferred(); gumWait.video = late; var starting = lessonStart();');
  await h.settle();
  assert.equal(h.run('lessonCapture.phase'), 'starting');
  h.run('lessonStop(); late.resolve();');
  await h.run('starting');
  await h.settle();
  assert.equal(h.run('lessonCapture'), null);
  assert.equal(h.run('recorders.length'), 0);
  assert.equal(h.run('liveTracks()'), 0, 'the camera answered after the cancel, and was stopped at once');
});

test('a video recording stops at the VIDEO ceiling less its slack, and an audio one at its own', async () => {
  const h = harness(`store.set('polymath.lessonCamera', '${TEACHER_CAM}');`);
  await recordWithCamera(h);
  h.run('var r = recorders[recorders.length - 1]; r.fireStart(); now = 1000; lessonCapture.bytes = 70 * 1024 * 1024; lessonCaptureTick();');
  assert.equal(h.run('lessonCapture.phase'), 'recording', '70 MB of video is nowhere near full');
  h.run('now = 2000; lessonCapture.bytes = LESSON_VIDEO_LIMIT - LESSON_BYTES_SLACK; lessonCaptureTick();');
  assert.equal(h.run('lessonCapture.phase'), 'stopping');
  const a = harness();
  await a.run('lessonStart();');
  a.run('recorders[0].fireStart(); now = 1000; lessonCapture.bytes = LESSON_AUDIO_LIMIT - LESSON_BYTES_SLACK - 1; lessonCaptureTick();');
  assert.equal(a.run('lessonCapture.phase'), 'recording');
  a.run('now = 2000; lessonCapture.bytes += 1; lessonCaptureTick();');
  assert.equal(a.run('lessonCapture.phase'), 'stopping', 'stopped SHORT of the finalizer’s own ceiling, with room for the last chunk');
});

/* ---------------------------------------------------------------------
   ▶ The replay
   --------------------------------------------------------------------- */
test('a video lesson replays in its own window, and its VIDEO is the clock the writing follows', async () => {
  const h = harness();
  const pill = `{ url: asset('pdf-annotator/lesson-worksheet-test.webm'), lessonRecording: { video: true, manifestUrl: asset('pdf-annotator/lesson-worksheet-test.json') } }`;
  await h.run(`lessonPlay(${pill});`);
  assert.match(h.run("$('lessonVideo').src"), /lesson-worksheet-test\.webm/);
  assert.equal(h.run("$('lessonAudio').src"), '', 'the audio bar is not handed a second copy of the same sound');
  assert.equal(h.run("$('lessonAudio').hidden"), true);
  assert.equal(h.run("$('lessonCamWin').hidden"), false);
  assert.equal(h.run("$('lessonVideo').paused"), false, 'it starts playing');
  assert.match(h.run("$('lessonPlayerTitle').textContent"), /follows the video/);
  assert.equal(h.run("$('lessonCamWin').style.right"), '16px', 'it opens in the corner');
  assert.equal(h.run('scale'), 1.5);
  h.run("$('lessonVideo').currentTime = 0.6; $('lessonVideo').emit('timeupdate');");
  assert.equal(h.run('scale'), 2, 'the page follows the VIDEO’s clock');
  assert.equal(h.run('lessonPlayback.overlays[0].children[0].annotation.points.length'), 2);
  h.run("$('lessonAudio').currentTime = 0.1; $('lessonAudio').emit('timeupdate');");
  assert.equal(h.run('scale'), 2, 'the idle audio element never moves the replay');
  h.run('lessonExitPlayback();');
  assert.equal(h.run("$('lessonCamWin').hidden"), true);
  assert.equal(h.run("$('lessonVideo').src"), '');
  assert.equal(h.run("$('lessonVideo').paused"), true);
  assert.equal(h.run("$('lessonAudio').hidden"), false, 'the audio bar is back for the next lesson');
});

test('an audio lesson replays exactly as before, with no video window', async () => {
  const h = harness();
  await h.run(`lessonPlay({ url: asset('pdf-annotator/lesson-worksheet-test.m4a'), lessonRecording: { manifestUrl: asset('pdf-annotator/lesson-worksheet-test.json') } });`);
  assert.match(h.run("$('lessonAudio').src"), /\.m4a/);
  assert.equal(h.run("$('lessonVideo').src"), '');
  assert.equal(h.run("$('lessonCamWin').hidden"), true);
  h.run("$('lessonAudio').currentTime = 0.6; $('lessonAudio').emit('timeupdate');");
  assert.equal(h.run('scale'), 2);
  h.run('lessonExitPlayback();');
});

test('while a lesson replays, the video window stays live and the page stays inert', async () => {
  const h = harness();
  await h.run(`lessonPlay({ url: asset('pdf-annotator/lesson-worksheet-test.webm'), lessonRecording: { video: true, manifestUrl: asset('pdf-annotator/lesson-worksheet-test.json') } });`);
  const event = inside => h.run(`(function(){ var e = { prevented: 0, stopped: 0,
    target: { closest: function (sel) { return ${JSON.stringify(inside)} && sel.indexOf(${JSON.stringify(inside)}) >= 0 ? {} : null; } },
    preventDefault: function(){ this.prevented++; }, stopImmediatePropagation: function(){ this.stopped++; }, stopPropagation: function(){ this.stopped++; } };
    document.emit('pointerdown', e); return e.prevented; })()`);
  assert.equal(event('#lessonCamWin'), 0, 'the video window’s own controls and drag bar work');
  assert.equal(event('#lessonPlayer'), 0);
  assert.equal(event(''), 1, 'the worksheet underneath stays untouchable');
});

test('the video window is dragged by its bar, kept on the screen, and comes in three remembered sizes', async () => {
  const h = harness();
  await h.run(`lessonPlay({ url: asset('pdf-annotator/lesson-worksheet-test.webm'), lessonRecording: { video: true, manifestUrl: asset('pdf-annotator/lesson-worksheet-test.json') } });`);
  h.run("$('lessonCamWin').clientHeight = 200;");
  assert.equal(h.run("$('lessonCamWin').style.width"), '320px');
  h.run("$('lessonCamWinBar').emit('pointerdown', { button: 0, pointerId: 7, clientX: 900, clientY: 500, target: {}, preventDefault: function(){} });");
  assert.equal(h.run("$('lessonCamWin').classList.contains('dragging')"), true);
  h.run("$('lessonCamWinBar').emit('pointermove', { pointerId: 7, clientX: 5000, clientY: -300 });");
  assert.equal(h.run("$('lessonCamWin').style.left"), (1200 - 320 - 8) + 'px', 'dragged past the edge, it stops at the edge');
  assert.equal(h.run("$('lessonCamWin').style.top"), '8px');
  h.run("$('lessonCamWinBar').emit('pointerup', { pointerId: 7 });");
  assert.equal(h.run("$('lessonCamWin').classList.contains('dragging')"), false);
  h.run("$('lessonCamWinSize').emit('click');");
  assert.equal(h.run("$('lessonCamWin').style.width"), '480px');
  assert.equal(h.run("store.get('polymath.lessonCamWin')"), '2', 'the size is remembered on the device');
  assert.equal(h.run("$('lessonCamWin').style.left"), (1200 - 480 - 8) + 'px', 'growing near the edge keeps it on the screen');
  h.run("$('lessonCamWinSize').emit('click');");
  assert.equal(h.run("$('lessonCamWin').style.width"), '200px');
  h.run("window.innerWidth = 180; window.emit('resize');");
  assert.equal(h.run("$('lessonCamWin').style.width"), '160px', 'a phone never gets a window wider than itself');
});

/* ---------------------------------------------------------------------
   The wiring that keeps the AI out of a recording covers this window too
   --------------------------------------------------------------------- */
test('the device window never reaches the live helper', () => {
  assert.equal(deviceSection.includes('AnsKeyLive'), false, 'the window cannot open a live session');
  assert.equal(deviceSection.includes('onRemoteStream'), false, 'no assistant audio can reach the sound test');
  assert.equal(deviceSection.includes('voiceLive'), false);
  // The sound test plays through an ordinary element — never an AudioContext
  // destination, which is how a reply once found its way into a recording.
  assert.equal(/\.connect\([^)]*destination/.test(deviceSection), false);
});

test('a meter the browser has not let start yet asks for a tap, and never blames the microphone', async () => {
  const h = harness();
  h.run("Context.prototype.resume = function () { return Promise.resolve(); };");   // Safari: a resume outside a tap does nothing
  h.run("var realContext = Context; window.AudioContext = function () { var c = new realContext(); c.state = 'suspended'; return c; };");
  h.run('lessonOpenModal();');
  await h.settle();
  h.run('lessonDev.micSince -= 60000; runFrames();');
  assert.match(h.run("$('lessonMicHint').textContent"), /Tap anywhere in this window/);
  assert.doesNotMatch(h.run("$('lessonMicHint').textContent"), /Nothing is coming through/, 'a sleeping meter is not a silent microphone');
  h.run("lessonDev.ctx.resume = function () { this.state = 'running'; return Promise.resolve(); }; $('lessonModal').emit('pointerdown');");
  await h.settle();
  h.run('level = 0.1; runFrames();');
  assert.match(h.run("$('lessonMicHint').textContent"), /can hear you/, 'one tap in the window wakes it');
});
