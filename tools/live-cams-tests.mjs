/* =====================================================================
   📹 Live cams — the pure half, and the glue's promises, without a browser.
   ---------------------------------------------------------------------
   live-cams.js is loaded into a vm exactly as the page loads it, and the
   helpers on LiveCams.pure are run against the cases that fail silently
   in a classroom: a dead teacher tab that still says "open", a candidate
   from the last negotiation handed to the new one, a snapshot too big
   for its document, a grid that leaves one lonely tile on the last row.
   The second half reads index.html and pins the glue: the button is the
   teacher's, the role is re-asked on every role change, and a frame put
   on the page goes through the pasted-picture door.

     node --test tools/live-cams-tests.mjs

   tools/live-cams-check.mjs is the browser half: a real teacher and a
   real student, Chromium's fake camera and real WebRTC.
   ===================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../live-cams.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../live-cams.css', import.meta.url), 'utf8');

function load() {
  const sandbox = { console, Date, Math, JSON, Uint8Array, crypto: globalThis.crypto };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'live-cams.js' });
  return sandbox.LiveCams;
}
const LC = load();
const P = LC.pure;

test('it loads without a DOM and exposes create + pure', () => {
  assert.equal(typeof LC.create, 'function');
  assert.equal(typeof P.roomFresh, 'function');
  assert.equal(P.ROOM_COLLECTION, 'liveCamRooms');
  assert.equal(P.PEERS, 'peers');
});

test('cleanName: one line, no control characters, capped, never empty with a fallback', () => {
  assert.equal(P.cleanName('  Ada   Lovelace \n'), 'Ada Lovelace');
  assert.equal(P.cleanName('A\u0000B\u0007C'), 'A B C');
  assert.equal(P.cleanName('', 'Student'), 'Student');
  assert.equal(P.cleanName(null, 'Student'), 'Student');
  assert.equal(P.cleanName(undefined), '');
  const long = 'x'.repeat(200);
  assert.equal(P.cleanName(long).length, P.NAME_MAX);
  assert.equal(P.cleanName(42), '42');
});

test('cleanWs keeps an id and a name and drops anything else', () => {
  assert.equal(P.cleanWs(null), null);
  assert.equal(P.cleanWs('x'), null);
  assert.equal(P.cleanWs({}), null);
  assert.deepEqual(JSON.parse(JSON.stringify(P.cleanWs({ id: 'abc', name: ' P5 Science  WS3 ', extra: 1 }))),
    { id: 'abc', name: 'P5 Science WS3' });
  assert.equal(P.cleanWs({ id: 7, name: '' }), null);
  assert.equal(P.cleanWs({ id: 'a'.repeat(500), name: 'n' }).id.length, 120);
});

test('newId is unique and carries its prefix', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = P.newId('p');
    assert.ok(v.startsWith('p'));
    assert.ok(!seen.has(v));
    seen.add(v);
  }
});

test('roomFresh: open, with an epoch, stamped recently — and not from the future', () => {
  const now = 1_000_000_000;
  const room = { open: true, epoch: 'e1', heartbeat: now - 1000 };
  assert.equal(P.roomFresh(room, now), true);
  assert.equal(P.roomFresh(null, now), false);
  assert.equal(P.roomFresh({ ...room, open: false }, now), false);
  assert.equal(P.roomFresh({ ...room, open: 'yes' }, now), false);
  assert.equal(P.roomFresh({ ...room, epoch: '' }, now), false);
  assert.equal(P.roomFresh({ ...room, epoch: 5 }, now), false);
  assert.equal(P.roomFresh({ ...room, heartbeat: 'soon' }, now), false);
  // A teacher's tab that crashed: still "open", never stamped again.
  assert.equal(P.roomFresh({ ...room, heartbeat: now - P.ROOM_STALE_MS - 1 }, now), false);
  assert.equal(P.roomFresh({ ...room, heartbeat: now - P.ROOM_STALE_MS + 1 }, now), true);
  // A device whose clock is far ahead.
  assert.equal(P.roomFresh({ ...room, heartbeat: now + P.ROOM_STALE_MS + 1 }, now), false);
});

test('the room outlives several missed heartbeats, so one slow write never closes it', () => {
  assert.ok(P.ROOM_STALE_MS >= P.ROOM_BEAT_MS * 4);
  assert.ok(P.PEER_STALE_MS >= P.PEER_BEAT_MS * 3);
  assert.ok(P.PEER_GONE_MS > P.PEER_STALE_MS);
});

test('qualityOf and encodingFor never upscale and never exceed the quality', () => {
  assert.equal(P.qualityOf(null), 'normal');
  assert.equal(P.qualityOf({ quality: 'sharp' }), 'sharp');
  assert.equal(P.qualityOf({ quality: 'ultra' }), 'normal');
  const n = P.encodingFor('normal', 1280);
  assert.equal(n.maxBitrate, P.QUALITY.normal.maxBitrate);
  assert.ok(Math.abs(n.scaleResolutionDownBy - 1280 / P.QUALITY.normal.maxWidth) < 0.001);
  assert.equal(P.encodingFor('normal', 640).scaleResolutionDownBy, 1);
  assert.equal(P.encodingFor('sharp', 1280).scaleResolutionDownBy, 1);
  assert.equal(P.encodingFor('nonsense', 0).scaleResolutionDownBy, 1);
  assert.ok(P.QUALITY.sharp.maxBitrate > P.QUALITY.normal.maxBitrate);
});

test('candidates travel tagged with their negotiation and are applied once', () => {
  const a = P.packCandidate({ candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 }, 1);
  const b = P.packCandidate({ candidate: 'candidate:2 1 udp 1 1.2.3.5 6 typ host', sdpMid: '0', sdpMLineIndex: 0 }, 2);
  assert.equal(P.packCandidate(null, 1), '');
  assert.equal(P.packCandidate({ candidate: '' }, 1), '');
  const seen = {};
  const first = P.unpackCandidates([a, b, 'not json', 7, JSON.stringify({ r: 2 })], 2, seen);
  assert.equal(first.length, 1);
  assert.equal(first[0].candidate, 'candidate:2 1 udp 1 1.2.3.5 6 typ host');
  assert.equal(first[0].sdpMid, '0');
  assert.equal(first[0].sdpMLineIndex, 0);
  // The same array delivered again by the next snapshot adds nothing.
  assert.equal(P.unpackCandidates([a, b], 2, seen).length, 0);
  // A candidate from the LAST negotiation is never handed to this one.
  assert.equal(P.unpackCandidates([a], 2, {}).length, 0);
  assert.equal(P.unpackCandidates(null, 1, {}).length, 0);
  const nulls = P.packCandidate({ candidate: 'candidate:x' }, 3);
  const out = P.unpackCandidates([nulls], 3, {});
  assert.equal(out[0].sdpMid, null);
  assert.equal(out[0].sdpMLineIndex, null);
});

test('peerStatus: video beats a snapshot beats waiting, and silence beats all of them', () => {
  const now = 5_000_000;
  const peer = { seen: now - 1000 };
  assert.equal(P.peerStatus(null, now, 'connected'), 'gone');
  assert.equal(P.peerStatus(peer, now, 'connected'), 'live');
  assert.equal(P.peerStatus(peer, now, 'connecting'), 'connecting');
  assert.equal(P.peerStatus(peer, now, 'failed'), 'failed');
  assert.equal(P.peerStatus({ ...peer, snap: 'data:', snapAt: now - 500 }, now, 'failed'), 'snap');
  assert.equal(P.peerStatus({ ...peer, snap: 'data:', snapAt: now - 500 }, now, 'connected'), 'live');
  // An old snapshot is not a live one.
  assert.equal(P.peerStatus({ ...peer, snap: 'data:', snapAt: now - P.PEER_STALE_MS - 1 }, now, 'new'), 'connecting');
  assert.equal(P.peerStatus({ seen: now - P.PEER_STALE_MS - 1 }, now, 'connected'), 'stale');
  assert.equal(P.peerStatus({ seen: now - P.PEER_GONE_MS - 1 }, now, 'connected'), 'gone');
  assert.equal(P.peerStatus({}, now, 'connected'), 'gone');
});

test('statusLabel has words for every status and a fallback', () => {
  for (const s of ['live', 'snap', 'connecting', 'failed', 'stale', 'gone']) assert.ok(P.statusLabel(s).length > 2);
  assert.equal(P.statusLabel('???'), P.statusLabel('connecting'));
});

test('needsAnswer: an offer for a negotiation not yet answered', () => {
  assert.equal(P.needsAnswer(null, null), false);
  assert.equal(P.needsAnswer({ rev: 1, offer: null }, null), false);
  assert.equal(P.needsAnswer({ rev: 1, offer: { type: 'offer', sdp: '' } }, null), false);
  assert.equal(P.needsAnswer({ rev: 1, offer: { type: 'offer', sdp: 'v=0' } }, null), true);
  assert.equal(P.needsAnswer({ rev: 1, offer: { type: 'offer', sdp: 'v=0' } }, 1), false);
  assert.equal(P.needsAnswer({ rev: 2, offer: { type: 'offer', sdp: 'v=0' } }, 1), true);
  assert.equal(P.needsAnswer({ rev: 'x', offer: { type: 'offer', sdp: 'v=0' } }, 1), false);
});

test('gridColumns: as many as fit, evened out so no lonely last tile', () => {
  assert.equal(P.gridColumns(0, 900), 1);
  assert.equal(P.gridColumns(1, 900), 1);
  assert.equal(P.gridColumns(2, 900), 2);
  assert.equal(P.gridColumns(4, 900), 4);
  // 5 tiles in a window that fits 4: two rows of 3 + 2, not 4 + 1.
  assert.equal(P.gridColumns(5, 900), 3);
  assert.equal(P.gridColumns(9, 900), 3);
  assert.equal(P.gridColumns(30, 900), 4);
  assert.equal(P.gridColumns(3, 100), 1);
  assert.equal(P.gridColumns(6, 1000, 300), 3);
  for (let n = 1; n <= 40; n++) {
    for (const w of [200, 480, 700, 900, 1400]) {
      const c = P.gridColumns(n, w);
      assert.ok(c >= 1 && c <= n);
      const rows = Math.ceil(n / c);
      const last = n - (rows - 1) * c;
      // The last row is never more than one tile shorter than it has to be.
      assert.ok(rows === 1 || last >= c - (rows - 1), `n=${n} w=${w} c=${c}`);
    }
  }
});

test('snapshotSize keeps the shape, caps the long side and never enlarges', () => {
  assert.deepEqual({ ...P.snapshotSize(1280, 720, 640) }, { w: 640, h: 360 });
  assert.deepEqual({ ...P.snapshotSize(720, 1280, 640) }, { w: 360, h: 640 });
  assert.deepEqual({ ...P.snapshotSize(320, 240, 640) }, { w: 320, h: 240 });
  assert.deepEqual({ ...P.snapshotSize(0, 240, 640) }, { w: 0, h: 0 });
  assert.deepEqual({ ...P.snapshotSize(5000, 1, 640) }, { w: 640, h: 1 });
});

test('rotateFit: a quarter turn shrinks to fit, a half turn does not', () => {
  assert.equal(P.rotateFit(400, 300, 1280, 720, 0), 1);
  assert.equal(P.rotateFit(400, 300, 1280, 720, 180), 1);
  const s = P.rotateFit(400, 300, 1280, 720, 90);
  assert.ok(s < 1 && s > 0);
  // Turned, the 1280 side must fit inside the 300 box height.
  const plain = Math.min(400 / 1280, 300 / 720);
  assert.ok(1280 * plain * s <= 300 + 0.5);
  assert.equal(P.rotateFit(400, 300, 1280, 720, 270), s);
  assert.equal(P.rotateFit(400, 300, 1280, 720, -90), s);
  assert.equal(P.rotateFit(0, 300, 1280, 720, 90), 1);
});

test('nextRotation walks the quarter turns', () => {
  assert.equal(P.nextRotation(0), 90);
  assert.equal(P.nextRotation(90), 180);
  assert.equal(P.nextRotation(270), 0);
  assert.equal(P.nextRotation(undefined), 90);
});

test('cleanRotation keeps quarter turns only', () => {
  assert.equal(P.cleanRotation(0), 0);
  assert.equal(P.cleanRotation(90), 90);
  assert.equal(P.cleanRotation(450), 90);
  assert.equal(P.cleanRotation(-90), 270);
  assert.equal(P.cleanRotation(45), 0);
  assert.equal(P.cleanRotation('180'), 180);
  assert.equal(P.cleanRotation('x'), 0);
  assert.equal(P.cleanRotation(undefined), 0);
});

test('rotationKey: account first, then name, else nothing', () => {
  assert.equal(P.rotationKey({ uid: 'abc', name: 'Ada' }), 'u:abc');
  assert.equal(P.rotationKey({ uid: '', name: '  Ada Lovelace ' }), 'n:ada lovelace');
  assert.equal(P.rotationKey({ name: 'ADA' }), P.rotationKey({ name: 'ada' }));
  assert.equal(P.rotationKey({}), '');
  assert.equal(P.rotationKey(null), '');
  assert.equal(P.rotationKey({ uid: 'x'.repeat(500), name: 'Bo' }), 'n:bo');
});

test('rememberRotation writes, forgets upright, and caps the list', () => {
  const a = P.rememberRotation({}, 'u:a', 90, 1, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), { 'u:a': { d: 90, at: 1 } });
  const b = P.rememberRotation(a, 'u:a', 0, 2, 10);
  assert.deepEqual(Object.keys(b), []);
  assert.ok('u:a' in a, 'the map passed in is not changed');
  const bad = P.rememberRotation({ 'u:x': { d: 45 }, 'u:y': { d: 'no' }, 'u:z': null, 'u:ok': { d: 270, at: 5 } }, '', 0, 0, 10);
  assert.deepEqual(Object.keys(bad), ['u:ok']);
  let m = {};
  for (let i = 0; i < 5; i++) m = P.rememberRotation(m, 'u:' + i, 90, i, 3);
  assert.deepEqual(Object.keys(m).sort(), ['u:2', 'u:3', 'u:4']);
  assert.deepEqual(Object.keys(P.rememberRotation(null, '', 90, 0, 3)), []);
});

test('nextSpin only ever turns clockwise', () => {
  let spin = 0, deg = 0;
  for (let i = 0; i < 8; i++) {
    const s2 = P.nextSpin(spin); const d2 = P.nextRotation(deg);
    assert.equal(s2 - spin, 90);
    assert.equal(((s2 % 360) + 360) % 360, d2);
    spin = s2; deg = d2;
  }
  assert.equal(P.nextSpin(undefined), 90);
});

test('rotateLabel says the angle once turned', () => {
  assert.equal(P.rotateLabel(0), '⟳');
  assert.equal(P.rotateLabel(90), '⟳ 90°');
  assert.equal(P.rotateLabel(270), '⟳ 270°');
});

test('the turn is the teacher’s view only: never written to the room', () => {
  const sec = SRC.slice(SRC.indexOf('function rotatePeer'), SRC.indexOf('function fitRotation'));
  assert.ok(sec.includes('teacherAllowed()'), 'rotatePeer asks the role');
  assert.ok(!/peersRef|roomRef|\.update\(|\.set\(/.test(sec), 'rotatePeer writes nothing to Firestore');
  assert.ok(/drawFrame\(m, p\.rotate/.test(SRC), '📌 and ⬇ draw the frame turned');
});

test('sortPeers: by name, case-blind, then by id', () => {
  const out = P.sortPeers([{ id: 'b', name: 'zoe' }, { id: 'a', name: 'Amy' }, { id: 'c', name: 'amy' }, { id: 'd' }]);
  assert.deepEqual(out.map(p => p.id), ['d', 'a', 'c', 'b']);
  assert.deepEqual(P.sortPeers(null).length, 0);
});

test('summarize counts what is on screen', () => {
  assert.equal(P.summarize([]), 'Nobody is sharing yet');
  assert.equal(P.summarize(['live', 'live', 'snap', 'connecting']), '2 live · 1 snapshots · 1 connecting');
  assert.ok(!P.summarize(['connecting']).includes('…'));
});

test('snapFits refuses anything that is not a picture or would not fit a document', () => {
  assert.equal(P.snapFits('data:image/jpeg;base64,AAAA'), true);
  assert.equal(P.snapFits('data:text/html;base64,AAAA'), false);
  assert.equal(P.snapFits('javascript:alert(1)'), false);
  assert.equal(P.snapFits(null), false);
  assert.equal(P.snapFits('data:image/jpeg;base64,' + 'A'.repeat(P.SNAP_MAX_CHARS)), false);
  assert.ok(P.SNAP_MAX_CHARS < 1_000_000);
});

test('frameFileName names the student and the moment, with nothing a file system refuses', () => {
  const n = P.frameFileName('Ada/Love:lace?', new Date(2026, 9, 15, 9, 5, 7).getTime());
  assert.equal(n, 'AdaLovelace 2026-10-15 090507.jpg');
  assert.ok(P.frameFileName('', 0).startsWith('Student '));
});

/* ---------------- The glue in index.html ---------------- */

test('index.html loads the module, its stylesheet and initialises it after it', () => {
  assert.ok(HTML.includes('<link rel="stylesheet" href="live-cams.css">'));
  const tag = HTML.indexOf('<script src="live-cams.js"></script>');
  const init = HTML.indexOf('<script>liveCamsInit();</script>');
  assert.ok(tag > 0 && init > tag, 'liveCamsInit must run after live-cams.js loads');
});

test('the Live cams button is the teacher’s: hidden by default, shown with the wheel', () => {
  const btn = HTML.match(/<button class="btn" id="liveCamBtn"[^>]*>/);
  assert.ok(btn, 'button exists');
  assert.ok(btn[0].includes('style="display:none"'), 'hidden until the role says otherwise');
  const fn = HTML.slice(HTML.indexOf('function applyRewardVisibility()'), HTML.indexOf('function applyRewardVisibility()') + 1600);
  assert.ok(/camBtn\.style\.display = show \? '' : 'none'/.test(fn));
  assert.ok(fn.includes('liveCamsRoleChanged();'), 'every role change reaches the module');
});

test('the glue re-asks the role in the click handler and uses the teacher test the wheel uses', () => {
  const start = HTML.indexOf('/* ================= 📹 Live cams — glue');
  const end = HTML.indexOf('/* ================= End live cams glue');
  assert.ok(start > 0 && end > start);
  const glue = HTML.slice(start, end);
  assert.ok(glue.includes("if (wheelTeacher()) return 'teacher';"));
  assert.ok(/addEventListener\('click', function \(\) \{\s*if \(liveCamRole\(\) !== 'teacher'\) return;/.test(glue),
    'the click handler refuses a non-teacher');
  assert.ok(glue.includes('pasteImageOntoPage(blob)'), 'a frame goes on the page through the pasted-picture door');
  assert.ok(glue.includes('firebase.firestore.FieldValue'), 'candidates use a real arrayUnion');
});

test('the module asks the role in every teacher handler and stops the camera on every exit', () => {
  for (const fn of ['openTeacher', 'setQuality', 'onTileClick', 'pinFrame', 'saveFrame', 'reconnectPeer', 'removePeer']) {
    const at = SRC.indexOf('function ' + fn + '(');
    assert.ok(at > 0, fn + ' exists');
    const body = SRC.slice(at, at + 400);
    assert.ok(/teacherAllowed\(\)/.test(body), fn + ' asks teacherAllowed()');
  }
  const stop = SRC.slice(SRC.indexOf('function stopSharing('), SRC.indexOf('function stopSharing(') + 1800);
  assert.ok(stop.includes('stopStream(S.stream)'), 'Stop lets go of the camera');
  assert.ok(stop.includes('closePc(S.pc)'));
  for (const why of ["stopSharing('closed')", "stopSharing('removed')", "stopSharing('role')", "stopSharing('pagehide')", "stopSharing('user')"]) {
    assert.ok(SRC.includes(why), why + ' is a path out');
  }
  assert.ok(SRC.includes("root.addEventListener('pagehide', pageHide)"));
});

test('the stream is never mirrored: only the preview class is', () => {
  assert.ok(/\.lcSelfVideo\.mirror\s*\{\s*transform: scaleX\(-1\)/.test(CSS));
  // No mirror on what the teacher sees, and the snapshot is drawn unturned.
  assert.ok(!/\.lcVideo[^{]*\{[^}]*scaleX\(-1\)/.test(CSS));
  assert.ok(SRC.includes('drawFrame(v, 0, q.snapPx)'), 'snapshots are drawn as the camera sees them');
});

test('the camera opens only from the Share button, never by itself', () => {
  const calls = [...SRC.matchAll(/startSharing\(\)/g)].length;
  // The definition and the Share button; the public share() hands over the
  // function itself without calling it.
  assert.equal(calls, 2, 'startSharing() is called only from the Share button');
  assert.ok(SRC.includes("$('ShareBtn').addEventListener('click', function () { startSharing(); });"));
  const gum = [...SRC.matchAll(/getUserMedia\(/g)].length;
  assert.equal(gum, 2, 'only openCamera (and its one fallback for an unplugged camera) opens a camera');
  const oc = [...SRC.matchAll(/openCamera\(/g)].length;
  assert.equal(oc, 3, 'openCamera is defined once and called from Share and from the camera picker only');
  assert.ok(SRC.includes("audio: false"), 'no microphone, ever');
});

test('check-syntax covers the module', () => {
  const cs = fs.readFileSync(new URL('./check-syntax.mjs', import.meta.url), 'utf8');
  assert.ok(cs.includes("'live-cams.js'"));
});

test('the version was bumped and the README says what it does', () => {
  const v = HTML.match(/var APP_VERSION = 'v(\d+)\.(\d+)\.(\d+)';/);
  assert.ok(v);
  assert.ok(Number(v[2]) >= 135);
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(/## v1\.135\.0 — .*[Ll]ive cam/.test(readme));
});
