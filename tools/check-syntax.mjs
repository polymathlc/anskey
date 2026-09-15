import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('No inline application scripts found');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anskey-syntax-'));
try {
  for (const [i, script] of scripts.entries()) {
    const file = path.join(temporary, `script-${i}.${script[1].includes('module') ? 'mjs' : 'js'}`);
    fs.writeFileSync(file, script[2]);
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
  console.log(`${scripts.length} inline scripts passed syntax checks.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
