#!/usr/bin/env node
// Puts each design capture's view hierarchy beside its screenshot.
//
//   node pick-hierarchies.mjs <maestro debug dir> <screenshot dir>
//
// Maestro writes `screen-hierarchy/step-NNN-<command>-<selector>.json` for a step that failed or
// was retried. design-capture.yaml makes one on purpose, with the capture's own name as the
// selector of an element nothing has, so the file that lands is named after the capture
// (https://github.com/shaiknoorullah/hg-mono/issues/1026). This copies it to
// `<screenshots>/<capture>.hierarchy.json`, where the diff looks for it.
//
// **Matched by name, never by order.** Pairing the nth hierarchy with the nth capture would read
// the wrong screen against a board the moment a capture was added in the middle of a flow, and it
// would do it silently — a plausible wrong answer, which is worse than none.
//
// Prints one line per capture and never fails: a missing hierarchy is already reported by the diff
// as NO LAYOUT, and a capture must not break the journey it measures. The loud failure belongs
// where it can name what is missing, which is the diff.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every `screen-hierarchy/*.json` under a Maestro debug directory, newest last. */
export function hierarchyFiles(debugDir) {
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.json') && path.basename(d) === 'screen-hierarchy') found.push(p);
    }
  };
  walk(debugDir);
  return found.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

/**
 * The capture a hierarchy file is for, from its name, or null when it is not one of ours.
 *
 * `step-053-tapOnElement-design--sign-in--Main.json` → `design--sign-in--Main`. Maestro puts the
 * step number and the command in front and may rewrite characters it cannot use in a file name, so
 * the capture name is taken as what follows the command and is required to look like a capture
 * (`design--<area>--<Board>`). A step that failed for a real reason — an assertion, a tap that
 * should have matched — also leaves a file here, and must not be mistaken for a capture's.
 */
export function captureNameOf(file) {
  const m = /^step-\d+-[A-Za-z]+-(design--[A-Za-z0-9][A-Za-z0-9._-]*--[A-Za-z0-9][A-Za-z0-9._-]*)\.json$/.exec(path.basename(file));
  return m ? m[1] : null;
}

function main([debugDir, shotDir]) {
  if (!debugDir || !shotDir) {
    console.log('pick-hierarchies: usage: pick-hierarchies.mjs <maestro debug dir> <screenshot dir>');
    return;
  }
  const files = hierarchyFiles(debugDir);
  if (!files.length) return;
  mkdirSync(shotDir, { recursive: true });
  let taken = 0;
  const other = [];
  for (const f of files) {
    const name = captureNameOf(f);
    if (!name) {
      other.push(path.basename(f));
      continue;
    }
    // Last one wins: a flow that captures the same board twice means the later screen is the one
    // its screenshot shows, because takeScreenshot overwrites by name too.
    copyFileSync(f, path.join(shotDir, `${name}.hierarchy.json`));
    taken++;
  }
  console.log(`pick-hierarchies: ${taken} hierarch${taken === 1 ? 'y' : 'ies'} beside their captures${other.length ? `; ${other.length} from other failed steps left where they are (${other.slice(0, 3).join(', ')}${other.length > 3 ? ', …' : ''})` : ''}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main(process.argv.slice(2));
