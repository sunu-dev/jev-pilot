import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

export const TIERS = ['fast', 'balanced', 'strong', 'frontier'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULTS = {
  enabled: true, sendToJev: true, mode: 'adaptive', minTier: 'fast', maxTier: 'frontier',
  defaultTier: 'balanced', maxEffort: 'high', minConfidence: 0.6,
  downgradeAfter: 3, warmTokens: 20000, cacheIdleMinutes: 5, requestChars: 2000,
  codex: { fast: 'gpt-6-luna', balanced: 'gpt-6.1-sol', strong: 'gpt-6.1-sol', frontier: 'gpt-6-astra' },
  claude: { fast: 'claude-haiku-5-5', balanced: 'claude-sonnet-5-5', strong: 'claude-opus-5-5', frontier: 'claude-opus-5-5' },
};
const projectKeys = new Set(Object.keys(DEFAULTS));
export const configHome = () => process.env.JEV_PILOT_CONFIG_HOME || join(homedir(), '.config', 'jev-pilot');
export const dataHome = () => process.env.JEV_PILOT_DATA_HOME || join(homedir(), '.local', 'share', 'jev-pilot');
export const expand = p => p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
export function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(`Invalid JSON in ${file}`); }
}
export function findProject(start) {
  for (let dir = resolve(start);; dir = dirname(dir)) {
    const file = join(dir, '.jev-pilot.json');
    if (existsSync(file)) return file;
    if (existsSync(join(dir, '.git')) || dir === dirname(dir)) return null;
  }
}
export function validatePolicy(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Policy must be an object');
  for (const k of Object.keys(p)) if (!projectKeys.has(k)) throw new Error(`Unknown policy setting: ${k}`);
  for (const k of ['enabled', 'sendToJev']) if (typeof p[k] !== 'boolean') throw new Error(`Invalid ${k}`);
  if (!['adaptive', 'turn', 'shadow'].includes(p.mode)) throw new Error('mode must be adaptive, turn or shadow');
  for (const k of ['minTier', 'maxTier', 'defaultTier']) if (!TIERS.includes(p[k])) throw new Error(`Invalid ${k}`);
  if (TIERS.indexOf(p.minTier) > TIERS.indexOf(p.defaultTier) || TIERS.indexOf(p.defaultTier) > TIERS.indexOf(p.maxTier)) throw new Error('Expected minTier <= defaultTier <= maxTier');
  if (!EFFORTS.includes(p.maxEffort)) throw new Error('Invalid maxEffort');
  for (const [k, min, max] of [['minConfidence', 0, 1], ['downgradeAfter', 1, 10], ['warmTokens', 0, 1000000], ['cacheIdleMinutes', 0, 60], ['requestChars', 100, 4000]]) {
    if (!Number.isFinite(p[k]) || p[k] < min || p[k] > max) throw new Error(`Invalid ${k}`);
  }
  for (const k of ['downgradeAfter', 'warmTokens', 'requestChars']) if (!Number.isInteger(p[k])) throw new Error(`Invalid ${k}`);
  for (const agent of ['claude', 'codex']) for (const tier of TIERS) {
    if (!new RegExp(`^${agent === 'codex' ? 'gpt' : 'claude'}-[A-Za-z0-9._-]+$`).test(p[agent]?.[tier] ?? '')) throw new Error(`Invalid ${agent}.${tier}`);
  }
  return p;
}
export function loadConfig(cwd = process.cwd()) {
  const global = readJSON(join(configHome(), 'config.json'), {});
  const file = findProject(cwd);
  const local = file ? readJSON(file) : {};
  for (const k of Object.keys(local)) if (!projectKeys.has(k)) throw new Error(`Project setting not allowed: ${k}`);
  const policy = validatePolicy({ ...DEFAULTS, ...global.policy, ...local,
    codex: { ...DEFAULTS.codex, ...global.policy?.codex, ...local.codex },
    claude: { ...DEFAULTS.claude, ...global.policy?.claude, ...local.claude } });
  validatePrices(global.prices ?? {});
  if (global.jevPrice !== undefined && (!Number.isFinite(global.jevPrice) || global.jevPrice < 0)) throw new Error('jevPrice must be nonnegative USD per million input tokens');
  return { policy, file, keyFile: expand(global.keyFile), prices: global.prices ?? {}, jevPrice: global.jevPrice, binaries: global.binaries ?? {} };
}
export function validatePrices(prices) {
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) throw new Error('Invalid prices');
  for (const p of Object.values(prices)) {
    if (!p || !Number.isFinite(p.in) || !Number.isFinite(p.out) || p.in < 0 || p.out < 0) throw new Error('Prices require nonnegative in and out USD per million tokens');
    for (const k of ['cacheRead', 'cacheWrite']) if (p[k] !== undefined && (!Number.isFinite(p[k]) || p[k] < 0)) throw new Error(`Invalid price ${k}`);
  }
}
export function loadKey(config, env = process.env) {
  const key = env.TYPESAFE_API_KEY || env.JEV_API_KEY || (config.keyFile ? readFileSync(config.keyFile, 'utf8').trim() : '');
  if (key && (/\s/.test(key) || key.length < 8)) throw new Error('Key must contain only a TypeSafe API key');
  return key;
}
export function initGlobal(keyFile) {
  if (keyFile && !existsSync(expand(keyFile))) throw new Error('Key file does not exist');
  mkdirSync(configHome(), { recursive: true, mode: 0o700 });
  writeFileSync(join(configHome(), 'config.json'), JSON.stringify({ ...(keyFile ? { keyFile: resolve(expand(keyFile)) } : {}), policy: {} }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export function readCatalog(env = process.env) {
  return readJSON(join(env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), { models: [] }).models ?? [];
}
export function resolveModels(policy, agent, catalog = []) {
  if (agent === 'claude') return Object.fromEntries(TIERS.map(t => [t, { model: policy.claude[t], efforts: policy.claude[t].includes('haiku') ? [] : EFFORTS, context: 200000 }]));
  const resolved = Object.fromEntries(TIERS.map(t => {
    const m = catalog.find(m => m.slug === policy.codex[t]);
    if (!m) throw new Error(`Model ${policy.codex[t]} is absent from the local Codex catalog. Run plain codex once, or configure codex.${t}.`);
    return [t, { model: m.slug, efforts: m.supported_reasoning_levels?.map(l => l.effort).filter(e => EFFORTS.includes(e)) ?? ['low', 'medium', 'high'], context: m.context_window ?? 200000 }];
  }));
  return resolved;
}
