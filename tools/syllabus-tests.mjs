// Regression tests for 📚 THE SCIENCE SYLLABUS window.
// Run with:
//     node tools/syllabus-tests.mjs            all cases
//     node tools/syllabus-tests.mjs <name>     one case
//
// It loads the REAL data and the REAL matcher out of index.html. The window is
// a reference a teacher looks a term up in mid-lesson, so every failure here is
// quiet and lands at the worst moment:
//
//  • AN "OR" MATCH IS THE SAME AS NO SEARCH. "states of matter" has to come
//    back with the two sections about it, not with half the syllabus.
//  • A TERM MUST MATCH THE KEYWORDS, not only the wording — "evaporation" has
//    to find the section that never spells the word out in its title.
//  • THE MARKS AND THE HITS MUST AGREE. Marking a word the matcher ignored
//    speckles the page with highlights that mean nothing; marking one it
//    matched on and leaving it plain hides WHY a section came up.
//  • THE MARKUP IS BUILT BY HAND, so the escape has to come before the mark or
//    the syllabus is being written into the page as HTML.
//  • NO QUESTIONS. This shows the syllabus and nothing else — the question
//    bank belongs to the Science portal, and a half-wired "questions" section
//    under every objective would read as broken.
import fs from 'fs';

const APP = new URL('../index.html', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in index.html');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

// The data and the pure half of the window — everything up to the first
// function that touches the DOM, so the harness needs no document.
const block = cut('var SYLLABUS_TOPICS = [', '\nvar _sylTheme', 'syllabus');
const S = new Function(`
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  ${block}
  return { SYLLABUS_TOPICS, sylIndex, sylSearch, sylGroup, sylMark, sylWords, SYL_STOP };
`)();

let pass = 0, fail = 0;
const only = process.argv[2];
const queue = [];
const section = t => queue.push(() => console.log(t));
function test(name, fn) {
  if (only && !name.includes(only)) return;
  queue.push(() => {
    try { fn(); console.log('  ✅ ' + name); pass++; }
    catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); fail++; }
  });
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const titles = q => S.sylSearch(q).map(r => r.lo.title);
const topics = q => S.sylGroup(S.sylSearch(q)).map(g => g.topic);

section('\nTHE DATA');

test('every topic carries a level, a theme and at least one objective', () => {
  ok(S.SYLLABUS_TOPICS.length >= 15, 'only ' + S.SYLLABUS_TOPICS.length + ' topics');
  S.SYLLABUS_TOPICS.forEach((t, i) => {
    ok(t.topic && t.level && t.theme, 'topic ' + i + ' is missing a field');
    ok(/^P[3-6]$/.test(t.level), 'topic ' + i + ' has level ' + t.level);
    ok(Array.isArray(t.los) && t.los.length, t.topic + ' has no objectives');
  });
});

test('every objective has the four things the card prints', () => {
  S.sylIndex().forEach(r => {
    ok(r.lo.id, 'an objective in ' + r.topic + ' has no id');
    ok(r.lo.title, r.lo.id + ' has no title');
    ok(r.lo.intro, r.lo.id + ' has no intro — the card would print a gap');
    ok(r.lo.obj, r.lo.id + ' has no objective line');
    ok(Array.isArray(r.lo.kw) && r.lo.kw.length, r.lo.id + ' has no keywords, so a term can only find it by its wording');
  });
});

test('no objective id is used twice', () => {
  const seen = new Set();
  S.sylIndex().forEach(r => {
    ok(!seen.has(r.lo.id), 'duplicate objective id: ' + r.lo.id);
    seen.add(r.lo.id);
  });
});

test('THE SYLLABUS CARRIES NO QUESTIONS', () => {
  // This window shows the syllabus and nothing else. A `questions` field
  // copied across from the portal would be dead weight at best and a
  // half-wired feature at worst.
  S.sylIndex().forEach(r => {
    ok(!('questions' in r.lo) && !('qs' in r.lo), r.lo.id + ' carries questions');
  });
  ok(!/questions?:/i.test(block), 'the syllabus block mentions a questions field');
});

section('\nTHE SEARCH');

test('an empty search is the WHOLE syllabus, not nothing', () => {
  eq(S.sylSearch('').length, S.sylIndex().length);
  eq(S.sylSearch('   ').length, S.sylIndex().length);
});

test('"states of matter" finds the sections about it and little else', () => {
  const t = topics('states of matter');
  eq(t, ['Cycles in Matter and Water (Matter)', 'Cycles in Matter and Water (Water)']);
  ok(titles('states of matter').includes('The three states of matter'));
});

test('EVERY WORD MUST MATCH — an OR would return half the syllabus', () => {
  const both = S.sylSearch('states matter').length;
  const one = S.sylSearch('matter').length;
  ok(both < one, 'adding a word did not narrow the search: ' + both + ' vs ' + one);
  ok(both > 0, 'and it must not narrow it to nothing');
});

test('a term is matched on the KEYWORDS, not only the wording', () => {
  // "evaporation" is a keyword on sections whose titles never say it.
  const found = titles('evaporation');
  ok(found.length >= 2, 'only ' + found.length + ' sections found');
  ok(found.some(t => !/evaporat/i.test(t)), 'every hit spelled it out in its own title — the keywords are not being read');
});

test('a level and a theme can be searched together', () => {
  const rows = S.sylSearch('P5 systems');
  ok(rows.length > 0);
  rows.forEach(r => eq(r.level, 'P5', 'a level filter let another level through'));
});

test('the search is case-insensitive', () => {
  eq(titles('MAGNET').length, titles('magnet').length);
});

test('a term nobody teaches comes back empty, not with everything', () => {
  eq(S.sylSearch('zzzzqqq').length, 0);
});

test('a comma or extra spaces do not break it', () => {
  eq(titles('states,  matter').length, titles('states matter').length);
});

section('\nSTOP-WORDS — the words that carry nothing');

test('a stop-word does not narrow the search', () => {
  eq(S.sylSearch('states of matter').length, S.sylSearch('states matter').length,
     '"of" was held against the search');
});

test('…but a search made ONLY of stop-words still searches', () => {
  ok(S.sylWords('of the').length > 0, 'the search fell back to nothing and would return the whole syllabus');
  eq(S.sylWords('of the'), ['of', 'the']);
});

test('THE MARKS AND THE MATCHER READ THE SAME WORDS', () => {
  // renderSyllabus marks with sylWords and the matcher matches with it, so a
  // highlight can never appear on a word the search ignored.
  eq(S.sylWords('states of matter'), ['states', 'matter']);
});

section('\nTHE MARKUP');

test('the words searched for are marked', () => {
  const out = S.sylMark('The three states of matter', S.sylWords('states of matter'));
  ok(/<span class="sylHit">states<\/span>/.test(out), out);
  ok(/<span class="sylHit">matter<\/span>/.test(out), out);
  ok(!/<span class="sylHit">of<\/span>/.test(out), 'a stop-word was highlighted: ' + out);
});

test('THE TEXT IS ESCAPED BEFORE IT IS MARKED', () => {
  const out = S.sylMark('<img src=x onerror=alert(1)> water', ['water']);
  ok(!/<img/.test(out), 'the syllabus reached the page as markup: ' + out);
  ok(/&lt;img/.test(out));
  ok(/<span class="sylHit">water<\/span>/.test(out), 'and the mark must still work');
});

test('a search term with a regex character does not break the mark', () => {
  const out = S.sylMark('a + b (c)', S.sylWords('+ (c)'));
  ok(typeof out === 'string' && out.length, 'the mark threw on a regex character');
});

test('nothing searched for means nothing marked', () => {
  eq(S.sylMark('plain text', []), 'plain text');
});

test('a longer term wins over a shorter one inside it', () => {
  // Marking "state" first would leave "states" split across two spans.
  const out = S.sylMark('states', ['state', 'states']);
  eq((out.match(/sylHit/g) || []).length, 1, 'the same word was marked twice over: ' + out);
});

section('\nTHE GROUPING');

test('objectives come back grouped under their own topic, in syllabus order', () => {
  const groups = S.sylGroup(S.sylSearch(''));
  eq(groups.length, S.SYLLABUS_TOPICS.length);
  eq(groups.map(g => g.topic), S.SYLLABUS_TOPICS.map(t => t.topic));
  eq(groups.reduce((n, g) => n + g.los.length, 0), S.sylIndex().length, 'an objective was lost in the grouping');
});

test('a group carries the level and theme its heading prints', () => {
  S.sylGroup(S.sylSearch('magnet')).forEach(g => ok(g.level && g.theme, g.topic + ' has no heading meta'));
});

for (const run of queue) run();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
