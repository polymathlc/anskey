import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('var aiScreenShare = null;');
const code = html.slice(start, html.indexOf('/* ================= End live shared view', start));
function harness() {
  const button = { setAttribute() {}, classList: { toggle() {} }, addEventListener() {} };
  const calls = { stops: 0, pauses: 0, frames: 0, requests: [], messages: [] };
  const track = { readyState: 'live', muted: false, stop() { calls.stops++; this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { videoWidth: 2560, videoHeight: 1440, readyState: 4, play: async () => {}, pause() { calls.pauses++; } };
  const c = { currentUser: { uid: 'teacher' }, currentDocId: 'doc', wsEpoch: 1, practiceMode: false,
    student: false, shared: false, isStudent: () => c.student, isSharedVisitor: () => c.shared,
    pages: [{}], $: () => button, toast: text => calls.messages.push(text),
    navigator: { mediaDevices: { getDisplayMedia: async options => { calls.requests.push(options); return stream; } } },
    document: { hidden: false, createElement: tag => tag === 'video' ? video : {
      width: 0, height: 0, getContext: () => ({ drawImage(v, x, y, w, h) { calls.frames++; assert.equal(w, 1920); assert.equal(h, 1080); } }),
      toDataURL: () => 'data:image/jpeg;base64,frame'
    } }, window: { addEventListener() {} }
  };
  vm.createContext(c); vm.runInContext(code, c);
  return { c, track, stream, video, calls, button };
}
test('sharing starts only on request, captures no audio, and freezes one image per AI request', async () => {
  const h = harness(); assert.equal(h.c.aiScreenFrame(), null); assert.equal(h.calls.requests.length, 0);
  await h.c.aiScreenStart(); assert.equal(h.calls.frames, 0);
  assert.equal(h.calls.requests[0].audio, false); assert.equal(h.calls.requests[0].preferCurrentTab, true);
  assert.equal(h.c.aiScreenFrame().data, 'frame'); assert.equal(h.calls.frames, 1);
  h.c.aiScreenStop(); assert.equal(h.calls.stops, 1); assert.equal(h.video.srcObject, null);
  assert.equal(h.c.aiScreenFrame(), null);
});
test('worksheet, account and role changes stop all shared tracks before another frame', async () => {
  for (const change of [c => c.wsEpoch++, c => c.currentDocId = 'other', c => c.currentUser = null,
    c => c.practiceMode = true, c => c.student = true, c => c.shared = true]) {
    const h = harness(); await h.c.aiScreenStart(); change(h.c);
    assert.equal(h.c.aiScreenFrame(), null); assert.equal(h.calls.stops, 1); assert.equal(h.calls.frames, 0);
  }
});
test('late chooser result after stopping or navigating releases the new stream', async () => {
  for (const change of [c => c.aiScreenStop(), c => c.wsEpoch++]) {
    const h = harness(); let finish;
    h.c.navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { finish = resolve; });
    const ready = h.c.aiScreenStart(); change(h.c); finish(h.stream); await ready;
    assert.equal(h.c.aiScreenShare, null); assert.equal(h.calls.stops, 1); assert.equal(h.calls.frames, 0);
  }
});
test('muted, ended, hidden and not-yet-decoded captures cannot masquerade as a current image', async () => {
  for (const change of [h => h.track.muted = true, h => h.track.readyState = 'ended',
    h => h.c.document.hidden = true, h => h.video.readyState = 1, h => h.video.videoWidth = 0]) {
    const h = harness(); await h.c.aiScreenStart(); change(h); assert.equal(h.c.aiScreenFrame(), null); assert.equal(h.calls.frames, 0);
  }
});
test('denied or unsupported sharing retains normal worksheet vision and no stream', async () => {
  const h = harness(); h.c.navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('NotAllowedError'); };
  await h.c.aiScreenStart(); assert.equal(h.c.aiScreenShare, null); assert.match(h.calls.messages.at(-1), /Worksheet vision is still available/);
  delete h.c.navigator.mediaDevices.getDisplayMedia; await h.c.aiScreenStart(); assert.equal(h.c.aiScreenShare, null);
});
