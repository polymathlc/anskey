// 📋 Answer options printed as a table in the live class (v1.220.0).
// option-table.js is a copy of polymathlc/cer shop-function/functions/option-table.js.
//   node --test tools/option-table-tests.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const T = require('../option-table.js');
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const FRUIT = ['Circle: X; triangle: Y; square: Z', 'Circle: Y; triangle: Z; square: X', 'Circle: Z; triangle: X; square: Y', 'Circle: Y; triangle: X; square: Z'];

test('options written as "Heading: cell; …" rows are a table; other options are left alone', () => {
  const t = T.fromOptions(FRUIT);
  assert.deepEqual(t.head, ['Circle', 'Triangle', 'Square']);
  assert.deepEqual(t.rows[3], ['Y', 'X', 'Z']);
  assert.equal(T.fromOptions(['It melts', 'It boils', 'It freezes', 'It condenses']), null);
  assert.equal(T.fromOptions(['A', 'B', 'C', 'D']), null);
  assert.equal(T.fromOptions(['True', 'False']), null);
});

test('the live class draws table options as a table, loads option-table.js first, and every reader is told the rule', () => {
  const js = read('live-class.js');
  assert.match(js, /var table = optionTableOf\(q\.options\);/);
  assert.match(js, /'vcOpts' \+ \(table \? ' vcOptsTable' : ''\)/);
  assert.match(js, /root\.PolymathOptionTable/);
  assert.match(read('live-class.css'), /\.vcOptsTable \.vcOptHead, \.vcOptsTable \.vcOpt \{ display: grid;/);
  const html = read('index.html');
  assert.ok(html.indexOf('<script src="option-table.js') > 0 && html.indexOf('<script src="option-table.js') < html.indexOf('<script src="live-class.js'));
  assert.match(html, /LIVE_OPTION_TABLE_RULE \+ ' ' \+\s*'Reply with JSON only: \{"kind":"mcq\|blank\|open"/);
  assert.match(html, /"keywords":\["…"\]\}\]\}\. ' \+ LIVE_OPTION_TABLE_RULE/);
  // The fallback sentence in index.html is the shared rule, word for word.
  const fallback = html.match(/var LIVE_OPTION_TABLE_RULE = [^|]+\|\|\s*([\s\S]*?);\nvar LIVE_READ_SYS/)[1];
  const text = Function('return ' + fallback)();
  assert.equal(text, T.PROMPT_RULE);
});

test('a table row is never cut short by the option length limit', () => {
  const sandbox = { console, TextEncoder, TextDecoder, Date, Math, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('live-class.js'), sandbox, { filename: 'live-class.js' });
  const P = sandbox.LiveClass;
  const long = ['Beaker A: 20 °C, stirred; Beaker B: 30 °C, not stirred; Beaker C: 40 °C, stirred; Beaker D: 50 °C, not stirred'];
  assert.ok(long[0].length > 100);
  const q = P.pure.cleanQuestion({ id: 'q1', kind: 'mcq', text: 'Which?', options: [long[0], long[0].replace('20', '25'), long[0].replace('20', '35'), long[0].replace('20', '45')], answer: 0 });
  assert.ok(q && q.options.every(o => o.length === long[0].length));
});
