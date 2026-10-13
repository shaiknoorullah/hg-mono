// Runs (or, with dryRun, prints) a list of allow-listed actions from lib.mjs, in order.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, checkSerial, describe, runAdb } from './lib.mjs';
import { stop as geoStop } from './geo-route.mjs';

const GEO = fileURLToPath(new URL('./geo-route.mjs', import.meta.url));

export async function runActions(actions, serial, { dryRun = false, log = console.log } = {}) {
  checkSerial(serial);
  for (const a of actions) {
    log(`${dryRun ? '' : '→ '}${describe(a, serial)}`);
    if (dryRun) continue;
    if (a.adb) {
      const out = runAdb(a, serial);
      if (out) log(`  ${out.split('\n').join('\n  ')}`);
    } else if (a.sleep) {
      await new Promise((r) => setTimeout(r, a.sleep));
    } else if (a.geoRoute) {
      const res = spawnSync(process.execPath, [GEO, 'start', a.geoRoute, '--serial', serial], { cwd: REPO_ROOT, encoding: 'utf8' });
      if (res.status !== 0) throw new Error(`geo-route start failed: ${res.stderr || res.stdout}`);
      log(`  ${res.stdout.trim()}`);
    } else if (a.geoStop) {
      geoStop(serial);
    } else {
      throw new Error(`refused: not an allow-listed action ${JSON.stringify(a)}`);
    }
  }
}
