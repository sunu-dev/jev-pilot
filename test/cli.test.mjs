import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { agentCommand, cleanEnv, projectDir, takeModelScope, takeLaunchOptions, verifiedResponses } from '../src/cli.mjs';
import { DEFAULTS, findProject, scopedPolicy, activeModelIds, readJSON } from '../src/config.mjs';
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
test('configuration accepts a leading UTF-8 BOM from editors without accepting invalid JSON', t => {
  const { dir } = fixture(t), file = join(dir, 'policy.json');
  writeFileSync(file, '\uFEFF{"enabled":true}\r\n'); assert.deepEqual(readJSON(file), { enabled: true });
  writeFileSync(file, '\uFEFF{"enabled":'); assert.throws(() => readJSON(file), /Invalid JSON/);
});
test('project discovery respects Git boundary and nested directory', t => {
  const { dir } = fixture(t); mkdirSync(join(dir, 'repo', 'sub'), { recursive: true }); mkdirSync(join(dir, 'repo', '.git'));
  writeFileSync(join(dir, '.jev-pilot.json'), '{}'); assert.equal(findProject(join(dir, 'repo', 'sub')), null);
  writeFileSync(join(dir, 'repo', '.jev-pilot.json'), '{}'); assert.equal(findProject(join(dir, 'repo', 'sub')), join(dir, 'repo', '.jev-pilot.json'));
});
test('Codex -C uses the destination project policy', () => assert.equal(projectDir('codex', ['-C', '/tmp/project'], '/tmp'), '/tmp/project'));
test('Codex configuration overrides share one root scope across nested commands', () => {
  const build = args => agentCommand('codex', args, 'http://127.0.0.1:1234', 'local-test-token', 272000).args;
  const defaults = build([]);
  const args = ['-c', 'duplicate=1', 'exec', '--config', 'model_reasoning_effort="medium"', 'resume', '--last', '--config=duplicate=2', '-cattached=true', '-c=other=true', '-C', '/tmp/project', 'hello'];
  const original = [...args];
  assert.deepEqual(build(args), [...defaults,
    '-c', 'duplicate=1', '-c', 'model_reasoning_effort="medium"', '-c', 'duplicate=2', '-c', 'attached=true', '-c', 'other=true',
    'exec', 'resume', '--last', '-C', '/tmp/project', 'hello',
  ]);
  assert.deepEqual(args, original);
  assert.equal(build(args).slice(build(args).indexOf('exec')).includes('-c'), false);
});
test('Codex configuration normalization preserves literal arguments after --', () => {
  const build = args => agentCommand('codex', args, 'http://127.0.0.1:1234', 'local-test-token', 272000).args;
  assert.deepEqual(build(['exec', '--config=enabled=true', '--', '-c', 'literal=1', '--config=literal=2']),
    [...build([]), '-c', 'enabled=true', 'exec', '--', '-c', 'literal=1', '--config=literal=2']);
  for (const args of [['exec', '-c'], ['resume', '--config'], ['exec', '-c', '--']]) assert.throws(() => build(args), /needs a value/);
});
test('Codex-only configuration normalization leaves Claude native arguments intact', () => {
  const args = ['-p', 'hello', '-c', '--config=literal'];
  assert.deepEqual(agentCommand('claude', args, 'http://127.0.0.1:1234', 'local-test-token', 272000).args, ['--model', 'jev-pilot', ...args]);
});
test('classifier and API keys cannot reach child process environment', () => {
  const env = cleanEnv({ TYPESAFE_API_KEY: 'private', JEV_API_KEY: 'private', OPENAI_API_KEY: 'private', ANTHROPIC_AUTH_TOKEN: 'private', PATH: '/bin' });
  assert.deepEqual(env, { PATH: '/bin' });
});
test('empty report is useful and has no invented savings', t => {
  const { run } = fixture(t); const result = run(['report']); assert.equal(result.status, 0); assert.ok(result.stdout.includes('Unavailable'));
});
test('feedback command records a local rating and rejects missing decisions and invalid ratings', t => {
  const { dir, run } = fixture(t);
  assert.equal(run(['feedback', 'too-weak', '--agent', 'codex']).status, 1);
  const logs = join(dir, 'data', 'logs'); mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, 'fixture.jsonl'), JSON.stringify({ schema: 1, event: 'decision', agent: 'codex', run: 'fixture', session: 's', decisionId: 'choice-1', ts: '2026-10-10T12:00:00Z', model: 'gpt-example', effort: 'medium' }) + '\n');
  const result = run(['feedback', 'too-weak', '--agent', 'codex']);
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('Recorded too-weak')); assert.ok(result.stdout.includes('2026-10-10'));
  assert.equal(run(['feedback', 'invalid']).status, 1);
  assert.equal(run(['feedback', 'right', '--agent=claude']).status, 1);
  for (const args of [['feedback','right','--agnt','codex'], ['feedback','right','--agent','codex','--agent=codex'], ['feedback','right','--agent=']]) assert.equal(run(args).status, 1);
  const report = run(['report']); assert.equal(report.status, 0); assert.match(report.stdout, /Locally rated decisions\s+1 \/ 1/); assert.match(report.stdout, /Too weak \/ rework\s+1 \/ 0/);
});
test('feedback --decision selects the exact decision across projects with strict optional arguments', t => {
  const { dir, run } = fixture(t), logs = join(dir, 'data', 'logs'); mkdirSync(logs, { recursive: true });
  const first = { schema: 1, event: 'decision', agent: 'codex', run: 'first-project', session: 'first-session', decisionId: 'choice-one', ts: '2026-10-10T12:00:00Z', model: 'gpt-example', effort: 'medium' };
  const latest = { ...first, agent: 'claude', run: 'other-project', session: 'other-session', decisionId: 'choice-two', ts: '2026-10-10T12:01:00Z', model: 'claude-example' };
  writeFileSync(join(logs, 'fixture.jsonl'), [first, latest].map(JSON.stringify).join('\n') + '\n');
  const saved = run(['feedback', 'too-weak', '--decision', 'choice-one', '--agent=codex']);
  assert.equal(saved.status, 0, saved.stderr); assert.match(saved.stdout, /codex.*decision choice-one at 2026-10-10/);
  const corrected = run(['feedback', 'right', '--decision=choice-one']);
  assert.equal(corrected.status, 0, corrected.stderr); assert.match(corrected.stdout, /Recorded right for codex/);
  for (const args of [
    ['--decision'], ['--decision='], ['--decision', 'choice-one', '--decision=choice-one'],
    ['--decision', 'missing'], ['--decision', 'choice-one', '--agent', 'claude'],
    ['--decison', 'choice-one'], ['--decision', '/private/path'], ['--decision', 'choice-one', 'unexpected'],
  ]) assert.equal(run(['feedback', 'rework', ...args]).status, 1, args.join(' '));
  const feedback = readdirSync(logs).filter(name => name !== 'fixture.jsonl').flatMap(name => readFileSync(join(logs, name), 'utf8').trim().split('\n').map(JSON.parse));
  assert.equal(feedback.length, 2);
  assert.ok(feedback.every(event => event.sourceDecision === 'choice-one' && event.sourceRun === first.run && event.sourceSession === first.session));
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
test('all-model live verification isolates each physical model from a global scope', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), fake = join(dir, 'fake-claude.mjs'), record = join(dir, 'cases.jsonl');
  writeFileSync(fake, '#!/usr/bin/env node\nimport { appendFileSync, readFileSync } from "node:fs";\nappendFileSync(process.env.PILOT_TEST_CASES, readFileSync(".jev-pilot.json", "utf8") + "\\n");\n', { mode: 0o755 });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'config.json'), JSON.stringify({ policy: { sendToJev: false, claudeModels: ['sonnet'] }, binaries: { claude: fake } }));
  const result = run(['verify', '--live', 'claude', '--models'], { PILOT_TEST_CASES: record });
  assert.equal(result.status, 1); // The fake CLI produces no inference; this only exercises case isolation.
  const cases = readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(cases.length, 3);
  const expected = [...new Set(Object.values(DEFAULTS.claude))];
  assert.deepEqual(cases.map(c => c.claudeModels[0]), expected);
  for (const c of cases) assert.deepEqual(activeModelIds(scopedPolicy({ ...DEFAULTS, claudeModels: ['sonnet'], ...c }, 'claude'), 'claude'), c.claudeModels);
});
test('live verification requires the expected model, including a matching served model', () => {
  const e = { event: 'response', completed: true, model: DEFAULTS.codex.balanced, servedModel: DEFAULTS.codex.balanced };
  assert.equal(verifiedResponses([e], DEFAULTS.codex.fast).length, 0);
  assert.equal(verifiedResponses([{ ...e, model: DEFAULTS.codex.fast }], DEFAULTS.codex.fast).length, 0);
  assert.equal(verifiedResponses([{ ...e, servedModel: e.model + '-20261001' }], e.model).length, 1);
  assert.equal(verifiedResponses([{ ...e, completed: false }], e.model).length, 0);
});

test('model-scope arguments are consumed and native CLI arguments survive', () => {
  assert.deepEqual(takeModelScope(['--models', 'astra,sol', '-C', '/tmp/project', 'exec', 'hello']), { scope: ['astra', 'sol'], args: ['-C', '/tmp/project', 'exec', 'hello'] });
  assert.deepEqual(takeModelScope(['--models=sol', '--', '--model']), { scope: ['sol'], args: ['--', '--model'] });
  assert.deepEqual(takeModelScope(['--models=luna', '--', '--models', 'literal']), { scope: ['luna'], args: ['--', '--models', 'literal'] });
  for (const args of [['--models'], ['--models='], ['--models', 'sol,'], ['--models', 'sol', '--models', 'luna'], ['--models', 'sol', '-m', 'gpt-6-astra']]) assert.throws(() => takeModelScope(args));
});
test('--no-jev is a launch flag, respects the native argument boundary and composes with model scope', () => {
  assert.deepEqual(takeLaunchOptions(['--no-jev', '--models=sol', 'exec', 'hello']), { scope: ['sol'], noJev: true, args: ['exec', 'hello'] });
  assert.deepEqual(takeLaunchOptions(['--no-jev', '--', '--no-jev', '--models', 'literal']), { scope: undefined, noJev: true, args: ['--', '--no-jev', '--models', 'literal'] });
  assert.deepEqual(takeLaunchOptions(['-p', 'hello']), { scope: undefined, noJev: false, args: ['-p', 'hello'] });
  assert.deepEqual(takeLaunchOptions(['--', '--no-jev=false']), { scope: undefined, noJev: false, args: ['--', '--no-jev=false'] });
  for (const args of [['--no-jev', '--no-jev'], ['--no-jev=true'], ['--no-jev=false']]) assert.throws(() => takeLaunchOptions(args), /--no-jev/);
});
test('--no-jev skips external classification and key loading for one run while retaining proxy responses', { skip: process.platform === 'win32' }, t => {
  const { dir, run } = fixture(t), fake = join(dir, 'fake-claude.mjs'), intercept = join(dir, 'intercept.mjs'), requests = join(dir, 'requests.jsonl');
  writeFileSync(intercept, `import { appendFileSync } from 'node:fs';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  appendFileSync(process.env.PILOT_TEST_REQUESTS, JSON.stringify({ origin: url.origin }) + '\\n');
  if (url.origin !== 'https://api.anthropic.com') throw new Error('Unexpected external request was intercepted');
  const body = JSON.parse(init.body);
  return new Response(JSON.stringify({ id: 'msg-offline', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 15, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
};
`);
  writeFileSync(fake, `#!/usr/bin/env node
const headers = Object.fromEntries(process.env.ANTHROPIC_CUSTOM_HEADERS.split(/\\r?\\n/).filter(Boolean).map(line => { const index = line.indexOf(':'); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
const response = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', authorization: 'Bearer fake-subscription' }, body: JSON.stringify({ model: 'jev-pilot', messages: [{ role: 'user', content: 'A harmless offline test' }], max_tokens: 10 }) });
if (!response.ok) throw new Error('Local test request failed');
console.log(JSON.stringify({ args: process.argv.slice(2), response: await response.json() }));
`, { mode: 0o755 });
  mkdirSync(join(dir, 'config'));
  const configPath = join(dir, 'config', 'config.json');
  const configuration = JSON.stringify({ policy: { sendToJev: true }, keyFile: join(dir, 'missing-key.txt'), binaries: { claude: fake } });
  writeFileSync(configPath, configuration);
  const env = { NODE_OPTIONS: '--import=' + pathToFileURL(intercept).href, PILOT_TEST_REQUESTS: requests, TYPESAFE_API_KEY: '', JEV_API_KEY: '', ANTHROPIC_BASE_URL: '', ANTHROPIC_CUSTOM_HEADERS: '' };
  const result = run(['claude', '--no-jev', '-p', 'hello'], env);
  assert.equal(result.status, 0, result.stderr);
  const child = JSON.parse(result.stdout);
  assert.deepEqual(child.args, ['--model', 'jev-pilot', '-p', 'hello']);
  assert.equal(child.response.model, DEFAULTS.claude.balanced);
  assert.match(result.stderr, /Jev disabled for this run; local reporting active/);
  assert.deepEqual(readFileSync(requests, 'utf8').trim().split('\n').map(JSON.parse), [{ origin: 'https://api.anthropic.com' }]);
  const logs = join(dir, 'data', 'logs');
  const events = readdirSync(logs).flatMap(name => readFileSync(join(logs, name), 'utf8').trim().split('\n').map(JSON.parse));
  assert.equal(events.find(event => event.event === 'session_start').policySnapshot.sendToJev, false);
  assert.ok(events.some(event => event.event === 'decision'));
  assert.ok(events.some(event => event.event === 'response' && event.completed));
  assert.ok(!events.some(event => event.event === 'jev_request'));
  assert.equal(readFileSync(configPath, 'utf8'), configuration);
  // A later run loads the configured key again; the missing file fails locally.
  assert.equal(run(['claude', '-p', 'hello'], env).status, 1);
  assert.match(run(['--help']).stdout, /--no-jev[\s\S]*--decision ID/);
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
  assert.equal(start.runtimeVersion, readJSON(resolve('package.json')).version);
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
