import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => ['.git', 'node_modules', 'reports'].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]); }
let bad = false;
for (const file of walk(root)) {
  if (/\.(?:mjs|js)$/.test(file) && spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }).status !== 0) bad = true;
  const text = readFileSync(file, 'utf8');
  if (new RegExp('/Users/' + 'sunu/|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}|-----BEGIN ' + '(?:RSA |EC |OPENSSH )?PRIVATE KEY-----').test(text)) {
    console.error(`Potential personal path or credential in ${file.slice(root.length + 1)}`); bad = true;
  }
}
if (bad) process.exitCode = 1; else console.log('PASS syntax and public-source hygiene checks');
