/* Loads the REAL teaching-notes section out of anskey's index.html and runs it
   against stubs. Everything here fails silently in the app — a digest that
   comes back empty just means an ungrounded prompt, and nothing throws. */
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* ================= Teaching notes & AI style training');
const end = html.indexOf('/* ================= Gemini AI helpers', start);
if (start < 0 || end < 0) { console.error('section not found'); process.exit(1); }
const src = html.slice(start, end);

const prelude = `
var wsMeta = { level: 'P5', subject: 'science', name: 'WS' };
var annotations = [];
var currentUser = { uid: 'admin1', email: 'chungzhikai@gmail.com' };
var actingStudent = null;
var currentDocId = 'doc1';
var docName = 'Heat worksheet';
var pdfDoc = null, pages = [], aiBusy = false;
var practiceMode = false, wsEpoch = 1, sharedLink = null;
function currentPageNum() { return 0; }
function notesLiveRepaint() {}
function renderNotesBody() {}
var LEVELS = ['P3','P4','P5','P6','S1'];
var COLLECTION = 'pdfAnnotator';
var KEY_PAGE_PX = 2200;
function isAdmin(u) { return !!u && u.email === 'chungzhikai@gmail.com'; }
function isSharedVisitor() { return false; }
function subjectLabel(s) { return s === 'math' ? 'Mathematics' : s === 'science' ? 'Science' : ''; }
function levelLabel(l) { return l === 'S1' ? 'Sec 1' : (l || ''); }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(id) { return null; }
function toast() {}
function aiEngineName() { return 'Gemini'; }
function keyPageJpeg() { return Promise.resolve(null); }
function readAnnotationJson() { return Promise.resolve('[]'); }
function _parseAIJson(s) { return JSON.parse(s); }
var savedDoc = null;
var db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({
  set: d => { savedDoc = d; return Promise.resolve(); },
  get: () => Promise.resolve({ exists: false })
}) }), get: () => Promise.resolve({ forEach: () => {} }) }) }) };
var localStorage = { getItem: () => null, setItem: () => {} };
var confirm = () => true;
var window = { askGemini: null, aiReady: () => false };
`;

const mod = new Function(prelude + src + '\nreturn { notesBlock, styleBlock, aiGrounding, guidanceBlock, notesGuidance, quickNoteTitleFrom, styleAddSamples, styleWorthLearning, styleHarvestTyped, styleEnsure, notesRelevant, noteAppliesHere, notesCardHtml, noteSourceLabel, notesKeywordList, notesLedgerFor, notesLedgerCounts, notesFairShare, notesTrimTo, NOTES_TRIM_MARK, autoLearnMergeInto, autoLearnMergeLines, autoLearnMergeWords, autoLearnWorthReading, autoLearnSig, autoLearnAllowed, autoLearnSetOn, autoLearnNoteId, autoLearnPageSig, AUTO_READ_SYS, AUTO_KW_MAX, AUTO_FACT_CHARS, setPractice: v => { practiceMode = v; }, setActing: v => { actingStudent = v; }, setUser: v => { currentUser = v; }, setNotes: v => { teachingNotes = v; }, setStyle: v => { aiStyle = v; }, setMeta: v => { wsMeta = v; }, getSamples: () => styleSamples() };')();

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); fails++; }
}

console.log('\nNo notes, no style → no grounding at all');
mod.setNotes([]); mod.setStyle(null);
ok('grounding is empty', mod.aiGrounding('answer') === '');

console.log('\nNotes reach the prompt');
mod.setNotes([{ id: 'n1', keywords: ['gains heat', 'expands'], markingStandards: 'Must name the heat gain.', keyFacts: 'Matter expands when heated.' }]);
const g = mod.aiGrounding('answer');
ok('keywords are in it', /gains heat/.test(g));
ok('key facts are in it', /Matter expands/.test(g));
ok('authority order is stated', /AUTHORITY ORDER/.test(g));
const m = mod.aiGrounding('mark');
ok('marking gets the standards', /Must name the heat gain/.test(m));
ok('marking never overrides the model answer', /never mark against it/.test(m));
ok('marking is not padded with key facts', !/Matter expands/.test(m));

console.log('\nA note typed by hand is general guidance, and reaches every kind of call');
mod.setNotes([{ id: 'q1', guidance: 'Always answer in full sentences.', subjects: [], levels: [], keywords: [] }]);
mod.setMeta({ level: 'P5', subject: 'science' });
ok('answering hears it', /Always answer in full sentences/.test(mod.aiGrounding('answer')));
ok('teaching hears it', /Always answer in full sentences/.test(mod.aiGrounding('teach')));
ok('marking hears it too', /Always answer in full sentences/.test(mod.aiGrounding('mark')));
ok('it is named as the guidance, not as uploaded notes', /GENERAL GUIDANCE/.test(mod.aiGrounding('answer')));
ok('the authority order places it', /general guidance/.test(mod.aiGrounding('mark')));
ok('guidance alone is enough to ground a prompt', mod.aiGrounding('answer') !== '');
ok('a note with no guidance adds none', (mod.setNotes([{ id: 'z', keywords: ['x'] }]), mod.guidanceBlock() === ''));
mod.setNotes([{ id: 'g1', guidance: 'Rule one.' }, { id: 'g2', guidance: 'Rule two.' }]);
ok('every guidance note is carried', /Rule one\.[\s\S]*Rule two\./.test(mod.notesGuidance()));
mod.setNotes([{ id: 'g3', guidance: 'x', subjects: ['math'], levels: ['P6'] }, { id: 'g4', guidance: 'science only', subjects: ['science'], levels: ['P5'] }]);
ok('guidance still follows the note it belongs to', mod.notesGuidance() === 'science only');
ok('a title is taken off the first line', mod.quickNoteTitleFrom('Full sentences always\nand name the process') === 'Full sentences always');
ok('an empty note still gets a title', mod.quickNoteTitleFrom('') === 'Quick note');
mod.setNotes([]);

console.log('\nA note names its subject and level');
mod.setNotes([
  { id: 'a', subjects: ['science'], levels: ['P5'], keywords: ['photosynthesis'] },
  { id: 'b', subjects: ['math'], levels: ['P6'], keywords: ['numerator'] }
]);
mod.setMeta({ level: 'P5', subject: 'science' });
ok('the matching note applies', mod.notesRelevant().map(n => n.id).join() === 'a');
mod.setMeta({ level: 'P3', subject: 'math' });
ok('nothing matches → the whole notebook is used, never none of it',
   mod.notesRelevant().length === 2);
mod.setNotes([{ id: 'c', keywords: ['x'] }]);
mod.setMeta({ level: 'S1', subject: 'math' });
ok('a note naming neither applies everywhere', mod.notesRelevant().length === 1);

console.log('\nThe learned style reaches the prompt');
mod.setNotes([]);
mod.setStyle({ samples: [], profileSamples: 40, profile: {
  styleRules: 'Two short sentences, no working shown.',
  phrasing: 'Always opens with "This is because".',
  markingStandards: 'The keyword must appear.',
  keywords: ['because', 'therefore'],
  exemplars: [{ q: 'Why does ice melt?', a: 'It gains heat from the surroundings.' }]
} });
const s1 = mod.aiGrounding('answer');
ok('the style rules are in it', /Two short sentences/.test(s1));
ok('real answers are shown as exemplars', /gains heat from the surroundings/.test(s1));
ok('it says how many answers taught it', /40 answers/.test(s1));
const s2 = mod.aiGrounding('mark');
ok('marking hears how the teacher marks', /The keyword must appear/.test(s2));
ok('marking is not given exemplar answers to copy', !/Why does ice melt/.test(s2));

console.log('\nHarvesting the answers already typed on a worksheet');
const anns = [
  { id: 'a1', type: 'text', text: 'It gains heat from the surroundings and melts.' },
  { id: 'a2', type: 'text', text: '12' },
  { id: 'a3', type: 'text', text: '✓' },
  { id: 'a4', type: 'text', text: 'Q3' },
  { id: 'a5', type: 'pen', text: 'ignored' },
  { id: 'a6', type: 'text', text: '' }
];
const got = mod.styleHarvestTyped(anns, 'doc9', { level: 'P5', subject: 'science', name: 'Heat' });
ok('only the real answer is learned', got.length === 1, JSON.stringify(got.map(x => x.a)));
ok('it is keyed by worksheet and annotation', got[0].k === 'doc9:a1');
ok('a bare number teaches nothing', !mod.styleWorthLearning('12'));
ok('a tick teaches nothing', !mod.styleWorthLearning('✓'));
ok('a sentence does', mod.styleWorthLearning('It gains heat.'));

console.log('\nThe corpus never learns the same answer twice, and never overflows');
mod.setStyle({ samples: [], profileSamples: 0, learnedDocs: {} });
ok('first pass learns it', mod.styleAddSamples(got) === 1);
ok('second pass learns nothing new', mod.styleAddSamples(got) === 0);
const many = [];
for (let i = 0; i < 500; i++) many.push({ k: 'x' + i, a: 'An answer number ' + i });
mod.styleAddSamples(many);
ok('the corpus is capped', mod.getSamples().length === 400, String(mod.getSamples().length));
ok('the newest survive, the oldest fall off', mod.getSamples()[399].k === 'x499');

console.log('\nA note card renders its own wording, escaped');
const card = mod.notesCardHtml({ id: 'n1', title: 'Heat <b>notes</b>', keywords: ['a & b'], subjects: ['science'], levels: ['P5'] });
ok('the title is escaped', card.includes('Heat &lt;b&gt;notes&lt;/b&gt;'));
ok('the keyword is escaped', card.includes('a &amp; b'));
ok('the subject and level are shown', card.includes('Science') && card.includes('P5'));

console.log('\nOne notebook, three apps — the card says which one wrote the note');
ok('a note written here is not labelled at all', mod.noteSourceLabel({ source: 'anskey' }) === '');
ok('a note written in the Scan app names the Scan app', mod.noteSourceLabel({ source: 'scan' }) === 'from Scan & Answer');
ok('anything else is the Learning Portal, as it always was', mod.noteSourceLabel({}) === 'from the Learning Portal');
const corr = mod.notesCardHtml({
  id: 'n9', title: 'Name the process', source: 'scan', noteKind: 'correction',
  guidance: 'Always name the process.', sourceQuestion: 'How would this affect the peaches?',
  keyFacts: 'Question: How would this affect the peaches?\nThe answer is: They grow larger.',
  keywords: [], subjects: [], levels: []
});
ok('a correction from the Scan app says so', corr.includes('from Scan &amp; Answer') || corr.includes('from Scan & Answer'));
ok('the rule is shown as guidance', corr.includes('Always name the process.'));
ok('and the question it was written against is shown with it', corr.includes('Written against'));
ok('the corrected answer is kept as a key fact', corr.includes('They grow larger.'));


/* ---- NO NOTE IS EVER SILENTLY DROPPED ----
   The bug the teacher reported. The budgets used to be a `.slice()` over the
   JOINED text of every relevant note, so with two long standing instructions
   the first lost most of itself and the SECOND reached no prompt at all —
   while sitting in this very window looking obeyed. */
console.log('\nEvery note reaches the prompt, however lots there are');
const lots = [];
for (let i = 0; i < 12; i++) lots.push({ id: 'm' + i, subjects: [], levels: [], keywords: [], guidance: 'RULE-SENTINEL-' + i + ' ' + 'w'.repeat(900) });
mod.setNotes(lots); mod.setStyle(null);
['answer', 'mark', 'teach'].forEach(kind => {
  const dig = mod.aiGrounding(kind);
  const missing = lots.filter(n => !dig.includes('RULE-SENTINEL-' + n.id.slice(1)));
  ok('every standing instruction reaches a "' + kind + '" prompt', missing.length === 0,
     missing.length + ' of 12 were dropped entirely');
});

console.log('\nOver-long is trimmed, not vanished');
mod.setNotes([{ id: 'big', subjects: [], levels: [], keywords: [], guidance: 'OPENING-SENTINEL ' + 'x'.repeat(9000) }]);
const bigOut = mod.notesGuidance();
ok('the opening survives', bigOut.includes('OPENING-SENTINEL'));
ok('it says it was trimmed', bigOut.includes(mod.NOTES_TRIM_MARK));
ok('it does not go in whole', bigOut.length < 9000, 'length ' + bigOut.length);
mod.setNotes([{ id: 's1', subjects: [], levels: [], keywords: [], guidance: 'Units on every numerical answer.' }]);
ok('a short note goes in word for word', mod.notesGuidance().includes('Units on every numerical answer.'));

console.log('\nThe same rule typed in two apps is ONE rule');
mod.setNotes([{ id: 'd1', subjects: [], levels: [], keywords: [], guidance: 'Always name the process.' },
              { id: 'd2', subjects: [], levels: [], keywords: [], guidance: 'Always name the process.  ' }]);
ok('a duplicated rule is not sent twice', mod.notesGuidance().split('Always name the process.').length - 1 === 1);

console.log('\nThe window says what did not fit');
mod.setNotes([{ id: 'fits', subjects: [], levels: [], keywords: [], guidance: 'Short rule.' }]);
mod.aiGrounding('answer');
ok('a note that fits is not reported', mod.notesLedgerFor('fits') === null);
ok('nothing is reported when nothing was cut', mod.notesLedgerCounts().trimmed === 0 && mod.notesLedgerCounts().dropped === 0);
mod.setNotes(lots);
mod.aiGrounding('answer');
ok('a trimmed note IS reported', mod.notesLedgerCounts().trimmed > 0);
const ledger0 = mod.notesLedgerFor('m0');
ok('the report names the note and its real numbers', !!ledger0 && ledger0.wanted > ledger0.kept, JSON.stringify(ledger0));
ok('the card says so', mod.notesCardHtml(lots[0]).includes('Trimmed'));

console.log('\nMarking never sees the key facts, however tight the budget');
const leaky = { id: 'sec', subjects: [], levels: [], keywords: [], markingStandards: 'State the direction.', keyFacts: 'THE-ANSWER-IS-42' };
mod.setNotes([leaky]);
ok('an answer digest DOES see them', mod.aiGrounding('answer').includes('THE-ANSWER-IS-42'));
ok('marking does not', !mod.aiGrounding('mark').includes('THE-ANSWER-IS-42'));
mod.setNotes(lots.concat([leaky]));
ok('marking still does not, over budget', !mod.aiGrounding('mark').includes('THE-ANSWER-IS-42'));

console.log('\nThe fair-share rule itself');
{
  const share = mod.notesFairShare([{ id: 'a', text: 'short' }, { id: 'b', text: 'y'.repeat(5000) }], 600, 120);
  ok('the short note survives whole beside a huge one', share.texts[0] === 'short');
  ok('the huge note is trimmed rather than the short one dropped', share.texts.length === 2);
  ok('nothing is dropped when the floor fits', share.dropped.length === 0);
}

/* ---- THE CENSUS ----
   "Every AI function checks the teaching notes first" cannot be kept by
   remembering: a call site added next month is grounded or it is not, and
   nothing on any screen says which — the AI answers fluently in its own voice
   instead of the teacher's. So the file itself is read. Adding a call that
   should NOT be grounded means typing a sentence here saying why. */
console.log('\nEvery AI call site is grounded, or exempt on purpose');
{
  const UNGROUNDED_BY_DESIGN = {
    aiRequest: 'transport — the system prompt arrives already grounded from aiAnswer / aiImprove',
    askGemini: 'the door every call goes through',
    askOpenAI: 'the raw OpenAI call',
    askKimi: 'the raw Moonshot call',
    kimiActive: 'reads a setting',
    refreshAiEngineNames: 'paints the engine name on screen',
    kimiListModels: 'asks the account which models it has',
    notesHandleFiles: 'this is what READS the notes; grounding it is a feedback loop',
    styleDistil: 'this is what BUILDS the style profile from the teacher’s own answers',
    styleLearnOpenWorksheet: 'reads answers off a worksheet to learn from them',
    styleLearnAllWorksheets: 'the same sweep across every saved worksheet',
    autoLearnRunJob: 'reads a page to WRITE the notes; grounding it would feed the notebook its own echo',
    aiNoteImage: 'asks the IMAGE model for a picture; its SVG fallback is grounded',
    endDrag: 'a pointer handler — the AI call in view belongs to window.askGemini below it',
  };
  const lines = html.split('\n');
  const fns = [];
  lines.forEach((l, i) => {
    // `window.askGemini = async function askGemini(` is how the transport is
    // declared, so a bare `^function` sweep would miss the three doors every
    // call in the app goes through — and then their exemptions read as stale.
    const m = l.match(/^\s{0,2}(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/)
           || l.match(/^\s{0,2}window\.[A-Za-z0-9_$]+\s*=\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) fns.push({ name: m[1], line: i });
  });
  const bodyOf = {};
  fns.forEach((f, k) => { const e = k + 1 < fns.length ? fns[k + 1].line : lines.length; bodyOf[f.name] = lines.slice(f.line, e).join('\n'); });
  const g = n => /aiGrounding\s*\(/.test(bodyOf[n] || '');
  const grounded = n => g(n) || fns.some(f => f.name !== n && g(f.name) && new RegExp('\\b' + f.name.replace(/\$/g, '\\$') + '\\s*\\(').test(bodyOf[n] || ''));
  const owner = i => { let b = null; for (const f of fns) { if (f.line <= i) b = f; else break; } return b; };
  const callRe = /\b(?:window\.)?(?:askGemini|askOpenAI|askKimi)\s*\(/;
  const seen = new Map();
  lines.forEach((l, i) => { if (!callRe.test(l)) return; const o = owner(i); if (o && !seen.has(o.name)) seen.set(o.name, i + 1); });
  ok('the census found the call sites at all', seen.size > 6, seen.size + ' found');
  const loose = [];
  for (const [n, ln] of seen) {
    if (grounded(n) || Object.prototype.hasOwnProperty.call(UNGROUNDED_BY_DESIGN, n)) continue;
    loose.push(n + ' (index.html:' + ln + ')');
  }
  ok('nothing is ungrounded by accident', loose.length === 0, loose.join(', '));
  const stale = Object.keys(UNGROUNDED_BY_DESIGN).filter(n => !bodyOf[n]);
  ok('no exemption names a function that no longer exists', stale.length === 0, stale.join(', '));

  /* `aiRequest` is exempt because its SYSTEM PROMPT arrives already grounded
     from the button that called it — so the census cannot see ✨ Answer or
     ✒️ Improve at all, and either one could quietly stop grounding without a
     single check moving. The exemption is only true if every caller really
     does pass the grounding, so that is checked directly. */
  const reqCalls = lines
    .map((l, i) => ({ l, i }))
    .filter(x => /(?:^|[^A-Za-z0-9_$.])aiRequest\s*\(/.test(x.l) && !/^\s{0,2}function aiRequest/.test(x.l));
  ok('the ✨ Answer / ✒️ Improve call sites were found', reqCalls.length >= 2, reqCalls.length + ' found');
  const bare = reqCalls.filter(x => !/aiGrounding\s*\(/.test(x.l)).map(x => 'index.html:' + (x.i + 1));
  ok('every aiRequest passes a grounded system prompt', bare.length === 0, bare.join(', '));
}


console.log('\n📚 Learning as you go — what counts as a page worth reading');
ok('a text box with real words does', mod.autoLearnWorthReading([{ type: 'text', text: 'Heat flows from hot to cold.' }]));
ok('a page number does not', !mod.autoLearnWorthReading([{ type: 'text', text: 'Page 3' }]));
ok('a single tick does not buy an AI call', !mod.autoLearnWorthReading([{ type: 'pen' }, { type: 'pen' }]));
ok('a handwritten answer does', mod.autoLearnWorthReading([{ type: 'pen' }, { type: 'pen' }, { type: 'pen' }, { type: 'pen' }]));
ok('an empty page does not', !mod.autoLearnWorthReading([]));

console.log('\n…and whether it may be read at all');
mod.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com' });
mod.setPractice(false); mod.setActing(null); mod.autoLearnSetOn(true);
ok('the teacher on their own worksheet: yes', mod.autoLearnAllowed());
mod.setPractice(true);
ok("a child's attempt is never learned as the teacher's", !mod.autoLearnAllowed());
mod.setPractice(false); mod.setActing({ name: 'Ann' });
ok('nor is the iPad handed to a student', !mod.autoLearnAllowed());
mod.setActing(null); mod.setUser({ uid: 's1', email: 'student@x.com' });
ok('nor anybody who is not the teacher', !mod.autoLearnAllowed());
mod.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com' });
mod.autoLearnSetOn(false);
ok('nor when it is switched off', !mod.autoLearnAllowed());
mod.autoLearnSetOn(true);

console.log('\nThe signature: read once, and again only when the page changes');
const a1 = [{ type: 'text', id: 't1', text: 'gains heat' }];
ok('the same page hashes the same', mod.autoLearnSig(a1) === mod.autoLearnSig([{ type: 'text', id: 't1', text: 'gains heat' }]));
ok('a correction of the SAME LENGTH is still a change',
   mod.autoLearnSig(a1) !== mod.autoLearnSig([{ type: 'text', id: 't1', text: 'loses heat' }]));
ok('another answer added is a change',
   mod.autoLearnSig(a1) !== mod.autoLearnSig(a1.concat([{ type: 'pen', id: 'p1' }])));

console.log('\nMerging a page in');
const meta = { level: 'P5', subject: 'science', name: 'Heat Paper 2' };
let r = mod.autoLearnMergeInto(null, 3, 'sig3',
  { keywords: ['gains heat', 'expands'], keyFacts: 'Matter expands when heated.' }, meta);
ok('a note is made for the worksheet', !!r.note);
ok('it is marked as the app’s own', r.note.noteKind === 'auto');
ok('it is titled after the worksheet', /Heat Paper 2/.test(r.note.title));
ok('it is scoped to the level and subject', r.note.levels[0] === 'P5' && r.note.subjects[0] === 'science');
ok('the keywords are in it', r.note.keywords.join('|') === 'gains heat|expands');
ok('the key facts are in it', /Matter expands/.test(r.note.keyFacts));
ok('the page is recorded as read', mod.autoLearnPageSig(r.note, 3) === 'sig3');
ok('IT NEVER WRITES A MARKING STANDARD', !r.note.markingStandards);
ok('IT NEVER WRITES GENERAL GUIDANCE', !r.note.guidance);
ok('topics stay empty for the Learning Portal', r.note.topics.length === 0);

console.log('\n…and a second page MERGES rather than repeating');
let r2 = mod.autoLearnMergeInto(r.note, 4, 'sig4',
  { keywords: ['expands', 'EXPANDS ', 'contracts'], keyFacts: 'Matter expands when heated.\nMatter contracts when cooled.' }, meta);
ok('a keyword already there is not added twice', r2.note.keywords.filter(w => /^expands$/i.test(w)).length === 1);
ok('the new keyword is added', r2.note.keywords.indexOf('contracts') !== -1);
ok('a fact already there is not repeated', (r2.note.keyFacts.match(/Matter expands/g) || []).length === 1);
ok('the new fact is added', /Matter contracts/.test(r2.note.keyFacts));
ok('both pages are recorded', mod.autoLearnPageSig(r2.note, 3) === 'sig3' && mod.autoLearnPageSig(r2.note, 4) === 'sig4');
ok('the pages read are counted once each', r2.note.pagesRead === 2);
ok('the level is not repeated either', r2.note.levels.length === 1);

console.log('\nA page that taught nothing is still never read twice');
let r3 = mod.autoLearnMergeInto(r2.note, 5, 'sig5', { teaches: false, keywords: [], keyFacts: '' }, meta);
ok('the signature is recorded anyway', mod.autoLearnPageSig(r3.note, 5) === 'sig5');
ok('nothing was added', r3.added === 0);

console.log('\nA note that is full SAYS so rather than dropping the rest silently');
const long = Array.from({ length: 60 }, (_, i) => 'Fact number ' + i + ' about heat and how it moves around a room.').join('\n');
let rf = mod.autoLearnMergeInto(null, 1, 's1', { keywords: [], keyFacts: long }, meta);
ok('the key facts are capped', rf.note.keyFacts.length <= mod.AUTO_FACT_CHARS);
ok('and the note is flagged full', rf.note.full === true);
ok('whole lines are kept, never half a fact', rf.note.keyFacts.split('\n').every(l => /room\.$/.test(l)));
const manyKw = Array.from({ length: 90 }, (_, i) => 'term' + i);
let rk = mod.autoLearnMergeInto(null, 1, 's1', { keywords: manyKw, keyFacts: '' }, meta);
ok('the keywords are capped', rk.note.keywords.length === mod.AUTO_KW_MAX);
ok('and that is flagged too', rk.note.full === true);

console.log('\nThe reading prompt');
ok('it refuses to write marking rules', /NEVER write marking rules/.test(mod.AUTO_READ_SYS));
ok('it transcribes an answer rather than improving it', /never\s+correct it, complete it or improve it/.test(mod.AUTO_READ_SYS));
ok('it never invents a keyword', /Never invent a term the page does not show/.test(mod.AUTO_READ_SYS));
ok('the note id is per worksheet', mod.autoLearnNoteId('doc9') === 'auto_doc9');

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nAll good.\n');
process.exit(fails ? 1 : 0);
