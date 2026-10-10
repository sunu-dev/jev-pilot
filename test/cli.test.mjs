import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanEnv, projectDir, takeModelScope } from '../src/cli.mjs';
import { findProject } from '../src/config.mjs';
const bin = resolve('bin/jev-pilot.mjs');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, run: (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, JEV_PILOT_CONFIG_HOME: join(dir, 'config'), JEV_PILOT_DATA_HOME: join(dir, 'data'), ...env } }) };
}
test('installation and uninstall preserve original commands and user reports', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), prefix = join(dir, 'prefix');
  assert.equal(run(['install', '--prefix', prefix]).status, 0);
  assert.ok(existsSync(join(prefix, 'bin', 'pilot-codex'))); assert.ok(!existsSync(join(prefix, 'bin', 'codex')));
  assert.equal(run(['uninstall']).status, 0); assert.ok(!existsSync(join(prefix, 'bin', 'pilot-codex')));
});
test('install refuses to overwrite a command it does not own', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), prefix = join(dir, 'prefix'); mkdirSync(join(prefix, 'bin'), { recursive: true }); writeFileSync(join(prefix, 'bin', 'pilot-codex'), 'keep');
  assert.equal(run(['install', '--prefix', prefix]).status, 1); assert.equal(readFileSync(join(prefix, 'bin', 'pilot-codex'), 'utf8'), 'keep');
});
test('global init stores only external key pointer and refuses overwrite', t => {
  const { dir, run } = fixture(t), key = join(dir, 'outside-key.txt'); writeFileSync(key, 'test-placeholder-value');
  assert.equal(run(['init', '--key-file', key]).status, 0);
  assert.ok(!readFileSync(join(dir, 'config', 'config.json'), 'utf8').includes('test-placeholder-value'));
  assert.equal(run(['init', '--key-file', key]).status, 1);
});
test('project discovery respects Git boundary and nested directory', t => {
  const { dir } = fixture(t); mkdirSync(join(dir, 'repo', 'sub'), { recursive: true }); mkdirSync(join(dir, 'repo', '.git'));
  writeFileSync(join(dir, '.jev-pilot.json'), '{}'); assert.equal(findProject(join(dir, 'repo', 'sub')), null);
  writeFileSync(join(dir, 'repo', '.jev-pilot.json'), '{}'); assert.equal(findProject(join(dir, 'repo', 'sub')), join(dir, 'repo', '.jev-pilot.json'));
});
test('Codex -C uses the destination project policy', () => assert.equal(projectDir('codex', ['-C', '/tmp/project'], '/tmp'), '/tmp/project'));
test('classifier and API keys cannot reach child process environment', () => {
  const env = cleanEnv({ TYPESAFE_API_KEY: 'private', JEV_API_KEY: 'private', OPENAI_API_KEY: 'private', ANTHROPIC_AUTH_TOKEN: 'private', PATH: '/bin' });
  assert.deepEqual(env, { PATH: '/bin' });
});
test('empty report is useful and has no invented savings', t => {
  const { run } = fixture(t); const result = run(['report']); assert.equal(result.status, 0); assert.ok(result.stdout.includes('Unavailable'));
});
test('live verification cannot silently pass and does not pollute normal usage logs', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), fake = join(dir, 'fake-claude.mjs');
  writeFileSync(fake, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o755 });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ policy: { sendToJev: false }, binaries: { claude: fake } }));
  const result = run(['verify', '--live', 'claude']);
  assert.equal(result.status, 1); assert.ok(result.stdout.includes('FAIL claude'));
  assert.ok(!existsSync(join(dir, 'data', 'logs')));
  assert.equal(readdirSync(join(dir, 'data', 'verification', 'logs')).length, 1);
});

test('model-scope arguments are consumed and native CLI arguments survive', () => {
  assert.deepEqual(takeModelScope(['--models', 'astra,sol', '-C', '/tmp/project', 'exec', 'hello']), { scope: ['astra', 'sol'], args: ['-C', '/tmp/project', 'exec', 'hello'] });
  assert.deepEqual(takeModelScope(['--models=sol', '--', '--model']), { scope: ['sol'], args: ['--', '--model'] });
  assert.deepEqual(takeModelScope(['--models=luna', '--', '--models', 'literal']), { scope: ['luna'], args: ['--', '--models', 'literal'] });
  for (const args of [['--models'], ['--models='], ['--models', 'sol,'], ['--models', 'sol', '--models', 'luna'], ['--models', 'sol', '-m', 'gpt-6-astra']]) assert.throws(() => takeModelScope(args));
});
test('scoped launcher passes only native arguments and records project override', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), fake = join(dir, 'fake-claude.mjs');
  writeFileSync(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ policy: { sendToJev: false }, binaries: { claude: fake } }));
  writeFileSync(join(dir, '.jev-pilot.json'), JSON.stringify({ claudeModels: ['opus'], minTier: 'balanced' }));
  const result = run(['claude', '--models', 'haiku', '-p', 'hello']);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), ['--model', 'jev-pilot', '-p', 'hello']);
  const file = join(dir, 'data', 'logs', readdirSync(join(dir, 'data', 'logs'))[0]);
  const start = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
  assert.deepEqual(start.allowedModels, ['claude-haiku-5-5']);
});
test('visual report exports offline HTML with agent-wide filters and owner permissions', t => {
  const { dir, run } = fixture(t), file = join(dir, 'report.html');
  assert.equal(run(['report', '--html', file]).status, 0);
  const html = readFileSync(file, 'utf8');
  assert.ok(html.includes('report-data')); assert.ok(html.includes('"codex":')); assert.ok(html.includes('"claude":'));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(run(['report', '--html', file]).status, 1);
  assert.equal(run(['report', '--open', '--json', join(dir, 'x.json')]).status, 1);
});

test('report --open creates a private snapshot and invokes the browser with its exact path', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), tools = join(dir, 'tools'), record = join(dir, 'opened.json'); mkdirSync(tools);
  const opener = join(tools, process.platform === 'darwin' ? 'open' : 'xdg-open');
  writeFileSync(opener, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PILOT_TEST_OPEN_RECORD, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const result = run(['report', '--open'], { PATH: tools + ':' + process.env.PATH, PILOT_TEST_OPEN_RECORD: record });
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(join(dir, 'data', 'reports')); assert.equal(files.length, 1);
  const file = join(dir, 'data', 'reports', files[0]);
  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), [file]); assert.ok(readFileSync(file, 'utf8').includes('<!doctype html>'));
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
