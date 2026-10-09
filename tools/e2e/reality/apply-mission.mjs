#!/usr/bin/env node
// Applies a device-lab mission's reality steps to one emulator, in order.
//
//   node tools/e2e/reality/apply-mission.mjs <mission.yaml> --serial emulator-5554 [--dry-run]
//   node tools/e2e/reality/apply-mission.mjs <mission.yaml> --serial emulator-5554 --restore [--dry-run]
//
// The mission is checked first (tools/e2e/native/check-missions.mjs, same rules); an invalid
// mission is refused before any command runs. --dry-run prints the adb commands and runs none.
// --restore puts the emulator back (stops the route, network and airplane mode back, light
// theme, 100% text, screen on, the app's permissions granted again).
//
// It does not run the mission's setup commands or its flows: the lab session runs
// `cd services/hg && <setup>` and `maestro test <flow>` itself (tools/e2e/native/README.md).
// Exit codes: 0 applied, 1 an adb command failed, 2 refused.
import { resolve, relative, sep } from 'node:path';
import { NATIVE_DIR, checkMission } from '../native/mission-lib.mjs';
import { checkSerial, parseArgs, restoreActions, stepActions } from './lib.mjs';
import { runActions } from './exec.mjs';

/** The actions for a parsed, valid mission. */
export function planMission(mission, { restore = false } = {}) {
  if (restore) return restoreActions(mission.app);
  return (mission.reality ?? []).flatMap((step) => stepActions(step, mission.app));
}

async function main() {
  let args;
  let serial;
  try {
    args = parseArgs(process.argv.slice(2), { serial: String, 'dry-run': Boolean, restore: Boolean });
    if (args._.length !== 1) throw new Error('usage: apply-mission.mjs <mission.yaml> --serial emulator-NNNN [--dry-run] [--restore]');
    serial = checkSerial(args.serial);
  } catch (err) {
    console.error(`refused: ${err.message}`);
    return 2;
  }
  const file = resolve(args._[0]);
  const inRepo = !relative(NATIVE_DIR, file).startsWith('..') && !relative(NATIVE_DIR, file).startsWith(sep);
  const { mission, problems } = checkMission(file, { inRepoLayout: inRepo });
  if (problems.length) {
    console.error(`refused: ${args._[0]} is not a valid mission:`);
    for (const p of problems) console.error(`    ${p}`);
    return 2;
  }
  let actions;
  try {
    actions = planMission(mission, { restore: args.restore });
  } catch (err) {
    console.error(`refused: ${err.message}`);
    return 2;
  }
  const what = args.restore ? 'restore' : `${mission.reality?.length ?? 0} reality step(s)`;
  console.log(`# mission ${mission.id} (${mission.app} on ${mission.avd}, ${serial}): ${what}${args['dry-run'] ? ', dry run' : ''}`);
  try {
    await runActions(actions, serial, { dryRun: Boolean(args['dry-run']) });
  } catch (err) {
    console.error(`failed: ${err.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = await main();
}
