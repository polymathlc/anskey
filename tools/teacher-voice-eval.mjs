// node tools/teacher-voice-eval.mjs prompts <outDir>
// node tools/teacher-voice-eval.mjs score <outDir>
//
// 🎯 A BLIND TEST OF WHETHER THE ANSWER BOOK MAKES AN AI ANSWER LIKE THE TEACHER.
//
// A fixture "teacher" with a distinctive house style has answered twelve
// questions. Twelve more questions are then asked of an AI that never sees
// the teacher's answers to THEM:
//   same    — a question the teacher answered, reworded (the book holds it)
//   similar — the same kind of question with other numbers or another object
//             (the book holds the teacher's answer to its twin, not to it)
//   new     — a question in the same subject the book has nothing on (control)
// Each is asked twice, with the SAME system prompt except for the answer
// book's block, built by teacher-voice.js exactly as the apps build it:
//   plain.json — no answer book
//   book.json  — the answer book block appended
// The two files are answered separately (blind: whoever answers plain.json
// never sees book.json), written back as answers-plain.json and
// answers-book.json ({id: text}), and `score` compares each reply with the
// teacher's own answer to that question (hidden from both) using
// TeacherVoice.pure.compare — the same 0–100 the in-app Voice check uses.
//
// This is NOT the teacher's real data: it shows the mechanism carries a
// style across. The in-app 🎯 Voice check runs the same comparison on the
// teacher's real answers with the app's real AI.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TV = require(path.join(here, '..', 'teacher-voice.js'));
const P = TV.pure;

const SYS = 'You are helping a tuition teacher fill in answers on a worksheet for students from P3 to ' +
  'Secondary 1 (Singapore syllabus). Answer the question the way it should be written in the answer space. ' +
  'Plain text only — no markdown, no headings. Short working only where the question expects it.';

/* The teacher's house style: science answers name the cause, then the
   change, with the syllabus keywords ("gains heat from the surroundings",
   "is a magnetic material"); maths answers set out the unitary method line by
   line with units on every line and end "Ans:". */
const BOOK = [
  { n: '1', sub: 'science', q: 'A puddle of water on the floor became smaller after a few hours. Explain why.',
    a: 'The water in the puddle gained heat from the surroundings and evaporated into water vapour. The water vapour escaped into the surrounding air, so there was less water in the puddle.' },
  { n: '2', sub: 'science', q: 'Water droplets formed on the outer surface of a glass of ice water. Explain how the droplets were formed.',
    a: 'The warm water vapour in the surrounding air came into contact with the cooler outer surface of the glass. The water vapour lost heat to the cooler surface and condensed into water droplets.' },
  { n: '3', sub: 'science', q: 'Why does a steel paper clip stick to a magnet but a copper coin does not?',
    a: 'Steel is a magnetic material, so it is attracted to the magnet. Copper is a non-magnetic material, so it is not attracted to the magnet.' },
  { n: '4', sub: 'science', q: 'Explain why the leaves of a plant kept in a dark cupboard for a week turned yellow.',
    a: 'There was no light in the cupboard, so the plant could not make food by photosynthesis. The plant used up its stored food and the leaves turned yellow.' },
  { n: '5', sub: 'science', q: 'A metal spoon left in a cup of hot soup became hot. Explain why.',
    a: 'Metal is a good conductor of heat. The spoon gained heat from the hotter soup, so the spoon became hot.' },
  { n: '6', sub: 'science', q: 'Explain why the shadow of a pole is longest in the early morning.',
    a: 'In the early morning the Sun is low in the sky. The pole blocks the light at a smaller angle, so the shadow formed is longer.' },
  { n: '1', sub: 'math', q: 'Ali had 24 apples. He gave 1/3 of them to his sister. How many apples did he have left?',
    a: '1/3 of 24 = 24 ÷ 3 = 8 apples\n24 − 8 = 16 apples\nAns: 16 apples' },
  { n: '2', sub: 'math', q: '5 pens cost $15. How much do 8 pens cost?',
    a: '5 pens → $15\n1 pen → $15 ÷ 5 = $3\n8 pens → 8 × $3 = $24\nAns: $24' },
  { n: '3', sub: 'math', q: 'A rectangle is 12 cm long and 5 cm wide. Find its area.',
    a: 'Area = 12 cm × 5 cm = 60 cm²\nAns: 60 cm²' },
  { n: '4', sub: 'math', q: 'Mei saved $40. She spent 25% of her savings on a book. How much money did she have left?',
    a: '25% of $40 = 25/100 × $40 = $10\n$40 − $10 = $30\nAns: $30' },
  { n: '5', sub: 'math', q: 'A tank holds 60 litres of water. 3/5 of the water was used. How much water was left?',
    a: '3/5 of 60 ℓ = 60 ÷ 5 × 3 = 36 ℓ\n60 ℓ − 36 ℓ = 24 ℓ\nAns: 24 ℓ' },
  { n: '6', sub: 'math', q: 'A car travels 180 km in 3 hours. What is its average speed?',
    a: 'Speed = Distance ÷ Time\n= 180 km ÷ 3 h = 60 km/h\nAns: 60 km/h' }
];

const ASK = [
  // reworded repeats — the book holds the teacher's own answer
  { id: 's1', kind: 'same', sub: 'science', q: 'A puddle of water on the floor got smaller after a few hours. Explain why.', mine: BOOK[0].a },
  { id: 's2', kind: 'same', sub: 'science', q: 'Why does a steel paper clip stick to the magnet while a copper coin does not?', mine: BOOK[2].a },
  { id: 's3', kind: 'same', sub: 'math', q: 'Five pens cost $15. How much do 8 pens cost?', mine: BOOK[7].a },
  { id: 's4', kind: 'same', sub: 'math', q: 'A car travels 180 km in 3 hours. Find its average speed.', mine: BOOK[11].a },
  // twins — another object or other numbers; the teacher's answer is written to match their style
  { id: 'm1', kind: 'similar', sub: 'science', q: 'Water droplets formed on the outer surface of a can of cold drink. Explain how the droplets were formed.',
    mine: 'The warm water vapour in the surrounding air came into contact with the cooler outer surface of the can. The water vapour lost heat to the cooler surface and condensed into water droplets.' },
  { id: 'm2', kind: 'similar', sub: 'science', q: 'A metal fork left in a bowl of hot noodles became hot. Explain why.',
    mine: 'Metal is a good conductor of heat. The fork gained heat from the hotter noodles, so the fork became hot.' },
  { id: 'm3', kind: 'similar', sub: 'math', q: 'Ali had 36 apples. He gave 1/3 of them to his sister. How many apples did he have left?',
    mine: '1/3 of 36 = 36 ÷ 3 = 12 apples\n36 − 12 = 24 apples\nAns: 24 apples' },
  { id: 'm4', kind: 'similar', sub: 'math', q: 'Mei saved $60. She spent 25% of her savings on a bag. How much money did she have left?',
    mine: '25% of $60 = 25/100 × $60 = $15\n$60 − $15 = $45\nAns: $45' },
  // nothing in the book — the control: the book must not make these worse
  { id: 'n1', kind: 'new', sub: 'science', q: 'Explain why a wet towel hung in the sun dries faster than one hung in the shade.',
    mine: 'The towel in the sun gained more heat from the surroundings, so the water in it evaporated faster into water vapour.' },
  { id: 'n2', kind: 'new', sub: 'math', q: 'A ribbon 84 cm long is cut into 7 equal pieces. How long is each piece?',
    mine: '84 cm ÷ 7 = 12 cm\nAns: 12 cm' }
];

function entries() {
  return BOOK.map((b, i) => P.cleanEntry({
    k: P.slotKey('fixture-' + b.sub, 'p1:q' + b.n), n: b.n, q: b.q, a: b.a, src: 'typed',
    lvl: 'P5', sub: b.sub, ws: b.sub === 'math' ? 'P5 Maths revision' : 'P5 Science revision', doc: 'fixture-' + b.sub,
    page: 1, at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString()
  }));
}

function user(a) { return 'Worksheet: P5 ' + (a.sub === 'math' ? 'Mathematics' : 'Science') + '.\nQuestion:\n' + a.q + '\n\nWrite only the answer.'; }

function prompts(out) {
  fs.mkdirSync(out, { recursive: true });
  const list = entries();
  const plain = [], book = [], key = {};
  ASK.forEach(a => {
    const block = P.block('answer', P.pick(list, { q: a.q, lvl: 'P5', sub: a.sub }));
    plain.push({ id: a.id, system: SYS, user: user(a) });
    book.push({ id: a.id, system: SYS + block, user: user(a) });
    key[a.id] = { kind: a.kind, mine: a.mine, hadBook: !!block, blockKind: /ALREADY ANSWERED/.test(block) ? 'same' : (/LIKE THIS ONE/.test(block) ? 'similar' : '') };
  });
  fs.writeFileSync(path.join(out, 'plain.json'), JSON.stringify(plain, null, 2));
  fs.writeFileSync(path.join(out, 'book.json'), JSON.stringify(book, null, 2));
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 2));
  console.log('Wrote ' + plain.length + ' prompts in each condition to ' + out);
  Object.keys(key).forEach(id => console.log('  ' + id + '  ' + key[id].kind.padEnd(8) + ' book block: ' + (key[id].blockKind || 'none')));
}

function score(out) {
  const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
  const A = JSON.parse(fs.readFileSync(path.join(out, 'answers-plain.json'), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(out, 'answers-book.json'), 'utf8'));
  const rows = Object.keys(key).map(id => {
    const k = key[id];
    return { id, kind: k.kind, plain: P.compare(k.mine, A[id] || '').score, book: P.compare(k.mine, B[id] || '').score };
  });
  const by = {};
  rows.forEach(r => { (by[r.kind] = by[r.kind] || []).push(r); });
  const lines = ['| question | kind | plain AI | with the answer book |', '|---|---|---|---|'];
  rows.forEach(r => lines.push('| ' + r.id + ' | ' + r.kind + ' | ' + r.plain + ' | ' + r.book + ' |'));
  lines.push('');
  lines.push('| kind | plain AI (mean) | with the answer book (mean) |', '|---|---|---|');
  Object.keys(by).forEach(kind => lines.push('| ' + kind + ' | ' + P.mean(by[kind].map(r => r.plain)) + ' | ' + P.mean(by[kind].map(r => r.book)) + ' |'));
  const text = lines.join('\n');
  fs.writeFileSync(path.join(out, 'result.md'), text + '\n');
  console.log(text);
  return { rows, by };
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === 'prompts') prompts(dir || 'tv-eval');
else if (cmd === 'score') score(dir || 'tv-eval');
else console.log('usage: node tools/teacher-voice-eval.mjs prompts|score <dir>');
