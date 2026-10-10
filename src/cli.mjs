import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, symlinkSync, lstatSync, readlinkSync, unlinkSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadKey, readCatalog, resolveModels, initGlobal, configHome, readJSON, dataHome } from './config.mjs';
import { createProxy, AUTO } from './proxy.mjs';
import { createLedger, readLedger } from './ledger.mjs';
import { summarize, markdown, htmlReport } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.1.0-alpha.1';
const help = `Jev Pilot ${VERSION} · sunulab · experimental

jev-pilot init [--key-file /absolute/path/outside/repo.txt]
jev-pilot install [--prefix ~/.local]
jev-pilot doctor
jev-pilot codex [Codex arguments...]
jev-pilot claude [Claude Code arguments...]
jev-pilot project init [balanced|economy|quality|shadow]
jev-pilot verify [--live codex|claude|all] [--models]
jev-pilot report [--from /path/to/logs] [--agent codex|claude]
                 [--since YYYY-MM-DD] [--html file | --json file | --markdown file]
jev-pilot uninstall

Aliases: pilot-codex, pilot-claude. Original CLI commands are unchanged.
No prompts or credentials are logged. TypeSafe receives bounded routing context.
API-equivalent estimates are not subscription quota savings.
`;
const option = (args, name) => { const i = args.indexOf(name); if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw new Error(`${name} needs a value`); return i < 0 ? undefined : args[i + 1]; };
export function cleanEnv(input) {
  const env = { ...input };
  for (const k of ['TYPESAFE_API_KEY', 'JEV_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE']) delete env[k];
  return env;
}
export function projectDir(agent, args, cwd = process.cwd()) {
  if (agent !== 'codex') return cwd;
  const direct = args.find(a => a.startsWith('--cd='))?.slice(5);
  return resolve(cwd, direct ?? option(args, '-C') ?? option(args, '--cd') ?? '.');
}
export function agentCommand(agent, args, url, token, context) {
  if (agent === 'claude') return { args: ['--model', AUTO, ...args], env: {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_CUSTOM_HEADERS: [...(process.env.ANTHROPIC_CUSTOM_HEADERS ?? '').split(/\r?\n/).filter(x => x && !x.toLowerCase().startsWith('x-jev-pilot-token:')), `x-jev-pilot-token: ${token}`].join('\n'),
    CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '160000', ENABLE_TOOL_SEARCH: process.env.ENABLE_TOOL_SEARCH ?? 'true',
  } };
  return { args: [
    '-c', 'model_provider="jev_pilot"', '-c', `model="${AUTO}"`, '-c', `model_context_window=${context}`,
    '-c', 'model_providers.jev_pilot.name="Jev Pilot"',
    '-c', `model_providers.jev_pilot.base_url="${url}/v1"`,
    '-c', 'model_providers.jev_pilot.wire_api="responses"',
    '-c', 'model_providers.jev_pilot.requires_openai_auth=true',
    '-c', 'model_providers.jev_pilot.supports_websockets=false',
    '-c', `model_providers.jev_pilot.http_headers={"x-jev-pilot-token"="${token}"}`,
    ...args,
  ], env: {} };
}
export async function runAgent(agent, args, { quiet = false, env = process.env } = {}) {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Expected codex or claude');
  const config = loadConfig(projectDir(agent, args));
  const executable = config.binaries[agent] || agent;
  const direct = !config.policy.enabled || args.some(a => ['--model', '-m', '--help', '-h', '--version', 'login', 'logout', 'auth', 'mcp', 'completion'].includes(a) || a.startsWith('--model='));
  let proxy, ledger;
  let childArgs = args, childEnvironment = cleanEnv(env);
  if (!direct) {
    if ((agent === 'claude' && env.ANTHROPIC_BASE_URL) || (agent === 'codex' && env.OPENAI_BASE_URL)) throw new Error('An existing provider gateway is set. Use the original CLI or remove that override explicitly.');
    const catalog = agent === 'codex' ? readCatalog(env) : [];
    const models = resolveModels(config.policy, agent, catalog);
    const key = config.policy.sendToJev ? loadKey(config, env) : '';
    ledger = createLedger({ agent, warn: message => console.error(`[Jev Pilot] ${message}`) });
    ledger.log({ event: 'session_start', mode: config.policy.mode });
    proxy = createProxy({ agent, ...config, models, catalog, key, log: ledger.log,
      notice: message => { if (!quiet) console.error(message); } });
    const url = await proxy.listen();
    const command = agentCommand(agent, args, url, proxy.token, Math.min(...Object.values(models).map(m => m.context)));
    childArgs = command.args;
    childEnvironment = { ...childEnvironment, ...command.env };
    if (!quiet) console.error(`[Jev Pilot] ${agent} · ${config.policy.mode} · ${key ? 'Jev enabled' : 'no Jev key; default route'} · report ${ledger.path}`);
  }
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(executable, childArgs, { env: childEnvironment, stdio: quiet ? 'ignore' : 'inherit' });
      const forward = sig => child.kill(sig);
      const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
      process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
      const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
      child.once('error', () => { cleanup(); reject(new Error(`${agent} could not start. Check PATH and jev-pilot doctor.`)); });
      child.once('exit', (exitCode, signal) => { cleanup(); resolve(signal ? 130 : exitCode ?? 1); });
    });
  } finally { if (proxy) await proxy.close(); ledger?.log({ event: 'session_end' }); ledger?.close(); }
  return { code, logPath: ledger?.path };
}
function doctor() {
  const checks = [{ name: 'Node.js 22+', ok: Number(process.versions.node.split('.')[0]) >= 22 }];
  const config = loadConfig();
  let key = ''; try { key = loadKey(config); } catch { /* report only status */ }
  checks.push({ name: 'TypeSafe key configured', ok: Boolean(key) });
  for (const agent of ['codex', 'claude']) {
    const executable = config.binaries[agent] || agent;
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, env: cleanEnv(process.env) });
    const number = version.stdout?.match(/\d+\.\d+\.\d+/)?.[0];
    checks.push({ name: `${agent} installed${number ? ' · ' + number : ''}`, ok: version.status === 0 });
    if (version.status === 0) {
      const login = spawnSync(executable, agent === 'codex' ? ['login', 'status'] : ['auth', 'status'], { encoding: 'utf8', timeout: 10000, env: cleanEnv(process.env) });
      const loggedIn = agent === 'codex' ? /ChatGPT/i.test(login.stdout + login.stderr) && login.status === 0 : (() => { try { const d = JSON.parse(login.stdout); return d.loggedIn === true && d.authMethod !== 'api_key'; } catch { return false; } })();
      checks.push({ name: `${agent} subscription login detected`, ok: loggedIn });
    }
  }
  try { resolveModels(config.policy, 'codex', readCatalog()); checks.push({ name: 'Codex model catalog (not entitlement)', ok: true }); }
  catch { checks.push({ name: 'Codex model catalog (run plain codex or configure models)', ok: false }); }
  console.log(checks.map(c => `${c.ok ? 'PASS' : 'CHECK'}  ${c.name}`).join('\n'));
  console.log('Only a completed live inference verifies model access. No paid calls were made.');
  return checks;
}
export async function verifyLive(target, allModels = false) {
  if (!['codex', 'claude', 'all'].includes(target)) throw new Error('--live requires codex, claude or all');
  const results = [];
  const cwd = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'jev-pilot-verify-'));
  try {
    for (const agent of target === 'all' ? ['codex', 'claude'] : [target]) {
      process.chdir(temp);
      const config = loadConfig(temp);
      const seen = new Set();
      const tiers = allModels ? ['fast', 'balanced', 'strong', 'frontier'].filter(t => {
        const model = config.policy[agent][t]; if (seen.has(model)) return false; seen.add(model); return true;
      }) : [null];
      for (const tier of tiers) {
      const workspace = mkdtempSync(join(temp, agent + '-')); process.chdir(workspace);
      if (tier) writeFileSync(join(workspace, '.jev-pilot.json'), JSON.stringify({ minTier: tier, defaultTier: tier, maxTier: tier, mode: 'turn' }));
      const prompt = 'Reply with exactly JEV_PILOT_OK. Do not use any tools or access files.';
      const args = agent === 'codex' ? ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', prompt] : ['-p', prompt, '--max-turns', '1', '--permission-mode', 'plan'];
      const result = await runAgent(agent, args, { quiet: true });
      const events = result.logPath ? readLedger(result.logPath).events : [];
      const s = summarize(events);
      const observed = events.filter(e => e.event === 'response' && e.completed && e.servedModel && (e.servedModel === e.model || e.servedModel.startsWith(e.model + '-')));
      const ok = result.code === 0 && s.jevSucceeded > 0 && observed.length > 0;
      results.push({ agent, tier, ok, jevRequests: s.jevRequests, servedModels: [...new Set(observed.map(e => e.servedModel))] });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${agent}${tier ? ' / ' + tier : ''}: Jev ${s.jevSucceeded}/${s.jevRequests}, verified responses ${observed.length}`);
      }
    }
  } finally { process.chdir(cwd); rmSync(temp, { recursive: true, force: true }); }
  return results.every(r => r.ok) ? 0 : 1;
}
function install(prefix) {
  if (process.platform === 'win32') throw new Error('On Windows use npm install --global . instead of source symlinks');
  const bin = resolve(prefix ?? join(homedir(), '.local'), 'bin');
  const names = ['jev-pilot', 'pilot-codex', 'pilot-claude'];
  const links = names.map(name => ({ path: join(bin, name), target: join(ROOT, 'bin', name + '.mjs') }));
  for (const link of links) {
    try { const stat = lstatSync(link.path); if (!stat.isSymbolicLink() || readlinkSync(link.path) !== link.target) throw new Error(`Refusing to replace ${link.path}`); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  mkdirSync(bin, { recursive: true }); mkdirSync(configHome(), { recursive: true, mode: 0o700 });
  for (const link of links) { chmodSync(link.target, 0o755); if (!existsSync(link.path)) symlinkSync(link.target, link.path); }
  writeFileSync(join(configHome(), 'install.json'), JSON.stringify({ links }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Installed in ${bin}. Keep the source directory in place. Add this bin directory to PATH if needed. Original codex/claude/jev-codex commands are unchanged.`);
}
function uninstall() {
  const file = join(configHome(), 'install.json'), manifest = readJSON(file, { links: [] });
  for (const link of manifest.links) {
    try { if (lstatSync(link.path).isSymbolicLink() && readlinkSync(link.path) === link.target) unlinkSync(link.path); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  if (existsSync(file)) unlinkSync(file);
  console.log('Removed source-install launchers that still matched the manifest. Keys, settings and local reports were kept. npm installs: npm uninstall --global @sunulab/jev-pilot');
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return 0; }
  if (command === '--version') { console.log(VERSION); return 0; }
  if (command === 'init') { initGlobal(option(rest, '--key-file')); console.log('Created global configuration. Key contents were not copied. Next: jev-pilot doctor'); return 0; }
  if (command === 'install') { install(option(rest, '--prefix')); return 0; }
  if (command === 'uninstall') { uninstall(); return 0; }
  if (command === 'doctor') { doctor(); return 0; }
  if (command === 'project' && rest[0] === 'init') {
    const preset = rest[1] ?? 'balanced';
    const presets = { balanced: {}, economy: { maxTier: 'balanced', defaultTier: 'balanced' }, quality: { minTier: 'balanced', maxEffort: 'xhigh' }, shadow: { mode: 'shadow' } };
    if (!(preset in presets)) throw new Error('Preset must be balanced, economy, quality or shadow');
    writeFileSync(resolve('.jev-pilot.json'), JSON.stringify({ enabled: true, ...presets[preset] }, null, 2) + '\n', { flag: 'wx' });
    console.log('Created .jev-pilot.json. It contains policy only; no keys or destinations.'); return 0;
  }
  if (command === 'verify') {
    const live = option(rest, '--live');
    if (live) return verifyLive(live, rest.includes('--models'));
    const check = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check.mjs')], { stdio: 'inherit' });
    if (check.status !== 0) return 1;
    const test = spawnSync(process.execPath, ['--test', ...readJSON(join(ROOT, 'test', 'manifest.json'), []) .map(f => join(ROOT, 'test', f))], { stdio: 'inherit', cwd: ROOT });
    return test.status ?? 1;
  }
  if (command === 'report') {
    const agent = option(rest, '--agent'), since = option(rest, '--since');
    if (agent && !['codex', 'claude'].includes(agent)) throw new Error('Invalid --agent');
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since requires YYYY-MM-DD (UTC)');
    const { events, malformed } = readLedger(option(rest, '--from'));
    const summary = summarize(events, { agent, since });
    const format = ['html', 'json', 'markdown'].find(f => rest.includes('--' + f));
    if (format) {
      const file = resolve(option(rest, '--' + format));
      writeFileSync(file, format === 'html' ? htmlReport(summary) : format === 'json' ? JSON.stringify(summary, null, 2) + '\n' : markdown(summary), { flag: 'wx', mode: 0o600 });
      console.log(`Saved ${file}`);
    } else console.log(markdown(summary));
    if (malformed) console.error(`Skipped ${malformed} malformed or truncated records.`);
    return 0;
  }
  if (['codex', 'claude'].includes(command)) return (await runAgent(command, rest)).code;
  throw new Error('Unknown command. See jev-pilot --help');
}
export function entry(args) {
  main(args).then(code => { process.exitCode = code; }).catch(err => { console.error(`[Jev Pilot] ${err.message}`); process.exitCode = 1; });
}
