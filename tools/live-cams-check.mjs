/* =====================================================================
   📹 LIVE CAMS — a real teacher and a real student, in a real browser
   ---------------------------------------------------------------------
   tools/live-cams-tests.mjs pins the arithmetic. What no reading of the
   source can say is whether a browser really opens the camera, really
   carries it over WebRTC to the teacher's tile, really falls back to
   snapshots when WebRTC is missing, and really lets go of the camera on
   every way out.

   One page holds BOTH sides: a teacher controller and a student
   controller made by LiveCams.create with different id prefixes, joined
   by an in-memory stand-in for Firestore that delivers its snapshots
   asynchronously, the way the real one does. Chromium's fake camera is
   the student's camera; the WebRTC connection between the two is real.

     node tools/live-cams-check.mjs
     PW=/path/to/playwright/index.mjs node tools/live-cams-check.mjs
     SHOTS=/some/dir node tools/live-cams-check.mjs     # keep screenshots
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('live-cams-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

/* ---------------- the harness page ---------------- */
const FAKE_DB = String.raw`
window.makeFakeDb = function () {
  const docs = new Map();            // path → data
  const listeners = new Set();       // { match(path) → bool, fire() }
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const UNION = '__arrayUnion';
  window.__dbWrites = 0;
  function schedule() {
    for (const l of listeners) setTimeout(() => { if (listeners.has(l)) l.fire(); }, 5);
  }
  function apply(base, patch) {
    const out = Object.assign({}, base);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && v[UNION]) {
        const cur = Array.isArray(out[k]) ? out[k].slice() : [];
        v[UNION].forEach(x => { if (!cur.includes(x)) cur.push(x); });
        out[k] = cur;
      } else out[k] = clone(v);
    }
    return out;
  }
  function docSnap(p) {
    const id = p.split('/').pop();
    const data = docs.get(p);
    return { id, exists: docs.has(p), data: () => clone(data), ref: docRef(p) };
  }
  function children(coll) {
    const out = [];
    for (const p of docs.keys()) {
      if (p.startsWith(coll + '/') && p.slice(coll.length + 1).indexOf('/') === -1) out.push(p);
    }
    return out.sort();
  }
  function querySnap(coll, filter) {
    const list = children(coll).filter(p => !filter || docs.get(p)[filter.f] === filter.v).map(docSnap);
    return { docs: list, size: list.length, forEach: fn => list.forEach(fn) };
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      collection: name => collRef(p + '/' + name),
      async set(data, opts) {
        window.__dbWrites++;
        docs.set(p, opts && opts.merge ? apply(docs.get(p) || {}, data) : apply({}, data));
        schedule();
      },
      async update(data) {
        window.__dbWrites++;
        if (!docs.has(p)) { const e = new Error('No document to update: ' + p); e.code = 'not-found'; throw e; }
        docs.set(p, apply(docs.get(p), data));
        schedule();
      },
      async delete() { window.__dbWrites++; docs.delete(p); schedule(); },
      async get() { return docSnap(p); },
      onSnapshot(cb) {
        const l = { fire: () => cb(docSnap(p)) };
        listeners.add(l); setTimeout(() => { if (listeners.has(l)) l.fire(); }, 5);
        return () => listeners.delete(l);
      }
    };
  }
  function query(coll, filter) {
    return {
      async get() { return querySnap(coll, filter); },
      onSnapshot(cb) {
        const l = { fire: () => cb(querySnap(coll, filter)) };
        listeners.add(l); setTimeout(() => { if (listeners.has(l)) l.fire(); }, 5);
        return () => listeners.delete(l);
      }
    };
  }
  function collRef(c) {
    const q = query(c, null);
    return {
      doc: id => docRef(c + '/' + id),
      where: (f, op, v) => query(c, { f, v }),
      get: q.get, onSnapshot: q.onSnapshot
    };
  }
  return {
    collection: name => collRef(name),
    arrayUnion: (...items) => ({ [UNION]: items }),
    _docs: docs,
    _peek: p => clone(docs.get(p))
  };
};
`;

const HARNESS = (studentRtc) => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  :root { --bg:#fff; --bg-viewer:#F3F2F0; --ink:#1A1A1A; --ink-soft:#55554F; --ink-faint:#8A8A84;
          --accent-deep:#E8A54B; --line:#ECECEA; --danger:#E53935; --ok:#43A047; --radius:14px; --radius-sm:10px; }
  body { font-family: sans-serif; margin: 0; background: #fafafa; }
  .btn { padding: 8px 14px; border-radius: 10px; border: 1px solid #ddd; background: #fff; cursor: pointer; display:inline-flex; }
  .btnPrimary { background: #FFCC80; }
  .modalBack.floatWin { display:none; position: fixed; inset: 0; pointer-events: none; }
  .modalBack.floatWin.open { display:block; }
  .modalBack.floatWin .modalCard { pointer-events:auto; position: fixed; display:flex; flex-direction:column; border-radius: 14px; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
  .modalHead { display:flex; justify-content: space-between; align-items:center; padding: 14px 18px; border-bottom: 1px solid #eee; }
  .modalClose { border:none; background:none; font-size:16px; cursor:pointer; width:30px; height:30px; }
  .modalBack.floatWin.winMin .modalBody { display:none; }
  /* Both sides share one page here; in the app they are on different
     devices. The student's preview goes bottom-LEFT so it never sits over
     the teacher's window (which opens on the right). */
  #studentHost .lcSelf { right: auto; left: 18px; }
</style>
<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'live-cams.css')).href}">
</head><body>
<div id="teacherHost"></div><div id="studentHost"></div>
<script>${FAKE_DB}</script>
<script src="${pathToFileURL(path.join(ROOT, 'live-cams.js')).href}"></script>
<script>
  window.db = makeFakeDb();
  window.toasts = [];
  window.roles = { t: 'teacher', s: 'student' };
  window.pinned = [];
  window.teacher = LiveCams.create({
    prefix: 'lt', db, arrayUnion: db.arrayUnion,
    role: () => roles.t, user: () => ({ uid: 'teacher-uid', name: 'Teacher' }),
    toast: m => toasts.push('T: ' + m), mount: document.getElementById('teacherHost'),
    putOnPage: async blob => { pinned.push(blob.size + ':' + blob.type); return 1; }
  });
  window.student = LiveCams.create({
    prefix: 'ls', db, arrayUnion: db.arrayUnion,
    role: () => roles.s, user: () => ({ uid: 'student-uid', name: 'Ada Lovelace', ws: { id: 'ws1', name: 'P5 Science WS3' } }),
    toast: m => toasts.push('S: ' + m), mount: document.getElementById('studentHost')
    ${studentRtc ? '' : ', RTCPeerConnection: null'}
  });
  teacher.roleChanged();
  student.roleChanged();
</script>
</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-cams-check-'));
const pageRtc = path.join(tmp, 'rtc.html');
const pageSnap = path.join(tmp, 'snap.html');
fs.writeFileSync(pageRtc, HARNESS(true));
fs.writeFileSync(pageSnap, HARNESS(false));

const browser = await chromium.launch({ args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, permissions: ['camera'] });

async function freshPage(file) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    const opened = window.__opened = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { const s = await real(c); opened.push(s); return s; };
    window.__live = () => opened.reduce((n, s) => n + s.getTracks().filter(t => t.readyState === 'live').length, 0);
  });
  await page.goto(pathToFileURL(file).href);
  return { page, errors };
}
const until = async (page, fn, arg, ms = 20000) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (e) { return false; }
};

try {
  /* ============ 1. WebRTC: teacher opens, student shares, video arrives ============ */
  console.log('WebRTC path');
  {
    const { page, errors } = await freshPage(pageRtc);
    await page.waitForTimeout(200);
    ok('no invitation while the room is closed', !(await page.evaluate(() => student.state().student.invite)));
    ok('nothing opened a camera on load', (await page.evaluate(() => __opened.length)) === 0);

    await page.evaluate(() => teacher.open());
    ok('teacher window opens', await until(page, () => document.getElementById('ltModal')?.classList.contains('open')));
    ok('room document is open with an epoch', await page.evaluate(() => { const r = db._peek('liveCamRooms/main'); return r && r.open === true && !!r.epoch; }));
    ok('the empty window says it is waiting', await page.evaluate(() => !document.getElementById('ltEmpty').hidden));
    ok('student is invited', await until(page, () => student.state().student.invite));
    ok('…and the camera is still closed until they tap', (await page.evaluate(() => __opened.length)) === 0);
    await shot(page, '01-invite');

    await page.click('#lsShareBtn');
    ok('student is sharing after the tap', await until(page, () => student.state().student.sharing));
    ok('student preview shows', await page.evaluate(() => !document.getElementById('lsSelf').hidden));
    ok('student preview is mirrored by default', await page.evaluate(() => document.getElementById('lsSelfVideo').classList.contains('mirror')));
    ok('teacher has a tile for the student', await until(page, () => teacher.state().teacher.peers.length === 1));
    ok('the tile is named and shows the worksheet', await until(page, () => {
      const t = document.querySelector('#ltGrid .lcTile');
      return t && t.querySelector('.lcName').textContent === 'Ada Lovelace' && t.querySelector('.lcWs').textContent === 'P5 Science WS3';
    }));
    ok('WebRTC connects and the tile goes live', await until(page, () => teacher.state().teacher.peers[0]?.status === 'live'),
      JSON.stringify(await page.evaluate(() => teacher.state())));
    ok('teacher video is playing real frames', await until(page, () => teacher.state().teacher.peers[0]?.videoWidth > 0));
    ok('student knows it is live', await until(page, () => student.state().student.rtc === 'connected'));
    ok('the student status says Live', await until(page, () => /Live/.test(document.getElementById('lsSelfStatus').textContent)));
    ok('no snapshots are sent while video works', await page.evaluate(() => !student.state().student.snapping));
    ok('the teacher’s video is not mirrored', await page.evaluate(() => {
      const v = document.querySelector('#ltGrid .lcVideo'); return !/scaleX\(-1\)/.test(getComputedStyle(v).transform === 'none' ? '' : v.style.transform);
    }));
    ok('summary counts one live', await page.evaluate(() => /1 live/.test(document.getElementById('ltSummary').textContent)));
    await shot(page, '02-live');

    // Rotate and enlarge.
    await page.click('#ltGrid .lcTile [data-act="rotate"]');
    ok('rotate turns the tile a quarter', await page.evaluate(() => teacher.state().teacher.peers[0].rotate === 90 &&
      /rotate\(90deg\)/.test(document.querySelector('.lcTile .lcVideo').style.transform)));
    ok('⟳ shows the angle once turned', await page.evaluate(() =>
      document.querySelector('#ltGrid .lcTile [data-act="rotate"]').textContent === '⟳ 90°'));
    ok('…and the turn is remembered for this student', await page.evaluate(() =>
      JSON.parse(localStorage.getItem(LiveCams.pure.ROTATE_KEY) || '{}')['u:student-uid']?.d === 90));
    for (let i = 0; i < 3; i++) await page.click('#ltGrid .lcTile [data-act="rotate"]');
    ok('four presses come all the way round to upright', await page.evaluate(() => teacher.state().teacher.peers[0].rotate === 0 &&
      document.querySelector('#ltGrid .lcTile [data-act="rotate"]').textContent === '⟳'));
    ok('…turning clockwise the whole time (270 → 360, never back to 0)', await page.evaluate(() =>
      teacher.state().teacher.peers[0].spin === 360 && /rotate\(360deg\)/.test(document.querySelector('.lcTile .lcVideo').style.transform)));
    ok('…and upright is forgotten rather than stored', await page.evaluate(() =>
      !('u:student-uid' in JSON.parse(localStorage.getItem(LiveCams.pure.ROTATE_KEY) || '{}'))));
    await page.click('#ltGrid .lcTile [data-act="rotate"]');
    ok('a fifth press starts round again at 90°', await page.evaluate(() => teacher.state().teacher.peers[0].rotate === 90));
    await page.click('.lcTile .lcMedia');
    ok('tapping the picture enlarges it', await until(page, () => teacher.state().teacher.focus !== '' &&
      document.querySelector('#ltStage .lcTile.lcBig') != null && !document.getElementById('ltStage').hidden));
    ok('the big video keeps playing after it moved', await until(page, () => { const v = document.querySelector('#ltStage video'); return v && !v.paused && v.videoWidth > 0; }));
    await page.keyboard.press('r');
    ok('R turns the enlarged student a quarter', await until(page, () => teacher.state().teacher.peers[0].rotate === 180));
    await page.keyboard.press('r');
    await page.keyboard.press('r');
    ok('…and round again', await until(page, () => teacher.state().teacher.peers[0].rotate === 0));
    await page.click('#ltStage .lcTile [data-act="rotate"]');
    ok('the enlarged tile has its own ⟳ too', await until(page, () => teacher.state().teacher.peers[0].rotate === 90));
    await shot(page, '03-focus');
    await page.click('#ltStage .lcTile .lcMedia');
    ok('tapping it again puts it back', await until(page, () => teacher.state().teacher.focus === '' && document.querySelector('#ltGrid .lcTile')));

    // Put a frame on the page.
    await page.click('#ltGrid .lcTile [data-act="pin"]');
    ok('📌 hands a JPEG of the frame to the page', await until(page, () => pinned.length === 1 && /image\/jpeg/.test(pinned[0])));

    // Quality reaches the student.
    await page.selectOption('#ltQuality', 'sharp');
    ok('Sharp quality reaches the student', await until(page, () => { student._tick(); return student.state().student.quality === 'sharp'; }));

    // Reconnect renegotiates and comes back live.
    const revBefore = await page.evaluate(() => student.state().student.rev);
    await page.click('#ltGrid .lcTile [data-act="reconnect"]');
    ok('↻ renegotiates', await until(page, (r) => student.state().student.rev > r, revBefore));
    ok('…and the tile is live again', await until(page, () => teacher.state().teacher.peers[0]?.status === 'live' && teacher.state().teacher.peers[0]?.videoWidth > 0));

    // The teacher removes the tile: the student's camera goes off.
    await page.click('#ltGrid .lcTile [data-act="remove"]');
    ok('✕ removes the tile', await until(page, () => teacher.state().teacher.peers.length === 0));
    ok('…and the student stops sharing', await until(page, () => !student.state().student.sharing));
    ok('…and every camera track is let go', await until(page, () => __live() === 0));
    ok('…and the student is told', await page.evaluate(() => toasts.some(t => /switched your camera off/.test(t))));
    ok('…and the preview is gone', await page.evaluate(() => document.getElementById('lsSelf').hidden));

    // Share again, then the teacher closes the room.
    await until(page, () => student.state().student.invite);
    await page.click('#lsShareBtn');
    ok('the student can share again', await until(page, () => teacher.state().teacher.peers[0]?.status === 'live'));
    ok('a student who shares again comes back turned the way the teacher left them', await page.evaluate(() =>
      teacher.state().teacher.peers[0].rotate === 90 && /rotate\(90deg\)/.test(document.querySelector('#ltGrid .lcTile .lcVideo').style.transform)));
    await page.click('#ltCloseBtn');
    ok('closing the window closes the room', await until(page, () => db._peek('liveCamRooms/main').open === false));
    ok('…the student stops', await until(page, () => !student.state().student.sharing));
    ok('…the camera is let go', await until(page, () => __live() === 0));
    ok('…the peer documents are cleared', await until(page, () => [...db._docs.keys()].filter(k => k.includes('/peers/')).length === 0));
    ok('…and no invitation is left behind', await until(page, () => !student.state().student.invite));

    // Stop pressed by the student.
    await page.evaluate(() => teacher.open());
    await until(page, () => student.state().student.invite);
    await page.click('#lsShareBtn');
    await until(page, () => student.state().student.sharing);
    await page.click('#lsStopBtn');
    ok('Stop lets go of the camera', await until(page, () => __live() === 0 && !student.state().student.sharing));
    ok('Stop removes the student’s tile', await until(page, () => teacher.state().teacher.peers.length === 0));
    ok('a student who stopped is not asked again in the same session', await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 300)); student._tick(); return !student.state().student.invite;
    }));

    // A role change (sign-out) on the student side stops it.
    await page.evaluate(() => { teacher.close(); });
    await page.evaluate(() => teacher.open());
    await until(page, () => student.state().student.invite);
    await page.click('#lsShareBtn');
    await until(page, () => student.state().student.sharing);
    await page.evaluate(() => { roles.s = 'none'; student.roleChanged(); });
    ok('signing out stops the camera', await until(page, () => __live() === 0 && !student.state().student.sharing));
    ok('…and takes the invitation away', await page.evaluate(() => !student.state().student.invite));

    // A teacher whose role changes mid-lesson (device handed over) closes the room.
    await page.evaluate(() => { roles.t = 'student'; teacher.roleChanged(); });
    ok('the teacher losing the role closes the room', await until(page, () => db._peek('liveCamRooms/main').open === false && !teacher.state().teacher.live));

    // A stale room (teacher tab died) closes the student's camera.
    await page.evaluate(() => { roles.t = 'teacher'; teacher.roleChanged(); roles.s = 'student'; student.roleChanged(); });
    await page.evaluate(() => teacher.open());
    await until(page, () => student.state().student.invite);
    await page.click('#lsShareBtn');
    await until(page, () => student.state().student.sharing);
    await page.evaluate(() => db.collection('liveCamRooms').doc('main').update({ heartbeat: Date.now() - 10 * 60 * 1000 }));
    await page.waitForTimeout(100);
    await page.evaluate(() => student._tick());
    ok('a room nobody is stamping switches the camera off', await until(page, () => __live() === 0 && !student.state().student.sharing));

    ok('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ============ 2. No WebRTC: the snapshot fallback ============ */
  console.log('Snapshot fallback');
  {
    const { page, errors } = await freshPage(pageSnap);
    await page.evaluate(() => teacher.open());
    await until(page, () => student.state().student.invite);
    await page.click('#lsShareBtn');
    ok('student without WebRTC still shares', await until(page, () => student.state().student.sharing));
    ok('…by sending snapshots', await until(page, () => student.state().student.snapping));
    ok('the teacher tile shows a snapshot', await until(page, () => teacher.state().teacher.peers[0]?.status === 'snap'));
    ok('…as a picture that really loaded', await until(page, () => { const i = document.querySelector('#ltGrid .lcSnap'); return i && !i.hidden && i.naturalWidth > 0; }));
    ok('the snapshot fits a document', await page.evaluate(() => {
      const p = [...db._docs.entries()].find(([k]) => k.includes('/peers/'));
      return p && p[1].snap.length < LiveCams.pure.SNAP_MAX_CHARS && /^data:image\/jpeg/.test(p[1].snap);
    }));
    ok('the student is told it is sending pictures', await page.evaluate(() => /pictures/.test(document.getElementById('lsSelfStatus').textContent)));
    const first = await page.evaluate(() => { const p = [...db._docs.entries()].find(([k]) => k.includes('/peers/')); return p[1].snapAt; });
    await page.waitForTimeout(2200);
    const second = await page.evaluate(() => { const p = [...db._docs.entries()].find(([k]) => k.includes('/peers/')); return p[1].snapAt; });
    ok('snapshots keep coming', second > first);
    await page.click('#ltGrid .lcTile [data-act="pin"]');
    ok('📌 works on a snapshot too', await until(page, () => pinned.length === 1));
    await shot(page, '04-snapshots');
    await page.click('#ltCloseBtn');
    ok('closing stops the snapshots and the camera', await until(page, () => __live() === 0 && !student.state().student.snapping));
    const writes = await page.evaluate(() => __dbWrites);
    await page.waitForTimeout(2000);
    ok('…and nothing is written after the camera is off', (await page.evaluate(() => __dbWrites)) - writes <= 1);
    ok('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ============ 3. The real app loads it ============ */
  console.log('In the app');
  {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      const chain = () => new Proxy(function () { return chain(); }, {
        get: (t, k) => (k === 'then' ? undefined : chain()),
        apply: () => chain(), construct: () => chain(), set: () => true
      });
      window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
    });
    await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
    await page.waitForTimeout(800);
    ok('the app creates the controller', await page.evaluate(() => !!window.liveCams && typeof liveCams.toggle === 'function'));
    ok('the button is hidden from a signed-out visitor', await page.evaluate(() => getComputedStyle(document.getElementById('liveCamBtn')).display === 'none'));
    ok('the version is v1.135.0 or later', await page.evaluate(() => /^v1\.(1[3-9][5-9]|1[4-9]\d)\./.test(APP_VERSION)));
    ok('nothing from live cams threw while the app loaded', !errors.some(e => /live-?cams|liveCam/i.test(e)), errors.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
