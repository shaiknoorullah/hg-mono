#!/usr/bin/env node
// One reality step by hand, through the same allow-list as a mission.
//
//   node tools/e2e/reality/step.mjs <step> <value> --serial emulator-5554 [--app customer|rider] [--dry-run]
//
//   network gsm|edge|umts|full|offline|restore   theme light|dark        font-scale 0.85..2.0
//   deny-permission location|camera|notifications (needs --app)           lock true|false
//   background-ms <1..600000> (needs --app)      airplane on|off
//   camera-media tools/e2e/native/media/<file>    geo-route tools/e2e/native/routes/<file>.gpx
//   restore -                                     everything back to normal (--app also re-grants)
import { stepActions, restoreActions, parseArgs } from './lib.mjs';
import { runActions } from './exec.mjs';

function value(key, raw) {
  if (raw === undefined) throw new Error(`${key} needs a value`);
  if (key === 'font-scale') return Number(raw);
  if (key === 'background-ms') return Number(raw);
  if (key === 'lock') {
    if (raw === 'true' || raw === 'false') return raw === 'true';
    throw new Error('lock takes true or false');
  }
  return raw;
}

try {
  const args = parseArgs(process.argv.slice(2), { serial: String, app: String, 'dry-run': Boolean });
  const [key, raw] = args._;
  const actions = key === 'restore' ? restoreActions(args.app) : stepActions({ [key]: value(key, raw) }, args.app);
  await runActions(actions, args.serial, { dryRun: Boolean(args['dry-run']) });
} catch (err) {
  console.error(`refused: ${err.message}`);
  process.exit(2);
}
