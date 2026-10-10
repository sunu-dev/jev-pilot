import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanEnv, projectDir } from '../src/cli.mjs';
import { findProject } from '../src/config.mjs';
const bin = resolve('bin/jev-pilot.mjs');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, run: args => spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, JEV_PILOT_CONFIG_HOME: join(dir, 'config'), JEV_PILOT_DATA_HOME: join(dir, 'data') } }) };
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
