// The allow-list: every adb command the device lab's reality helpers may run, and nothing else.
//
// A reality step ({ network: 'edge' }, { theme: 'dark' }, ...) becomes a list of actions:
//   { adb: [...] }          one adb invocation, always `adb -s <emulator serial> ...`, never a shell string
//   { sleep: ms }           wait
//   { geoRoute: 'path' }    start background GPX playback (geo-route.mjs)
// Anything not built here is refused. Commands run through spawnSync with an argument vector,
// so a value can never smuggle in a second command.
//
// What each step maps to, and why: README.md in this folder, and plan DEVICE-LAB.md §5.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../..');

/** Only emulators. A USB phone's serial never matches, so a helper cannot touch a real device. */
export const SERIAL_RE = /^emulator-\d{4,5}$/;

export const PACKAGES = { customer: 'com.halalgoes.customer.dev', rider: 'com.halalgoes.rider.dev' };

const NETWORK_DELAY = { gsm: 'gprs', edge: 'edge', umts: 'umts', full: 'none' };

const PERMISSIONS = {
  location: [
    ['android.permission.ACCESS_FINE_LOCATION', false],
    ['android.permission.ACCESS_COARSE_LOCATION', false],
    // Only the rider declares it; revoking an undeclared permission fails, so tolerate that.
    ['android.permission.ACCESS_BACKGROUND_LOCATION', true],
  ],
  camera: [['android.permission.CAMERA', false]],
  notifications: [['android.permission.POST_NOTIFICATIONS', false]],
};

export function checkSerial(serial) {
  if (typeof serial !== 'string' || !SERIAL_RE.test(serial)) {
    throw new Error(`--serial must be an emulator serial such as emulator-5554, got ${JSON.stringify(serial)}`);
  }
  return serial;
}

function repoPathUnder(p, dir, exts) {
  if (typeof p !== 'string') throw new Error(`expected a path under ${dir}/, got ${JSON.stringify(p)}`);
  const abs = resolve(REPO_ROOT, p);
  const base = resolve(REPO_ROOT, dir) + sep;
  if (!abs.startsWith(base) || abs.slice(base.length).includes(sep)) {
    throw new Error(`${p} is not a file directly under ${dir}/`);
  }
  if (!exts.some((e) => abs.toLowerCase().endsWith(e))) throw new Error(`${p} must end in ${exts.join(' or ')}`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`${p} does not exist`);
  return abs;
}

export const gpxPath = (p) => repoPathUnder(p, 'tools/e2e/native/routes', ['.gpx']);
const mediaPath = (p) => repoPathUnder(p, 'tools/e2e/native/media', ['.jpg', '.jpeg', '.png', '.pdf']);

const shell = (...a) => ({ adb: ['shell', ...a] });
const emu = (...a) => ({ adb: ['emu', ...a] });

/**
 * The actions for one reality step. Throws on anything outside the allow-list.
 * `app` picks the package for steps that act on the app (deny-permission, background-ms).
 */
export function stepActions(step, app) {
  if (step === null || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).length !== 1) {
    throw new Error(`a reality step is a mapping with exactly one key, got ${JSON.stringify(step)}`);
  }
  const [[key, v]] = Object.entries(step);
  const pkg = PACKAGES[app];
  const needApp = () => {
    if (!pkg) throw new Error(`${key} acts on the app: --app must be customer or rider, got ${JSON.stringify(app)}`);
    return pkg;
  };
  switch (key) {
    case 'geo-route':
      gpxPath(v);
      return [{ geoRoute: v }];
    case 'network':
      if (v in NETWORK_DELAY) return [emu('network', 'speed', v), emu('network', 'delay', NETWORK_DELAY[v])];
      if (v === 'offline') return [shell('svc', 'wifi', 'disable'), shell('svc', 'data', 'disable')];
      if (v === 'restore') {
        return [shell('svc', 'wifi', 'enable'), shell('svc', 'data', 'enable'),
          emu('network', 'speed', 'full'), emu('network', 'delay', 'none')];
      }
      break;
    case 'theme':
      if (v === 'dark' || v === 'light') return [shell('cmd', 'uimode', 'night', v === 'dark' ? 'yes' : 'no')];
      break;
    case 'font-scale':
      if (typeof v === 'number' && v >= 0.85 && v <= 2.0) return [shell('settings', 'put', 'system', 'font_scale', String(v))];
      break;
    case 'deny-permission':
      if (v in PERMISSIONS) {
        const p = needApp();
        return PERMISSIONS[v].map(([perm, tolerate]) => ({ ...shell('pm', 'revoke', p, perm), ...(tolerate ? { tolerate } : {}) }));
      }
      break;
    case 'lock':
      // KEYCODE_SLEEP / KEYCODE_WAKEUP rather than KEYCODE_POWER (26), which toggles: a second
      // lock step would wake the screen.
      if (v === true) return [shell('input', 'keyevent', 'KEYCODE_SLEEP')];
      if (v === false) return [shell('input', 'keyevent', 'KEYCODE_WAKEUP'), shell('wm', 'dismiss-keyguard')];
      break;
    case 'background-ms':
      if (Number.isInteger(v) && v >= 1 && v <= 600000) {
        const p = needApp();
        return [shell('input', 'keyevent', 'KEYCODE_HOME'), { sleep: v },
          shell('am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', p)];
      }
      break;
    case 'airplane':
      if (v === 'on' || v === 'off') return [shell('cmd', 'connectivity', 'airplane-mode', v === 'on' ? 'enable' : 'disable')];
      break;
    case 'camera-media': {
      mediaPath(v);
      const remote = `/sdcard/Pictures/${basename(v)}`;
      return [{ adb: ['push', v, remote] },
        shell('am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`)];
    }
    default:
      throw new Error(`"${key}" is not an allowed reality step`);
  }
  throw new Error(`${key}: ${JSON.stringify(v)} is not an allowed value`);
}

/** Back to a plain device: what --restore runs. Permissions are granted back where declared. */
export function restoreActions(app) {
  const out = [
    { geoStop: true },
    shell('cmd', 'connectivity', 'airplane-mode', 'disable'),
    ...stepActions({ network: 'restore' }),
    ...stepActions({ theme: 'light' }),
    shell('settings', 'put', 'system', 'font_scale', '1.0'),
    ...stepActions({ lock: false }),
  ];
  if (PACKAGES[app]) {
    for (const list of Object.values(PERMISSIONS)) {
      for (const [perm] of list) out.push({ ...shell('pm', 'grant', PACKAGES[app], perm), tolerate: true });
    }
  }
  return out;
}

const quote = (a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

/** The command line an action stands for, for --dry-run and logs. */
export function describe(action, serial) {
  if (action.adb) return `adb -s ${serial} ${action.adb.map(quote).join(' ')}${action.tolerate ? '   # may fail: tolerated' : ''}`;
  if (action.sleep) return `sleep ${action.sleep / 1000}`;
  if (action.geoRoute) return `node tools/e2e/reality/geo-route.mjs start ${action.geoRoute} --serial ${serial}   # background, 1 Hz`;
  if (action.geoStop) return `node tools/e2e/reality/geo-route.mjs stop --serial ${serial}`;
  throw new Error(`unknown action ${JSON.stringify(action)}`);
}

const ADB = process.env.ADB || 'adb';

/** Run one adb action. Throws on a non-zero exit unless the action is tolerated. */
export function runAdb(action, serial) {
  const argv = ['-s', checkSerial(serial), ...action.adb];
  const res = spawnSync(ADB, argv, { cwd: REPO_ROOT, encoding: 'utf8' });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  if (res.error) throw new Error(`cannot run ${ADB}: ${res.error.message}`);
  // `adb shell` passes the remote exit code through; some commands (pm) also print errors with 0.
  const failed = res.status !== 0 || /^(Error|Exception|Security exception|java\.)/m.test(out);
  if (failed && !action.tolerate) throw new Error(`${describe(action, serial)} failed (${res.status}): ${out}`);
  return out;
}

export function parseArgs(argv, flags) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (!(name in flags)) throw new Error(`unknown option ${a}`);
    if (flags[name] === Boolean) out[name] = true;
    else {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out[name] = argv[++i];
    }
  }
  return out;
}
