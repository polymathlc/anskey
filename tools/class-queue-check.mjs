/* =====================================================================
   📌 Current worksheet and Next worksheet (v1.176.0) — in a real browser
   ---------------------------------------------------------------------
   `tools/online-tests.mjs` pins the rules (done / current / next / queued,
   Finished, preparing from Queued). This asks the page itself: in the
   teacher's worksheet list, does a Polymath Online class show only its
   Current worksheet and its Next worksheet in the lesson, pinned to the top
   and tagged in words, with the rest of the list waiting in "📥 Queued in
   class lists"? Does "✓ Finished" sit under the Current card only? When the
   class moves on, does the list follow without a reload — the Next one
   becoming Current and the one after it loading as Next? Does a student
   see the tags but never the queue? And does it all fit a phone?

     node tools/class-queue-check.mjs
     PW=/path/to/playwright/index.mjs node tools/class-queue-check.mjs
   ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch (e) {
  console.log('class-queue-check: no Playwright at ' + PW + ' — skipped.');
  process.exit(0);
}

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;
const SHOTS = process.env.CQ_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (note ? '\n      ' + note : '')); }
};

// The cards fade in; a picture is taken once they have.
async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

const browser = await chromium.launch();

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const chain = () => new Proxy(function () { return chain(); }, {
      get: (t, k) => (k === 'then' ? undefined : chain()),
      apply: () => chain(), construct: () => chain(), set: () => true
    });
    window.pdfjsLib = chain(); window.firebase = chain(); window.grecaptcha = chain();
  });
  await page.route(/firebase-[a-z]+-compat\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

/* A Monday 5pm P5 Maths class of eight worksheets, on worksheet 3, next to
   a loose worksheet of the same lesson that belongs to no class list. */
function seed() {
  return (role) => {
    const ids = ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6', 'ws7', 'ws8'];
    onlineCourses = {
      k1: { id: 'k1', title: 'P5 Maths · Monday 5pm', level: 'P5', subject: 'math', day: 'Monday', slot: 1,
        worksheetIds: ids.slice(), currentIndex: 2, releasedThrough: 7 }
    };
    onlineCoursesLoaded = true;
    const docs = ids.map((id, i) => ({ id, data: {
      name: 'Term 4 · Worksheet ' + (i + 1), wsDay: 'Monday', wsSlot: 1, level: 'P5', subject: 'math',
      pageCount: 4, onlineCourseId: 'k1', onlineSeq: i, listOrder: i
    } }));
    docs.push({ id: 'loose', data: { name: 'Extra practice (not in a class list)', wsDay: 'Monday', wsSlot: 1, level: 'P5', subject: 'math', pageCount: 2, wsDate: '2026-11-02' } });
    if (role === 'student') {
      currentUser = { uid: 'stu-1', email: 'kid@example.com' };
      studentProfile = { name: 'Kid', level: 'P5', subject: 'math', days: ['Monday'], slot: 1 };
      // A student's list holds only what canSeeDoc lets through: released ones.
      qDocs = docs.filter(d => !d.data.onlineCourseId || d.data.onlineSeq <= 7);
    } else {
      currentUser = { uid: 'teacher', email: ADMIN_EMAIL };
      studentProfile = null;
      qDocs = docs;
    }
    actingStudent = null;
    try { applyRoleUI(); } catch (e) {}
    qSubjectFilter = 'all';
    qDayFilter = 'Monday';
    qQueuedOpen = false;
    $('qDrawer').classList.add('open');
    renderQuestionList();
    // Open the 5pm lesson.
    const head = document.querySelector('#qList .qSlotSection[data-slot="1"] .qSlotHead');
    const sec = document.querySelector('#qList .qSlotSection[data-slot="1"]');
    if (head && sec && sec.classList.contains('collapsed')) head.click();
    document.getElementById('qList').scrollTop = 0;
  };
}

const read = () => {
  const sec = document.querySelector('#qList .qSlotSection[data-slot="1"]');
  const cards = sec ? Array.prototype.map.call(sec.querySelectorAll(':scope > .qItemRow'), r => ({
    id: r.getAttribute('data-qid'),
    tag: (r.querySelector('.qClassTag') || {}).textContent || '',
    tip: (r.querySelector('.qClassTag') || {}).title || '',
    meta: (r.querySelector('.qItemMeta') || {}).textContent || '',
    cls: r.querySelector('.qItem').className,
    finish: !!r.querySelector('.qFinishBtn')
  })) : [];
  const q = document.querySelector('#qList .qQueuedGroup');
  return {
    cards,
    queued: q ? Array.prototype.map.call(q.querySelectorAll('.qItemRow'), r => r.getAttribute('data-qid')) : null,
    queuedHead: q ? q.querySelector('.qDayHead').textContent : '',
    queuedFolded: q ? q.classList.contains('collapsed') : null,
    classLabel: q && q.querySelector('.qQueuedClass') ? q.querySelector('.qQueuedClass').textContent : '',
    sub: $('qDrawerSub').textContent
  };
};

/* ---------- The teacher's list ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });
  ok('the page loads with no uncaught error', errors.length === 0, errors.join('\n      '));
  await page.evaluate(seed(), 'teacher');
  let s = await page.evaluate(read);
  const lessonIds = s.cards.map(c => c.id);
  ok('the lesson holds what was taught, the current and the next one, and the loose worksheet',
    JSON.stringify(lessonIds.slice().sort()) === JSON.stringify(['loose', 'ws1', 'ws2', 'ws3', 'ws4'].sort()), JSON.stringify(lessonIds));
  ok('the Current worksheet leads the lesson', s.cards[0] && s.cards[0].id === 'ws3', JSON.stringify(lessonIds));
  ok('the Next worksheet comes right under it', s.cards[1] && s.cards[1].id === 'ws4', JSON.stringify(lessonIds));
  ok('Current is said in words', s.cards[0].tag === '▶ Current worksheet', s.cards[0].tag);
  ok('Next is said in words too', s.cards[1].tag === '⏭ Next worksheet', s.cards[1].tag);
  ok('each card gives its place in the class list', /#3 of 8/.test(s.cards[0].meta) && /#4 of 8/.test(s.cards[1].meta), s.cards[0].meta);
  ok('the tag explains itself on hover', /Worksheet 3 of 8 in P5 Maths · Monday 5pm/.test(s.cards[0].tip), s.cards[0].tip);
  ok('the cards wear their colours', /classCurrent/.test(s.cards[0].cls) && /classNext/.test(s.cards[1].cls));
  ok('worksheets already taught carry no tag', s.cards.filter(c => c.id === 'ws1' || c.id === 'ws2').every(c => !c.tag));
  ok('Finished sits under the Current card and nowhere else', s.cards.filter(c => c.finish).map(c => c.id).join() === 'ws3');
  ok('the rest of the class list waits in Queued', JSON.stringify(s.queued) === JSON.stringify(['ws5', 'ws6', 'ws7', 'ws8']), JSON.stringify(s.queued));
  ok('Queued starts folded and counts them', s.queuedFolded === true && /Queued in class lists\s*4/.test(s.queuedHead), s.queuedHead);
  ok('Queued names its class and where it is', /P5 Maths · Monday 5pm · on worksheet 3 of 8 · 4 queued/.test(s.classLabel), s.classLabel);
  ok('the heading counts the queue', /📥 4 queued/.test(s.sub), s.sub);
  await shot(page, 'teacher-current-next.png');

  await page.click('#qList .qQueuedGroup .qDayHead');
  s = await page.evaluate(read);
  ok('a tap opens Queued', s.queuedFolded === false);
  const queuedTags = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#qList .qQueuedGroup .qClassTag'), t => t.textContent));
  ok('each queued card says its place', queuedTags.length === 4 && queuedTags[0] === '📥 Queued', JSON.stringify(queuedTags));
  const drag = await page.evaluate(() => document.querySelectorAll('#qList .qQueuedGroup .qItemRow.canArrange').length);
  ok('queued cards cannot be dragged into a lesson', drag === 0);
  await shot(page, 'teacher-queued-open.png');

  // The class moves on, as the live watch would report it.
  await page.evaluate(() => { onlineCourses.k1.currentIndex = 3; onlineAfterProgress(); });
  s = await page.evaluate(read);
  ok('after the class moves on, the old Next is Current', s.cards[0] && s.cards[0].id === 'ws4' && /Current worksheet/.test(s.cards[0].tag) && /#4 of 8/.test(s.cards[0].meta), JSON.stringify(s.cards[0]));
  ok('and the one after it has loaded as Next', s.cards[1] && s.cards[1].id === 'ws5' && /Next worksheet/.test(s.cards[1].tag) && /#5 of 8/.test(s.cards[1].meta), JSON.stringify(s.cards[1]));
  ok('the finished one has lost its tag', s.cards.some(c => c.id === 'ws3' && !c.tag));
  ok('the queue is one shorter', JSON.stringify(s.queued) === JSON.stringify(['ws6', 'ws7', 'ws8']), JSON.stringify(s.queued));
  ok('Queued stays open across the redraw', s.queuedFolded === false);
  await shot(page, 'teacher-after-finish.png');

  await page.evaluate(() => { onlineCourses.k1.currentIndex = 7; onlineAfterProgress(); });
  s = await page.evaluate(read);
  ok('on the last worksheet there is no Next and no Finished', s.cards[0].id === 'ws8' && !s.cards.some(c => /Next/.test(c.tag)) && !s.cards.some(c => c.finish));
  ok('and nothing left queued', s.queued === null);
  ok('no error along the way', errors.length === 0, errors.join('\n      '));
  await ctx.close();
}

/* ---------- A student ---------- */
{
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });
  await page.evaluate(seed(), 'student');
  const s = await page.evaluate(read);
  ok('a student sees the Current and Next tags', s.cards.some(c => c.id === 'ws3' && /Current worksheet/.test(c.tag)) && s.cards.some(c => c.id === 'ws4' && /Next worksheet/.test(c.tag)));
  ok('a student never sees Queued, or a Finished button', s.queued === null && !s.cards.some(c => c.finish));
  ok('a student still has everything released to them', s.cards.length === 9, String(s.cards.length));
  ok('no error for a student', errors.length === 0, errors.join('\n      '));
  await shot(page, 'student-tags.png');
  await ctx.close();
}

/* ---------- A phone ---------- */
{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.evaluate(seed(), 'teacher');
  const fit = await page.evaluate(() => {
    const list = $('qList');
    const w = list.clientWidth;
    const over = [];
    list.querySelectorAll('.qClassTag, .qFinishBtn').forEach(el => {
      const r = el.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (el.offsetHeight && r.right > lr.right + 1) over.push(el.className + ' ' + Math.round(r.right - lr.right));
    });
    return { w, over, scroll: list.scrollWidth - list.clientWidth };
  });
  ok('phone: the tags and the Finished button fit the list', fit.over.length === 0, JSON.stringify(fit.over));
  ok('phone: the list does not scroll sideways', fit.scroll <= 1, String(fit.scroll));
  ok('phone: no error', errors.length === 0, errors.join('\n      '));
  await shot(page, 'phone-current-next.png');
  await ctx.close();
}

await browser.close();
console.log('\nclass-queue-check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
