import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const check=process.argv.includes('--check');
const destination=resolve(root,'functions','hero-game');
await mkdir(destination,{recursive:true});
for (const name of ['battle-core.js','battle-content.js','battle-bosses.js','mission-content.js']) {
  const source=await readFile(resolve(root,name));
  if (check) {
    const target=await readFile(resolve(destination,name));
    if (!source.equals(target)) throw new Error('Run node tools/sync-hero-game.mjs before deployment: '+name+' differs.');
  } else await writeFile(resolve(destination,name),source);
}
console.log(check?'Server/browser game rules match.':'Copied canonical game rules into the Functions deployment bundle.');
