// Device-lab missions: loading and checking. Shared by check-missions.mjs (every mission in the
// repo) and ../reality/apply-mission.mjs (one mission, before it touches an emulator).
//
// The schema (mission.schema.json) checks shape. This file adds what a schema cannot: the id is
// the file's base name and unique, the app matches the folder, referenced files exist, and every
// `make dev-scenario s=<name>` names a scenario devworld knows (read from its Go source, so a new
// scenario needs no change here).
//
// No dependency of its own: `yaml` and `ajv` are borrowed from @hg/contract-tools, which already
// depends on both. Plain `node` can run this from any directory.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../..');
export const NATIVE_DIR = join(REPO_ROOT, 'tools/e2e/native');
export const SCHEMA_PATH = join(NATIVE_DIR, 'mission.schema.json');
const SCENARIO_GO = join(REPO_ROOT, 'services/hg/internal/devworld/scenario.go');

export const APPS = ['customer', 'rider'];
export const REALITY_KEYS = [
  'geo-route', 'network', 'theme', 'font-scale', 'deny-permission',
  'lock', 'background-ms', 'airplane', 'camera-media',
];

let cached;
function libs() {
  if (cached) return cached;
  const from = join(REPO_ROOT, 'tools/contract-tools/package.json');
  const req = createRequire(from);
  try {
    const YAML = req('yaml');
    const Ajv = req('ajv');
    cached = { YAML, Ajv: Ajv.default ?? Ajv };
  } catch (err) {
    throw new Error(`cannot load yaml/ajv through @hg/contract-tools (${err.message}). Run: pnpm install`);
  }
  return cached;
}

let validator;
function schemaValidator() {
  if (validator) return validator;
  const { Ajv } = libs();
  const ajv = new Ajv({ allErrors: true, strict: false });
  validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  return validator;
}

/** Parse one YAML document strictly. Throws with the file name on a syntax error. */
export function parseYamlFile(file) {
  const { YAML } = libs();
  const doc = YAML.parseDocument(readFileSync(file, 'utf8'), { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join('\n'));
  return doc.toJS();
}

/** The scenario names `devworld scenario` accepts, read from its Go source. */
export function devworldScenarios() {
  const src = readFileSync(SCENARIO_GO, 'utf8');
  const block = src.match(/var ScenarioNames = \[\]string\{([\s\S]*?)\n\}/);
  if (!block) throw new Error(`cannot find ScenarioNames in ${relative(REPO_ROOT, SCENARIO_GO)}`);
  const names = [...block[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  if (!names.length) throw new Error(`ScenarioNames in ${relative(REPO_ROOT, SCENARIO_GO)} is empty`);
  return names;
}

/** Every mission file in the repo: tools/e2e/native/<app>/redesign/missions/*.y(a)ml. */
export function findMissionFiles() {
  const out = [];
  for (const app of APPS) {
    const dir = join(NATIVE_DIR, app, 'redesign/missions');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (/\.ya?ml$/.test(name)) out.push(join(dir, name));
    }
  }
  return out;
}

const repoFile = (p) => {
  const abs = resolve(REPO_ROOT, p);
  return abs.startsWith(REPO_ROOT + sep) && existsSync(abs) && statSync(abs).isFile();
};

function realityItemProblem(item, i) {
  const where = `reality[${i}]`;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return `${where}: must be a one-key mapping such as "- network: edge"`;
  }
  const keys = Object.keys(item);
  if (keys.length !== 1) return `${where}: must have exactly one key, found ${keys.length} (${keys.join(', ') || 'none'})`;
  const [k] = keys;
  const v = item[k];
  switch (k) {
    case 'geo-route':
      return `${where}: geo-route must be a path like tools/e2e/native/routes/<name>.gpx, got ${JSON.stringify(v)}`;
    case 'network':
      return `${where}: network must be gsm | edge | umts | full | offline | restore, got ${JSON.stringify(v)}` +
        (/airplane/i.test(String(v)) ? '. Airplane mode is its own step: "- airplane: on" / "- airplane: off"' : '') +
        (typeof v === 'string' && v.includes(' ') ? `. ${STEP_TIMING}` : '');
    case 'theme':
      return `${where}: theme must be light | dark, got ${JSON.stringify(v)}`;
    case 'font-scale':
      return `${where}: font-scale must be a number from 0.85 to 2.0, got ${JSON.stringify(v)}`;
    case 'deny-permission':
      return `${where}: deny-permission must be location | camera | notifications, got ${JSON.stringify(v)}`;
    case 'lock':
      return `${where}: lock must be true or false, got ${JSON.stringify(v)}`;
    case 'background-ms':
      return `${where}: background-ms must be a whole number of milliseconds from 1 to 600000, got ${JSON.stringify(v)}`;
    case 'airplane':
      return `${where}: airplane must be on | off, got ${JSON.stringify(v)}`;
    case 'camera-media':
      return `${where}: camera-media must be a .jpg, .jpeg, .png or .pdf path under tools/e2e/native/media/, got ${JSON.stringify(v)}`;
    default:
      return `${where}: "${k}" is not an allowed reality step (allowed: ${REALITY_KEYS.join(', ')})`;
  }
}

/** Why a free-text reality value cannot work, appended where a value reads like an instruction. */
const STEP_TIMING =
  'Reality steps run once, in order, before the flows; a change in the middle of a flow (airplane mode for one tap, a GPS jump) goes in the flow itself, e.g. Maestro setAirplaneMode, and anything else for the lab goes in explore';

function ajvMessage(e) {
  const at = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '(top level)';
  if (e.keyword === 'additionalProperties') return `${at}: unknown key "${e.params.additionalProperty}"`;
  if (e.keyword === 'required') return `${at}: missing required key "${e.params.missingProperty}"`;
  if (e.keyword === 'enum') return `${at}: must be one of ${e.params.allowedValues.join(' | ')}`;
  if (e.keyword === 'const') return `${at}: must be ${JSON.stringify(e.params.allowedValue)}`;
  if (e.keyword === 'pattern' && /^setup\.\d+$/.test(at)) {
    return `${at}: not an allowed setup command (allowed: "make dev-reset", "make dev-admin", "make dev-scenario s=<name>", "make dev-journey [route=short|long|early-rider] [speed=1x|4x|max] [auto=none|restaurant|all] [manual=rider]")`;
  }
  if (e.keyword === 'pattern' && /^flows\.\d+$/.test(at)) {
    return `${at}: must be a .yaml flow under tools/e2e/native/<app>/redesign/ (not under missions/), for this mission's app`;
  }
  return `${at}: ${e.message}`;
}

/**
 * Check one mission. Returns { mission, problems }. `problems` is empty when the mission is
 * valid. `opts.inRepoLayout` (default true) also checks that the file sits in its app's folder.
 */
export function checkMission(file, opts = {}) {
  const inRepoLayout = opts.inRepoLayout ?? true;
  const scenarios = opts.scenarios ?? devworldScenarios();
  const problems = [];
  let mission;
  try {
    mission = parseYamlFile(file);
  } catch (err) {
    return { mission: undefined, problems: [`not valid YAML: ${err.message}`] };
  }
  if (mission === null || typeof mission !== 'object' || Array.isArray(mission)) {
    return { mission, problems: ['must be a YAML mapping (id, app, avd, api, setup, reality, flows, explore)'] };
  }

  // 1. Shape, from the schema. Reality items get one plain message each instead of ajv's oneOf noise.
  const validate = schemaValidator();
  if (!validate(mission)) {
    const realityBad = new Set();
    for (const e of validate.errors) {
      const m = e.instancePath.match(/^\/reality\/(\d+)/);
      if (m) { realityBad.add(Number(m[1])); continue; }
      if (e.keyword === 'if' || e.keyword === 'oneOf') continue;
      problems.push(ajvMessage(e));
    }
    for (const i of [...realityBad].sort((a, b) => a - b)) problems.push(realityItemProblem(mission.reality[i], i));
  }

  // 2. What the schema cannot say.
  const base = basename(file).replace(/\.ya?ml$/, '');
  if (typeof mission.id === 'string' && mission.id !== base) {
    problems.push(`id "${mission.id}" must equal the file name "${base}"`);
  }
  if (inRepoLayout) {
    const rel = relative(NATIVE_DIR, resolve(file)).split(sep);
    const folderApp = rel[0];
    if (rel.length !== 4 || rel[1] !== 'redesign' || rel[2] !== 'missions' || !APPS.includes(folderApp)) {
      problems.push('must live at tools/e2e/native/<customer|rider>/redesign/missions/<id>.yaml');
    } else if (mission.app && mission.app !== folderApp) {
      problems.push(`app "${mission.app}" does not match its folder (${folderApp})`);
    }
  }
  for (const [i, cmd] of (Array.isArray(mission.setup) ? mission.setup : []).entries()) {
    if (typeof cmd !== 'string') continue;
    const s = cmd.match(/^make dev-scenario s=(\S+)$/);
    if (s && !scenarios.includes(s[1])) {
      problems.push(`setup.${i}: devworld has no scenario "${s[1]}" (known: ${scenarios.join(', ')})`);
    }
    if (cmd.startsWith('make dev-journey')) {
      const keys = cmd.split(' ').slice(2).map((a) => a.split('=')[0]);
      const dup = keys.find((k, j) => keys.indexOf(k) !== j);
      if (dup) problems.push(`setup.${i}: dev-journey sets ${dup}= twice`);
    }
  }
  for (const [i, item] of (Array.isArray(mission.reality) ? mission.reality : []).entries()) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['geo-route', 'camera-media']) {
      if (typeof item[key] === 'string' && !repoFile(item[key])) {
        problems.push(`reality[${i}]: ${key} file ${item[key]} does not exist`);
      }
    }
    if (typeof item['geo-route'] === 'string' && repoFile(item['geo-route'])) {
      try {
        parseGpx(readFileSync(resolve(REPO_ROOT, item['geo-route']), 'utf8'));
      } catch (err) {
        problems.push(`reality[${i}]: ${item['geo-route']}: ${err.message}`);
      }
    }
  }
  for (const [i, flow] of (Array.isArray(mission.flows) ? mission.flows : []).entries()) {
    if (typeof flow === 'string' && !repoFile(flow)) problems.push(`flows.${i}: ${flow} does not exist`);
  }
  return { mission, problems: [...new Set(problems)] };
}

/** Check a whole set of missions, including that ids are unique across them. */
export function checkMissions(files, opts = {}) {
  const scenarios = opts.scenarios ?? devworldScenarios();
  const results = files.map((file) => ({ file, ...checkMission(file, { ...opts, scenarios }) }));
  const seen = new Map();
  for (const r of results) {
    const id = r.mission?.id;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) {
      r.problems.push(`id "${id}" is also used by ${relative(REPO_ROOT, seen.get(id))}`);
    } else {
      seen.set(id, r.file);
    }
  }
  return results;
}

// Toronto, generously: every devworld point is inside it. A route outside is a typo (lat/lon swapped).
const BBOX = { minLat: 43.4, maxLat: 44.0, minLon: -79.8, maxLon: -79.0 };

/**
 * The track points of a GPX file: [{ lat, lon, t }] with t in ms since the first point.
 * Throws when there are fewer than two points, a point has no time, time goes backwards, or a
 * point falls outside Toronto.
 */
export function parseGpx(xml) {
  const pts = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(xml))) {
    const lat = Number(m[1].match(/\blat="([^"]+)"/)?.[1]);
    const lon = Number(m[1].match(/\blon="([^"]+)"/)?.[1]);
    const time = m[2].match(/<time>([^<]+)<\/time>/)?.[1];
    const ms = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`point ${pts.length + 1} has no numeric lat/lon`);
    if (!Number.isFinite(ms)) throw new Error(`point ${pts.length + 1} has no valid <time>`);
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
      throw new Error(`point ${pts.length + 1} (${lat}, ${lon}) is outside Toronto: lat and lon swapped?`);
    }
    pts.push({ lat, lon, ms });
  }
  if (pts.length < 2) throw new Error('a route needs at least two <trkpt> points');
  const t0 = pts[0].ms;
  return pts.map((p, i) => {
    if (i > 0 && p.ms <= pts[i - 1].ms) throw new Error(`point ${i + 1}: time does not move forward`);
    return { lat: p.lat, lon: p.lon, t: p.ms - t0 };
  });
}
