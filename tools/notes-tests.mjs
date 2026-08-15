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

const mod = new Function(prelude + src + '\nreturn { notesBlock, styleBlock, aiGrounding, guidanceBlock, notesGuidance, quickNoteTitleFrom, styleAddSamples, styleWorthLearning, styleHarvestTyped, styleEnsure, notesRelevant, noteAppliesHere, notesCardHtml, notesKeywordList, setNotes: v => { teachingNotes = v; }, setStyle: v => { aiStyle = v; }, setMeta: v => { wsMeta = v; }, getSamples: () => styleSamples() };')();

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

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nAll good.\n');
process.exit(fails ? 1 : 0);
