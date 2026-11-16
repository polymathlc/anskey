// 🧾 The receipts window in real Chromium (v1.205.0): write a receipt from a
// student's profile, see the total and the preview follow every key, save it
// (it gets its number), send it (confirm first, then once), find it in the
// list, see it locked, copy it into a new one, void it, edit the centre
// details, keys never escape the window, and a phone fits.
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const js = readFileSync(new URL('../receipts.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../receipts.css', import.meta.url), 'utf8');

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) { console.log('receipts-check: no Playwright at ' + PW + ' — skipped.'); process.exit(0); }
const SHOTS = process.env.RC_SCREENSHOTS || '';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}
  .btn{font:inherit;padding:6px 12px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer}</style></head>
  <body><main id="ws">worksheet</main></body></html>`);
await page.addScriptTag({ content: js });
await page.evaluate(() => {
  const P = window.Receipts.pure;
  const T = window.__t = { docs: {}, counter: 0, centre: P.cleanCentre({ address: '10 Learning Lane\nSingapore 123456', uen: '201912345A' }),
    sent: [], confirms: [], answer: true, teacher: true, keysOutside: 0, downloads: [], parentsSaved: [] };
  document.addEventListener('keydown', () => { T.keysOutside++; });
  T.w = window.Receipts.create({
    teacher: () => T.teacher,
    toast: () => {},
    list: async () => Object.values(T.docs),
    save: async (r) => {
      const id = r.id || 'r' + (Object.keys(T.docs).length + 1);
      const before = T.docs[id];
      if (before && P.isLocked(before)) throw new Error('locked');
      const no = before && before.no ? before.no : P.numberFor(T.centre.prefix, P.yearOf(r.issued), ++T.counter);
      T.docs[id] = P.cleanReceipt(Object.assign({}, r, { id, no, status: 'draft', createdAt: before ? before.createdAt : Date.now() + T.counter }));
      return T.docs[id];
    },
    voidReceipt: async (id, reason) => { T.docs[id] = P.cleanReceipt(Object.assign({}, T.docs[id], { status: 'void', voidReason: reason, voidAt: Date.now() })); return T.docs[id]; },
    recordSend: async (id, send) => { const r = T.docs[id]; T.docs[id] = P.cleanReceipt(Object.assign({}, r, { status: 'sent', sends: r.sends.concat([send]) })); return T.docs[id]; },
    centre: async () => T.centre,
    saveCentre: async (c) => { T.centre = P.cleanCentre(c); return T.centre; },
    students: async () => [{ uid: 'u1', p: { name: 'Tan Wei Ling', level: 'P5', parentEmails: ['mum.tan@example.com'] } }, { uid: 'u2', p: { name: 'Ali Rahman', level: 'P6' } }],
    saveParents: async (uid, emails) => { T.parentsSaved.push({ uid, emails }); },
    pdf: async () => new Uint8Array([37, 80, 68, 70]),
    sendGmail: async (job) => { T.sent.push(job); return { from: P.SENDER }; },
    authorizeGmail: async () => ({}),
    gmailReady: () => true,
    download: (bytes, name) => T.downloads.push(name),
    openUrl: () => {}, copy: async () => true,
    confirm: (m) => { T.confirms.push(m); return T.answer; }
  });
});
const q = (sel, opts) => page.locator('#receipts ' + sel, opts);
const status = () => q('[data-rc="status"]').textContent();
const T = (f) => page.evaluate(f);

// 1. Opens on a blank receipt; picking a student fills the name, level and parent email.
await T(() => window.__t.w.open());
assert.equal(await q('.rcTab.on').textContent(), '✍️ New receipt');
await q('[data-rc="pick"]').click();
await q('[data-rc="pickQuery"]').fill('wei');
await q('.rcPickRow').first().click();
assert.equal(await q('[data-rc="name"]').inputValue(), 'Tan Wei Ling');
assert.equal(await q('[data-rc="level"]').inputValue(), 'P5');
assert.equal(await q('[data-rc="emails"]').inputValue(), 'mum.tan@example.com');

// 2. Keys typed in the window never reach the page (no tool shortcuts fire).
await q('[data-rc="billTo"]').fill('');
await q('[data-rc="billTo"]').pressSequentially('Mrs Tan');
assert.equal(await T(() => window.__t.keysOutside), 0, 'no key escaped the window');

// 3. A quick line + a price; the total and the preview follow.
await q('[data-rc-preset="tuition"]').click();
await q('[data-rc="unit"]').last().fill('260');
await q('[data-rc="addItem"]').click();
await q('[data-rc="desc"]').last().fill('Materials fee');
await q('[data-rc="qty"]').last().fill('2');
await q('[data-rc="unit"]').last().fill('15.50');
await q('[data-rc="discount"]').fill('10');
assert.equal(await q('[data-rc="total"]').textContent(), 'S$281.00');
await page.waitForFunction(() => /S\$281\.00/.test(document.querySelector('#receipts [data-rc="preview"]').srcdoc));
const preview = await q('[data-rc="preview"]').getAttribute('srcdoc');
assert.match(preview, /Tuition fee — [A-Z][a-z]+ \d{4}/);
assert.match(preview, /Mrs Tan/);
assert.equal(await q('[data-rc="preview"]').getAttribute('sandbox'), '', 'the preview is sandboxed');
// A typo in a price is shown, never read as zero.
await q('[data-rc="unit"]').last().fill('15.5x');
assert.equal(await q('[data-rc="unit"]').last().evaluate(e => e.classList.contains('rcBad')), true);
assert.equal(await q('[data-rc="total"]').textContent(), 'S$281.00', 'the last good price stands');
await q('[data-rc="unit"]').last().fill('15.50');
if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'new-receipt.png') }); }

// 4. Save gives the number.
await q('[data-rc="save"]').click();
await page.waitForFunction(() => /Saved as/.test(document.querySelector('#receipts [data-rc="status"]').textContent));
const no = await T(() => window.__t.docs.r1.no);
assert.match(no, /^PLC-\d{4}-0001$/);
assert.match(await status(), new RegExp('Saved as ' + no));
assert.equal(await q('[data-rc="save"]').textContent(), '✓ Saved');

// 5. Send: refused at the confirm sends nothing; accepted sends once and locks it.
await T(() => { window.__t.answer = false; });
await q('[data-rc="send"]').click();
assert.equal(await T(() => window.__t.sent.length), 0, 'a cancelled confirm sends nothing');
assert.match(await T(() => window.__t.confirms[0]), /mum\.tan@example\.com/);
assert.match(await T(() => window.__t.confirms[0]), /S\$281\.00/);
await T(() => { window.__t.answer = true; });
await q('[data-rc="send"]').click();
await page.waitForFunction(() => /emailed to/.test(document.querySelector('#receipts [data-rc="status"]').textContent));
const sent = await T(() => window.__t.sent.map(j => ({ to: j.to, subject: j.subject, total: j.receipt.total, intro: j.intro })));
assert.equal(sent.length, 1);
assert.deepEqual(sent[0].to, ['mum.tan@example.com']);
assert.match(sent[0].subject, new RegExp('^Receipt ' + no + ' — Tan Wei Ling'));
assert.equal(sent[0].total, 28100);
assert.match(sent[0].intro, /^Dear Mrs Tan,/);
assert.equal(await q('[data-rc="name"]').isDisabled(), true, 'a sent receipt is locked');
assert.match(await q('.rcLocked').textContent(), /cannot be changed/);
assert.equal(await q('[data-rc="send"]').textContent(), '✉️ Resend');
assert.equal(await q('[data-rc="save"]').count(), 0, 'no Save on a sent receipt');

// 6. The list finds it; opening it shows the same receipt.
await q('[data-rc-tab="list"]').click();
await page.waitForFunction(() => document.querySelectorAll('#receipts .rcListRow').length >= 1);
await q('[data-rc="query"]').fill('tan materials');
assert.equal(await q('.rcListRow').count(), 1);
assert.match(await q('.rcListRow').textContent(), /Sent/);
assert.match(await q('[data-rc="listSum"]').textContent(), /1 sent in \d{4} · S\$281\.00 received/);
await q('.rcListRow').click();
assert.equal(await q('.rcTab.on').textContent(), '✍️ New receipt');
assert.equal(await q('[data-rc="name"]').inputValue(), 'Tan Wei Ling');

// 7. Copy into a new one: a fresh draft; saving it gets the next number.
await q('[data-rc="duplicate"]').click();
assert.equal(await q('[data-rc="name"]').isDisabled(), false);
await q('[data-rc="save"]').click();
await page.waitForFunction(() => /Saved as/.test(document.querySelector('#receipts [data-rc="status"]').textContent));
assert.match(await T(() => window.__t.docs.r2.no), /-0002$/);

// 8. Void it: kept, marked VOID, Send refused.
page.once('dialog', d => d.accept('Entered twice'));
await q('[data-rc="void"]').click();
await page.waitForFunction(() => /is void/.test(document.querySelector('#receipts [data-rc="status"]').textContent));
assert.equal(await T(() => window.__t.docs.r2.status), 'void');
assert.equal(await q('[data-rc="send"]').isDisabled(), true);
assert.match(await q('[data-rc="preview"]').getAttribute('srcdoc'), /VOID — Entered twice/);

// 9. A student with no parent email: warned; "keep these addresses" saves them.
await q('[data-rc="fresh"]').click();
await q('[data-rc="pick"]').click();
await q('.rcPickRow', { hasText: 'Ali Rahman' }).click();
assert.match(await status(), /no parent email/);
await q('[data-rc="emails"]').fill('ali.dad@example.com, nonsense');
assert.match(await q('[data-rc="emailCheck"]').textContent(), /Not an email address: nonsense/);
await q('[data-rc="saveParents"]').check();
await q('[data-rc-preset="registration"]').click();
await q('[data-rc="unit"]').last().fill('50');
await q('[data-rc="save"]').click();
await page.waitForFunction(() => window.__t.parentsSaved.length === 1);
assert.deepEqual(await T(() => window.__t.parentsSaved[0]), { uid: 'u2', emails: ['ali.dad@example.com'] });
// Missing things are named before a send.
await q('[data-rc="fresh"]').click();
await q('[data-rc="send"]').click();
assert.match(await status(), /student’s name/);
assert.equal(await T(() => window.__t.sent.length), 1, 'still only the one email');

// 10. Centre details are saved and printed on the receipt.
await q('[data-rc-tab="centre"]').click();
await q('[data-rc-centre="phone"]').fill('6123 4567');
await q('[data-rc-centre="prefix"]').fill('pl-c');
await q('[data-rc="saveCentre"]').click();
await page.waitForFunction(() => window.__t.centre.phone === '6123 4567');
assert.equal(await T(() => window.__t.centre.prefix), 'PLC');
await q('[data-rc-tab="new"]').click();
await page.waitForFunction(() => /6123 4567/.test(document.querySelector('#receipts [data-rc="preview"]').srcdoc));

// 11. Escape closes; a dirty receipt asks first.
await q('[data-rc="name"]').fill('Someone');
await T(() => { window.__t.answer = false; });
await page.keyboard.press('Escape');
assert.equal(await page.locator('#receipts').isHidden(), false, 'a dirty receipt is not thrown away silently');
await T(() => { window.__t.answer = true; });
await page.keyboard.press('Escape');
assert.equal(await page.locator('#receipts').isHidden(), true);

// 12. Not the teacher: a role change closes it, and it refuses to open.
await T(() => { window.__t.w.open(); window.__t.teacher = false; window.__t.w.roleChanged(); });
assert.equal(await page.locator('#receipts').isHidden(), true);
await T(() => window.__t.w.open());
assert.equal(await page.locator('#receipts').isHidden(), true);
await T(() => { window.__t.teacher = true; });

// 13. A phone: the form, the lines and the buttons stay inside the screen.
await page.setViewportSize({ width: 390, height: 780 });
await T(() => window.__t.w.open());
await q('[data-rc-preset="tuition"]').click();
for (const sel of ['[data-rc="name"]', '[data-rc="unit"]', '[data-rc="send"]', '[data-rc="total"]']) {
  await q(sel).first().scrollIntoViewIfNeeded();
  const box = await q(sel).first().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391, sel + ' fits on a phone');
}
const scrollW = await page.evaluate(() => { const b = document.querySelector('#receipts .rcBody'); return b.scrollWidth - b.clientWidth; });
assert.ok(scrollW <= 1, 'no sideways scroll on a phone');
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone.png') });

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('receipts-check: all good');
