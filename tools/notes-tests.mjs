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
var dirty = false;
var sharedVisitor = false;
function currentPageNum() { return 0; }
function notesLiveRepaint() {}
function renderNotesBody() {}
var LEVELS = ['P3','P4','P5','P6','S1'];
var COLLECTION = 'pdfAnnotator';
var KEY_PAGE_PX = 2200;
function isAdmin(u) { return !!u && u.email === 'chungzhikai@gmail.com'; }
function isSharedVisitor() { return sharedVisitor; }
function subjectLabel(s) { return s === 'math' ? 'Mathematics' : s === 'science' ? 'Science' : ''; }
function levelLabel(l) { return l === 'S1' ? 'Sec 1' : (l || ''); }
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
var fakeBtn = null;
function $(id) { return (id === 'saveBtn' && fakeBtn) ? fakeBtn : null; }
function makeSaveBtn(saved) {
  var cls = saved ? ['btnSaved'] : [];
  fakeBtn = {
    title: 'Save PDF + annotations to the cloud',
    classList: { contains: function (c) { return cls.indexOf(c) !== -1; } },
    _label: { textContent: saved ? '\u2713 Saved' : 'Save' },
    querySelector: function () { return this._label; }
  };
  return fakeBtn;
}
function toast() {}
function aiEngineName() { return 'Gemini'; }
function keyPageJpeg() { return Promise.resolve(null); }
function readAnnotationJson() { return Promise.resolve('[]'); }
function _parseAIJson(s) { return JSON.parse(s); }
var savedDoc = null;
var failNextSave = false;
var db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({
  set: d => { if (failNextSave) { failNextSave = false; return Promise.reject(new Error('permission-denied')); } savedDoc = d; return Promise.resolve(); },
  get: () => Promise.resolve({ exists: false })
}) }), get: () => Promise.resolve({ forEach: () => {} }) }) }) };
var localStorage = { getItem: () => null, setItem: () => {} };
var confirm = () => true;
var window = { askGemini: null, aiReady: () => false };
`;

const mod = new Function(prelude + src + '\nreturn { notesBlock, styleBlock, aiGrounding, guidanceBlock, notesGuidance, quickNoteTitleFrom, styleAddSamples, styleWorthLearning, styleHarvestTyped, styleEnsure, notesRelevant, noteAppliesHere, notesCardHtml, noteSourceLabel, notesKeywordList, notesLedgerFor, notesLedgerCounts, notesFairShare, notesTrimTo, NOTES_TRIM_MARK, autoLearnMergeInto, autoLearnMergeLines, autoLearnMergeWords, autoLearnWorthReading, autoLearnSig, autoLearnAllowed, autoLearnSetOn, autoLearnNoteId, autoLearnPageSig, AUTO_READ_SYS, AUTO_KW_MAX, AUTO_FACT_CHARS, setPractice: v => { practiceMode = v; }, setActing: v => { actingStudent = v; }, setUser: v => { currentUser = v; }, setNotes: v => { teachingNotes = v; }, setStyle: v => { aiStyle = v; }, setMeta: v => { wsMeta = v; }, getSamples: () => styleSamples(), setAnns: v => { annotations = v; }, styleUpsert, styleSampleKey, styleSlotOf, stylePruneDoc, styleCollectEdits, styleNoteGenerated, styleFitReport, styleEditRules, styleBucketKey, styleBucketLabel, styleProfilePick, styleProfileFor, styleExemplarsFor, styleExemplars, styleSamplesIn, styleBlock, _styleEditRatio, styleCleanProfile, styleProfileEmpty, styleGapOf, styleDistilDue, _styleProfileBits, styleEditsFor, styleEnsure2: () => styleEnsure(), getEdits: () => styleEdits(), styleHarvestAllowed, styleHarvestOnSave, styleSavedLabel, styleSavedTitle, styleAnnounceSaved, styleSave, setPracticeMode: v => { practiceMode = v; }, setVisitor: v => { sharedVisitor = v; }, setDoc: v => { currentDocId = v; }, makeSaveBtn, setDirty2: v => { dirty = v; }, failSave: () => { failNextSave = true; }, getScores: () => styleScores(), clearGen: () => { styleGen = {}; }, notesTrainingHtml, notesFitHtml, notesBucketsHtml, STYLE_DISTIL_SYS, STYLE_REFINE_SYS, STYLE_GEN_SYS, STYLE_BUCKET_MIN, STYLE_EDIT_TRIVIAL, STYLE_MIN_WORDS, STYLE_EX_MAX, STYLE_SAMPLE_MAX };')();

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
ok('it is keyed by worksheet, annotation AND content', got[0].k.indexOf('doc9:a1:') === 0 && got[0].k.length > 'doc9:a1:'.length);
ok('it is marked as typed, so the sweep can tell it from a page read', got[0].src === 'typed');
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
    styleProposeProfile: 'proposes the style description FROM the answers; grounding it would feed it its own echo',
    styleRefineProfile: 'rewrites that description against answers it got wrong — same reason',
    styleGenUnder: 'generates under a DRAFT profile to test it; the draft is the grounding, and the live one would contaminate the check',
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

/* ================= THE STYLE CORPUS, AND WHY IT STOPPED LEARNING =========
   Every failure below is silent: the app saves, the profile rebuilds, the
   panel fills in, and the answers quietly stop sounding like the teacher. */

console.log('\nA REVISED ANSWER IS LEARNED — the bug this release exists for');
mod.setStyle({ samples: [], profileSamples: 0, learnedDocs: {}, keyed: 1 });
const meta5 = { level: 'P5', subject: 'science', name: 'Heat' };
const draft = [{ id: 'a1', type: 'text', text: 'It gets hot and melts.' }];
mod.styleAddSamples(mod.styleHarvestTyped(draft, 'doc9', meta5));
ok('the first wording is learned', mod.getSamples().length === 1);
const fixed = [{ id: 'a1', type: 'text', text: 'It gains heat from the surroundings and melts.' }];
const n2 = mod.styleAddSamples(mod.styleHarvestTyped(fixed, 'doc9', meta5));
ok('THE REVISION IS LEARNED TOO', n2 === 1);
ok('and it SUPERSEDES the draft rather than sitting beside it', mod.getSamples().length === 1);
ok('the corpus holds the wording the teacher settled on', /gains heat from the surroundings/.test(mod.getSamples()[0].a));
ok('re-saving an unchanged box still costs nothing',
   mod.styleAddSamples(mod.styleHarvestTyped(fixed, 'doc9', meta5)) === 0);
ok('two different boxes are two samples',
   (mod.styleAddSamples(mod.styleHarvestTyped(
     [{ id: 'a2', type: 'text', text: 'The water vapour cools and condenses.' }], 'doc9', meta5)),
    mod.getSamples().length === 2));

console.log('\nA text box the teacher DELETED stops being learned from');
mod.setStyle({ samples: [], profileSamples: 0, learnedDocs: {}, keyed: 1 });
mod.styleAddSamples(mod.styleHarvestTyped([
  { id: 'a1', type: 'text', text: 'It gains heat and melts away.' },
  { id: 'a2', type: 'text', text: 'The water vapour cools and condenses.' }
], 'doc9', meta5));
ok('both are in', mod.getSamples().length === 2);
ok('deleting one sweeps it', mod.stylePruneDoc('doc9', [{ id: 'a2', type: 'text' }]) === 1);
ok('the other survives', mod.getSamples().length === 1 && /vapour/.test(mod.getSamples()[0].a));
mod.styleAddSamples([{ k: 'doc9:p2:0:abc', src: 'read', a: 'Read off the page by the model.', q: 'why' }]);
ok('a sample READ off the page is never swept — it has no annotation to be missing',
   (mod.stylePruneDoc('doc9', []), mod.getSamples().some(s => s.src === 'read')));
mod.styleAddSamples([{ k: 'other:b1:zz', src: 'typed', a: 'From a different worksheet entirely.' }]);
ok("another worksheet's samples are never swept",
   (mod.stylePruneDoc('doc9', []), mod.getSamples().some(s => s.k.indexOf('other:') === 0)));

console.log('\nA legacy corpus is re-keyed once, not duplicated');
mod.setStyle({ samples: [{ k: 'doc9:a1', a: 'It gains heat from the surroundings and melts.' }], profileSamples: 1, learnedDocs: {} });
const st0 = mod.styleEnsure2();
ok('the old key is rewritten to identity ⊕ content', st0.samples[0].k.indexOf('doc9:a1:') === 0);
ok('and marked typed so the sweep can see it', st0.samples[0].src === 'typed');
ok('THE NEXT SAVE DOES NOT FILE A SECOND COPY',
   mod.styleAddSamples(mod.styleHarvestTyped(fixed, 'doc9', meta5)) === 0 && mod.getSamples().length === 1);
ok('the migration runs once', st0.keyed === 1);

console.log('\nWhat counts as an answer');
ok('a sentence does', mod.styleWorthLearning('It gains heat from the surroundings.'));
ok('a bare number teaches nothing', !mod.styleWorthLearning('12'));
ok('a tick teaches nothing', !mod.styleWorthLearning('✓'));
ok('a one-word answer carries no style', !mod.styleWorthLearning('Evaporation.'));
ok('a heading is furniture', !mod.styleWorthLearning('Diagram 2'));
ok('so is a mark', !mod.styleWorthLearning('2 marks'));
ok('so is a pointer', !mod.styleWorthLearning('See over the page'));
ok('so is a bare label', !mod.styleWorthLearning('Ans:'));

console.log('\nLEARNING FROM THE EDITS — the sharpest signal there is');
mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
mod.clearGen();
const box = [{ id: 'a1', type: 'text', text: '' }];
mod.setAnns(box);
mod.styleNoteGenerated('a1', 'Why does the ice melt?', 'The ice melts because it absorbs thermal energy from its warmer surroundings, causing a change of state.');
box[0].text = 'It gains heat from the surroundings and melts.';
const e1 = mod.styleCollectEdits(box, 'doc9', meta5);
ok('the rewrite is learned as an edit', e1.edits === 1);
ok('and scored', e1.scored === 1);
ok('the edit holds what the AI wrote', /absorbs thermal energy/.test(mod.getEdits()[0].wrote));
ok('and what the teacher kept', /gains heat from the surroundings/.test(mod.getEdits()[0].a));
ok('and the question it was answering', /Why does the ice melt/.test(mod.getEdits()[0].q));
ok('saving again does not learn it twice', mod.styleCollectEdits(box, 'doc9', meta5).edits === 0);
box[0].text = 'It gains heat from the surroundings, so it melts.';
mod.styleCollectEdits(box, 'doc9', meta5);
ok('EDITING FURTHER SUPERSEDES rather than keeping the first attempt',
   mod.getEdits().length === 1 && /so it melts/.test(mod.getEdits()[0].a));

console.log('\nAn answer taken UNCHANGED is a signal too, and never an "edit"');
mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
mod.clearGen();
const kept = [{ id: 'b1', type: 'text', text: 'It gains heat from the surroundings and melts.' }];
mod.setAnns(kept);
mod.styleNoteGenerated('b1', 'Why does the ice melt?', 'It gains heat from the surroundings and melts.');
const e2 = mod.styleCollectEdits(kept, 'doc9', meta5);
ok('it is scored', e2.scored === 1);
ok('IT IS NOT AN EDIT — nothing was corrected', e2.edits === 0);
ok('and it scores as a perfect match', mod.getScores()[0].dist === 0);
mod.clearGen();
const typo = [{ id: 'c1', type: 'text', text: 'It gains heat from the surroundings and melts' }];
mod.setAnns(typo);
mod.styleNoteGenerated('c1', 'q', 'It gains heat from the surroundings and melts.');
ok('a typo is not a preference', mod.styleCollectEdits(typo, 'doc9', meta5).edits === 0);
mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
mod.clearGen();
const undo = [{ id: 'd1', type: 'text', text: '' }];
mod.setAnns(undo);
mod.styleNoteGenerated('d1', 'q', 'It absorbs thermal energy and changes state.');
undo[0].text = 'It gains heat and melts.';
mod.styleCollectEdits(undo, 'doc9', meta5);
ok('the rewrite is recorded', mod.getEdits().length === 1);
undo[0].text = 'It absorbs thermal energy and changes state.';
mod.styleCollectEdits(undo, 'doc9', meta5);
ok('AN EDIT UNDONE IS WITHDRAWN — a lesson the teacher took back is not a lesson',
   mod.getEdits().length === 0);
ok('but it is still scored, and now as a perfect match',
   mod.getScores().length === 1 && mod.getScores()[0].dist === 0);

console.log('\nThe edit distance');
ok('identical is 0', mod._styleEditRatio('a b c', 'a b c') === 0);
ok('nothing in common is 1', mod._styleEditRatio('a b c', 'x y z') === 1);
ok('one word in three is about a third', Math.abs(mod._styleEditRatio('a b c', 'a b z') - 1 / 3) < 0.01);
ok('an empty answer against a real one is total', mod._styleEditRatio('', 'a b c') === 1);
ok('two empties are no distance at all', mod._styleEditRatio('', '') === 0);
ok('it is not fooled by case or spacing', mod._styleEditRatio('A  B   c', 'a b C') === 0);
ok('nor by a full stop — tidying punctuation is not a rewrite',
   mod._styleEditRatio('It gains heat and melts.', 'It gains heat and melts') === 0);
ok('nor by quotation marks', mod._styleEditRatio('the "answer" is heat', 'the answer is heat') === 0);
ok('but a respelled word IS a change', mod._styleEditRatio('it recieves heat', 'it receives heat') > 0);

console.log('\nIs it working? — the metric the panel could never show');
mod.setStyle({
  samples: [], edits: [], profiles: {}, learnedDocs: {}, keyed: 1,
  scores: Array.from({ length: 40 }, (_, i) => ({ k: 's' + i, dist: i < 20 ? 0.5 : 0.1 }))
});
const fit = mod.styleFitReport();
ok('the recent window is read', Math.abs(fit.now - 0.1) < 1e-9);
ok('the window before it is read', Math.abs(fit.before - 0.5) < 1e-9);
ok('an improvement is visible', fit.now < fit.before);
ok('answers taken untouched are counted', fit.accepted === 0 && fit.of === 20);
ok('the panel says it in words', /kept/.test(mod.notesFitHtml()));
ok('and says it is learning', /learning you/.test(mod.notesFitHtml()));
mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
ok('nothing measured yet says so rather than claiming 100%', /Nothing measured yet/.test(mod.notesFitHtml()));
ok('and reports no figure at all', mod.styleFitReport() === null);

console.log('\nONE PROFILE PER CONTEXT — P3 Maths is not Sec 1 Science');
const bigSci = Array.from({ length: 40 }, (_, i) => ({ k: 'sci' + i, a: 'Science answer ' + i, q: 'science question about heat ' + i, lvl: 'P5', sub: 'science' }));
const fewMath = Array.from({ length: 4 }, (_, i) => ({ k: 'ma' + i, a: 'Maths answer ' + i, q: 'maths question ' + i, lvl: 'P3', sub: 'math' }));
mod.setStyle({
  samples: bigSci.concat(fewMath), edits: [], scores: [], learnedDocs: {}, keyed: 1,
  profiles: {
    _global: { styleRules: 'GLOBAL RULE', keywords: [], exemplars: [], fixes: [] },
    'p5:science': { styleRules: 'SCIENCE RULE', keywords: [], exemplars: [], fixes: [] },
    'p3:math': { styleRules: 'MATHS RULE', keywords: [], exemplars: [], fixes: [] }
  }
});
ok('the bucket key is level and subject', mod.styleBucketKey('P5', 'science') === 'p5:science');
ok('no level and no subject is the global one', mod.styleBucketKey('', '') === '_global');
const sci = mod.styleProfilePick('P5', 'science');
ok('a full bucket serves its OWN profile', sci.profile.styleRules === 'SCIENCE RULE' && !sci.fell);
const ma = mod.styleProfilePick('P3', 'math');
ok('A THIN BUCKET FALLS BACK rather than teaching the model noise', ma.profile.styleRules === 'GLOBAL RULE');
ok('and the fallback is reported, not hidden', ma.fell === true && ma.n === 4);
mod.setMeta({ level: 'P5', subject: 'science' });
ok('the prompt carries the science profile', /SCIENCE RULE/.test(mod.styleBlock('answer')));
ok('and not the global one', !/GLOBAL RULE/.test(mod.styleBlock('answer')));
mod.setMeta({ level: 'P3', subject: 'math' });
ok('the thin bucket gets the global profile in the prompt', /GLOBAL RULE/.test(mod.styleBlock('answer')));
ok('the panel names the buckets', /P5 Science/.test(mod.notesBucketsHtml()));
ok('and says which is in force', /being answered in/.test(mod.notesBucketsHtml()));
ok('a bucket under the floor says what it needs', /needs 30/.test(mod.notesBucketsHtml()));

console.log('\nThe exemplars are RETRIEVED for the question, not the same six every time');
mod.setStyle({
  samples: [
    { k: 'x1', a: 'The ice gains heat and melts.', q: 'Why does the ice melt in the sun?', lvl: 'P5', sub: 'science' },
    { k: 'x2', a: 'Add the two lengths together.', q: 'How do you find the perimeter?', lvl: 'P5', sub: 'science' },
    { k: 'x3', a: 'The water vapour cools and condenses.', q: 'Why does condensation form?', lvl: 'P5', sub: 'science' }
  ],
  edits: [], scores: [], learnedDocs: {}, keyed: 1,
  profiles: { _global: { styleRules: 'R', keywords: [], exemplars: [{ q: 'frozen', a: 'A FROZEN EXEMPLAR' }], fixes: [] } }
});
mod.setMeta({ level: 'P5', subject: 'science' });
const near = mod.styleExemplarsFor('Why does the ice melt when left in the sun?', 'P5', 'science');
ok('the closest answer comes first', /ice gains heat/.test(near[0].a));
ok('an unrelated one does not lead', !/perimeter/.test(near[0].a));
ok('a question with no match at all falls back to the profile exemplars',
   /A FROZEN EXEMPLAR/.test(mod.styleExemplarsFor('zzzz qqqq wwww', 'P5', 'science')[0].a));
ok('no question given is the old behaviour', /A FROZEN EXEMPLAR/.test(mod.styleExemplars()[0].a));
ok('the retrieved answer reaches the prompt', /ice gains heat/.test(mod.styleBlock('answer', 'Why does the ice melt in the sun?')));
ok('the grounding threads the question through', /ice gains heat/.test(mod.aiGrounding('answer', { q: 'Why does the ice melt in the sun?' })));
ok('a call site that passes none is unaffected', /A FROZEN EXEMPLAR/.test(mod.aiGrounding('answer')));
ok('never more than the plateau', mod.styleExemplarsFor('ice heat melt water vapour', 'P5', 'science').length <= mod.STYLE_EX_MAX);

console.log('\nMARKING NEVER SEES AN ANSWER — not an exemplar, not a correction');
mod.setStyle({
  samples: [{ k: 'y1', a: 'THE MODEL ANSWER ITSELF', q: 'why does ice melt', lvl: 'P5', sub: 'science' }],
  edits: [], scores: [], learnedDocs: {}, keyed: 1,
  profiles: { _global: {
    styleRules: 'R', markingStandards: 'Name the process.', keywords: [],
    exemplars: [{ q: 'q', a: 'AN EXEMPLAR ANSWER' }], fixes: ['A CORRECTION RULE']
  } }
});
mod.setMeta({ level: 'P5', subject: 'science' });
ok('marking gets the standard', /Name the process/.test(mod.styleBlock('mark')));
ok('MARKING IS NOT HANDED THE EXEMPLARS', !/AN EXEMPLAR ANSWER/.test(mod.styleBlock('mark')));
ok('nor the retrieved answers', !/THE MODEL ANSWER ITSELF/.test(mod.styleBlock('mark', 'why does ice melt')));
ok('nor the corrections', !/A CORRECTION RULE/.test(mod.styleBlock('mark')));
ok('answering does get the corrections', /A CORRECTION RULE/.test(mod.styleBlock('answer')));
ok('and the whole thing still reaches aiGrounding', /A CORRECTION RULE/.test(mod.aiGrounding('answer')));

console.log('\nOne renderer, so what is VERIFIED is what the app ships');
const bits = mod._styleProfileBits({ styleRules: 'RULES', phrasing: 'PHRASING', keywords: ['kw'], exemplars: [{ q: 'q', a: 'EX' }], fixes: ['FIX'] }, 'answer');
ok('the rules render', bits.join('\n').includes('RULES'));
ok('the exemplars render', bits.join('\n').includes('EX'));
ok('the corrections render', bits.join('\n').includes('FIX'));
ok('a marking render stops before the answers', !mod._styleProfileBits({ styleRules: 'R', exemplars: [{ q: 'q', a: 'EX' }], fixes: ['FIX'] }, 'mark').join('\n').includes('EX'));
ok('an empty profile renders nothing at all', mod._styleProfileBits(null, 'answer').length === 0);

console.log('\nA rebuild can only ever IMPROVE the profile');
ok('a reply with nothing usable is refused', mod.styleProfileEmpty(mod.styleCleanProfile({})));
ok('a reply with only rules is usable', !mod.styleProfileEmpty(mod.styleCleanProfile({ styleRules: 'x' })));
ok('a reply with only corrections is usable', !mod.styleProfileEmpty(mod.styleCleanProfile({ fixes: ['x'] })));
ok('a wrong-shaped reply cannot reach the store',
   Array.isArray(mod.styleCleanProfile({ keywords: 'not an array', fixes: 7, exemplars: null }).keywords));
ok('the corrections are capped', mod.styleCleanProfile({ fixes: Array.from({ length: 20 }, (_, i) => 'f' + i) }).fixes.length === 6);
ok('a perfect match is no gap', mod.styleGapOf([{ theirs: 'a b c', ours: 'a b c' }]) === 0);
ok('a total miss is a whole gap', mod.styleGapOf([{ theirs: 'a b c', ours: 'x y z' }]) === 1);
ok('nothing to compare is the worst case, never the best', mod.styleGapOf([]) === 1);

console.log('\nThe rebuild fires on new answers, and on a fortnight of silence');
const day = 864e5;
ok('a fresh profile with nothing new does not fire',
   !mod.styleDistilDue({ learned: 10, profileLearned: 10, samples: [1], profileAt: new Date().toISOString() }));
ok('25 new answers fire it',
   mod.styleDistilDue({ learned: 40, profileLearned: 10, samples: [1], profileAt: new Date().toISOString() }));
ok('a fortnight and something new fires it',
   mod.styleDistilDue({ learned: 12, profileLearned: 10, samples: [1], profileAt: new Date(Date.now() - 20 * day).toISOString() }));
ok('a fortnight with NOTHING new does not',
   !mod.styleDistilDue({ learned: 10, profileLearned: 10, samples: [1], profileAt: new Date(Date.now() - 20 * day).toISOString() }));
ok('a profile that has never been built does not fire on age',
   !mod.styleDistilDue({ learned: 10, profileLearned: 0, samples: [1], profileAt: '' }));

console.log('\nThe corrections reach the rebuild, and the prompt asks for a RULE');
mod.setStyle({
  samples: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1,
  edits: [
    { k: 'e1', wrote: 'aa', a: 'bb', dist: 0.9, lvl: 'P5', sub: 'science' },
    { k: 'e2', wrote: 'cc', a: 'dd', dist: 0.2, lvl: 'P5', sub: 'science' },
    { k: 'e3', wrote: 'ee', a: 'ff', dist: 0.5, lvl: 'P3', sub: 'math' }
  ]
});
const eSci = mod.styleEditsFor('p5:science', 12);
ok('the biggest change leads — a rewrite says more than a tweak', eSci[0].dist === 0.9);
ok('a bucket with too few of its own falls back to all of them', mod.styleEditsFor('p3:math', 12).length === 3);
ok('the distil prompt asks for corrections as rules', /"fixes"/.test(mod.STYLE_DISTIL_SYS));
ok('and only from the corrections it was given', /ONLY from the CORRECTIONS section/.test(mod.STYLE_DISTIL_SYS));
ok('and refuses a description that would fit anyone', /would fit any competent teacher is a failed answer/.test(mod.STYLE_DISTIL_SYS));
ok('the refine prompt blames the DESCRIPTION, not the teacher', /the description is at fault/.test(mod.STYLE_REFINE_SYS));
ok('and keeps what was already right', /Keep everything that was already right/.test(mod.STYLE_REFINE_SYS));
ok('the generate prompt returns one answer per question, in order', /one string per question/.test(mod.STYLE_GEN_SYS));

console.log('\nThe panel says what is happening');
mod.setStyle({
  samples: [{ k: 'z1', a: 'An answer.', lvl: 'P5', sub: 'science' }],
  edits: [{ k: 'e1', wrote: 'a', a: 'b' }], scores: [], learnedDocs: { d1: 1 }, keyed: 1,
  profileSamples: 1, profileLearned: 1, learned: 1, profileAt: new Date().toISOString(),
  profileNote: 'checked against 8 of your own answers it had not seen — 71% match',
  profiles: { _global: { styleRules: 'R', keywords: ['kw'], exemplars: [], fixes: ['Do not restate the question.'] } }
});
mod.setMeta({ level: 'P5', subject: 'science' });
const panel = mod.notesTrainingHtml();
ok('the corrections are counted', /of your corrections/.test(panel));
ok('what was learned from them is shown', /Do not restate the question/.test(panel));
ok('the verification result is shown', /71% match/.test(panel));
ok('the rebuild button rebuilds every context', /styleDistilAll\(false\)/.test(panel));
ok('a profile is escaped like everything else',
   mod.notesTrainingHtml().indexOf('<script') === -1);

/* ---- ONE KEY RULE, ONE TRIGGER, WHATEVER FILES THE SAMPLE ----
   The bug this release fixes survived because the rule lived at the call
   sites: three paths built a sample key by hand and one of them was keyed on
   identity alone, so it filed first drafts for ever while the others were
   fine. Nothing on any screen could show it. These two read index.html itself
   so the NEXT path added is caught rather than the last one. */
console.log('\nEvery path that files a sample uses the one key rule');
{
  const lines = html.split('\n');
  const fns = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,2}(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) fns.push({ name: m[1], line: i });
  });
  const bodyOf = {};
  fns.forEach((f, k) => { const e = k + 1 < fns.length ? fns[k + 1].line : lines.length; bodyOf[f.name] = lines.slice(f.line, e).join('\n'); });
  const owner = i => { let b = null; for (const f of fns) { if (f.line <= i) b = f; else break; } return b; };

  /* Building the key by hand is allowed — the vision reads really do key by
     page and position rather than by an annotation — but it MUST go through
     the content hash, or a revision is skipped as a duplicate. */
  const filers = new Set();
  lines.forEach((l, i) => { if (/styleAddSamples\s*\(/.test(l)) { const o = owner(i); if (o) filers.add(o.name); } });
  ok('the census found the paths that file samples', filers.size >= 3, [...filers].join(', '));
  const byHand = [...filers].filter(n => {
    const b = bodyOf[n] || '';
    if (!/\bk:\s/.test(b)) return false;                 // hands off a batch built elsewhere
    return !/_styleHash32\s*\(/.test(b) && !/styleSampleKey\s*\(/.test(b);
  });
  ok('NONE OF THEM KEYS ON IDENTITY ALONE', byHand.length === 0, byHand.join(', '));

  const triggers = [];
  lines.forEach((l, i) => {
    if (!/profileLearned\s*\|\|\s*0\s*\)\s*>=\s*STYLE_DISTIL_EVERY/.test(l)) return;
    const o = owner(i);
    if (o && o.name !== 'styleDistilDue') triggers.push(o.name + ' (index.html:' + (i + 1) + ')');
  });
  ok('and the refresh trigger is written once', triggers.length === 0, triggers.join(', '));

  /* The corpus is the ONLY thing the whole style is derived from, so a path
     that files an answer without asking whether it IS one refills it with
     headings and labels. */
  const unchecked = [...filers].filter(n => {
    const b = bodyOf[n] || '';
    if (!/\bk:\s/.test(b)) return false;
    return !/styleWorthLearning\s*\(/.test(b);
  });
  ok('and every one of them asks whether it is an answer at all', unchecked.length === 0, unchecked.join(', '));
}

/* ================= THE HARVEST RUNS ON THE AUTO-SAVE =====================
   It hung off `performSave` alone — the manual Save DIALOG, pressed once per
   worksheet — while `autoSave` did every save after that. So almost nothing
   was ever learned, and nothing on any screen said so. */
console.log('\nWHOSE answers are these?');
mod.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com' });
mod.setActing(null); mod.setPracticeMode(false); mod.setVisitor(false);
ok('the teacher, on their own worksheet', mod.styleHarvestAllowed() === true);
mod.setPracticeMode(true);
ok('NEVER IN PRACTICE MODE — that is a child’s attempt, not the teacher’s', mod.styleHarvestAllowed() === false);
mod.setPracticeMode(false); mod.setVisitor(true);
ok('never a share-link visitor', mod.styleHarvestAllowed() === false);
mod.setVisitor(false); mod.setActing({ name: 'Amy' });
ok('never while the device is handed to a student', mod.styleHarvestAllowed() === false);
mod.setActing(null); mod.setUser({ uid: 'u2', email: 'someone@else.com' });
ok('never anybody else', mod.styleHarvestAllowed() === false);
mod.setUser({ uid: 'admin1', email: 'chungzhikai@gmail.com' });

console.log('\nA SHORT ANSWER IS STILL AN ANSWER when the app knows the question');
ok('a bare number in a bare box is not learned from', !mod.styleWorthLearning('24 g', false));
ok('…but IS when it answers a known question', mod.styleWorthLearning('24 g', true));
ok('a one-word answer to a known question counts', mod.styleWorthLearning('Evaporation', true));
ok('"answering with the bare number" is real style information',
   mod.styleWorthLearning('$140.20', true));
ok('furniture is refused even with a question', !mod.styleWorthLearning('Diagram 2', true));
ok('and so is a page number', !mod.styleWorthLearning('Page 4', true));
ok('nothing at all is still nothing', !mod.styleWorthLearning('', true));
ok('a sentence in a bare box is unchanged', mod.styleWorthLearning('It gains heat from the surroundings.', false));
{
  const withQ = mod.styleHarvestTyped(
    [{ id: 'a1', type: 'text', text: '24 g', aiQ: 'What is the mass of the ice?' }],
    'doc9', { level: 'P5', subject: 'science' });
  ok('the harvest passes the question through', withQ.length === 1);
  ok('and keeps it on the sample', /mass of the ice/.test(withQ[0].q));
  const noQ = mod.styleHarvestTyped([{ id: 'a2', type: 'text', text: '24 g' }], 'doc9', {});
  ok('a bare box of the same text is left alone', noQ.length === 0);
}

console.log('\nThe harvest reports what it learned, so the button can say so');
mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
mod.clearGen();
mod.setMeta({ level: 'P5', subject: 'science', name: 'Heat' });
mod.setDoc('doc9');
{
  const anns = [{ id: 'a1', type: 'text', text: 'It gains heat from the surroundings and melts.' }];
  mod.setAnns(anns);
  const sum = mod.styleHarvestOnSave();
  ok('it reports the answer it learned', sum && sum.samples === 1);
  ok('and hands back a promise for when it really landed', !!(sum && sum.done && sum.done.then));
  ok('NOTHING NEW REPORTS NOTHING — the button must not claim an upload that did not happen',
     mod.styleHarvestOnSave() === null);
  mod.setPracticeMode(true);
  ok('and a practice attempt reports nothing at all', mod.styleHarvestOnSave() === null);
  mod.setPracticeMode(false);
}

console.log('\nWhat the button says');
ok('one answer is singular', mod.styleSavedLabel({ samples: 1 }) === '🧠 1 answer learned');
ok('two are plural', mod.styleSavedLabel({ samples: 2 }) === '🧠 2 answers learned');
ok('a correction is named as one', /1 correction learned/.test(mod.styleSavedLabel({ edits: 1 })));
ok('both are named together', /2 answers \+ 1 correction/.test(mod.styleSavedLabel({ samples: 2, edits: 1 })));
ok('an answer merely CHECKED still says something', /checked/.test(mod.styleSavedLabel({ scored: 3 })));
ok('a tidy-up says what it was', /tidied/.test(mod.styleSavedLabel({ pruned: 2 })));
ok('nothing learned says nothing at all', mod.styleSavedLabel({}) === '');
ok('and no summary says nothing', mod.styleSavedLabel(null) === '');
ok('the tooltip names the answer-key notes', /answer-key notes/.test(mod.styleSavedTitle({ samples: 1 })));
ok('the tooltip spells the corrections out', /correction/.test(mod.styleSavedTitle({ edits: 1 })));
ok('an empty summary has no tooltip', mod.styleSavedTitle({}) === '');

console.log('\nA refused write says it was refused');
{
  mod.setStyle({ samples: [], edits: [], scores: [], profiles: {}, learnedDocs: {}, keyed: 1 });
  ok('an ordinary write resolves true', (await mod.styleSave()) === true);
  mod.failSave();
  ok('A WRITE FIRESTORE REFUSED RESOLVES FALSE — never true, or the button announces an upload that never happened',
     (await mod.styleSave()) === false);
  mod.failSave();
  mod.setAnns([{ id: 'zz1', type: 'text', text: 'It gains heat from the surroundings and melts.' }]);
  mod.setDoc('docFail');
  const sum = mod.styleHarvestOnSave();
  ok('and the harvest hands that refusal on', sum && (await sum.done) === false);
}

console.log('\nThe announcement only ever tells the truth');
{
  const settle = () => new Promise(r => setTimeout(r, 0));
  mod.setDirty2(false);
  let btn = mod.makeSaveBtn(true);
  mod.styleAnnounceSaved({ samples: 1, done: Promise.resolve(true) });
  await settle();
  ok('a write that landed IS announced on the button', /1 answer learned/.test(btn._label.textContent));
  ok('and the tooltip says what went up', /answer-key notes/.test(btn.title));

  btn = mod.makeSaveBtn(true);
  mod.styleAnnounceSaved({ samples: 1, done: Promise.resolve(false) });
  await settle();
  ok('A WRITE THAT FAILED IS NEVER ANNOUNCED', btn._label.textContent === '\u2713 Saved');
  ok('and leaves the tooltip alone', !/answer-key notes/.test(btn.title));

  mod.setDirty2(true);
  btn = mod.makeSaveBtn(true);
  mod.styleAnnounceSaved({ samples: 1, done: Promise.resolve(true) });
  await settle();
  ok('nor is it announced over a worksheet with unsaved changes since',
     btn._label.textContent === '\u2713 Saved');
  mod.setDirty2(false);

  btn = mod.makeSaveBtn(false);
  mod.styleAnnounceSaved({ samples: 1, done: Promise.resolve(true) });
  await settle();
  ok('nor onto a button that is no longer showing Saved', btn._label.textContent === 'Save');

  btn = mod.makeSaveBtn(true);
  mod.styleAnnounceSaved({ scored: 0, samples: 0, edits: 0, pruned: 0, done: Promise.resolve(true) });
  await settle();
  ok('nothing learned is not announced as something', btn._label.textContent === '\u2713 Saved');
  ok('and a summary with no promise is harmless',
     (mod.styleAnnounceSaved({ samples: 1 }), mod.styleAnnounceSaved(null), true));
  fakeBtnReset();
}
function fakeBtnReset() { mod.makeSaveBtn(false); }

/* ---- THE HOOK ITSELF ----
   This is the census that would have caught the reported fault. Both save
   paths must run the harvest; hanging it off one of them is invisible from
   every screen in the app and means the learning silently stops. */
console.log('\nBOTH save paths harvest, and both announce');
{
  const lines = html.split('\n');
  const fns = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s{0,2}(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) fns.push({ name: m[1], line: i });
  });
  const bodyOf = {};
  fns.forEach((f, k) => { const e = k + 1 < fns.length ? fns[k + 1].line : lines.length; bodyOf[f.name] = lines.slice(f.line, e).join('\n'); });
  ok('autoSave exists to be checked', !!bodyOf.autoSave);
  ok('performSave exists to be checked', !!bodyOf.performSave);
  ok('THE AUTO-SAVE HARVESTS', /styleHarvestOnSave\s*\(/.test(bodyOf.autoSave || ''));
  ok('the manual save harvests too', /styleHarvestOnSave\s*\(/.test(bodyOf.performSave || ''));
  ok('the auto-save announces what went up', /styleAnnounceSaved\s*\(/.test(bodyOf.autoSave || ''));
  ok('and so does the manual save', /styleAnnounceSaved\s*\(/.test(bodyOf.performSave || ''));
  /* The annotations have to be safely written before anything is learned from
     them, or the app learns from a save that failed. */
  const aBody = bodyOf.autoSave || '';
  ok('the auto-save harvests AFTER the annotations are written',
     aBody.indexOf('writeAnnotations') < aBody.indexOf('styleHarvestOnSave'));
  const pBody = bodyOf.performSave || '';
  ok('and so does the manual save',
     pBody.indexOf('writeAnnotations') < pBody.indexOf('styleHarvestOnSave'));
  /* Every filer already asks styleWorthLearning; it must be asked with the
     question, or a maths answer is thrown away for being short. */
  const filers = ['styleHarvestTyped', 'styleLearnOpenWorksheet', 'autoLearnRunJob'];
  const blind = filers.filter(n => /styleWorthLearning\s*\(\s*[^,)]+\)/.test(bodyOf[n] || ''));
  ok('nobody asks whether it is an answer without saying what it answers', blind.length === 0, blind.join(', '));
}

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nAll good.\n');
process.exit(fails ? 1 : 0);
