#!/usr/bin/env node
// Fails the run when the design captures stopped getting a view hierarchy.
//
//   node check-hierarchies.mjs [screenshots dir]
//
// A capture's hierarchy comes from a file Maestro writes for a deliberately unmatched step
// (design-capture.yaml, pick-hierarchies.mjs). That leans on Maestro's debug output rather than a
// documented API, so a Maestro upgrade could stop producing it — and the failure would be quiet:
// every native pair would go back to NO LAYOUT, the diff reports those without failing the run
// (`--no-strict`), and no native board would be measured again until somebody noticed the number.
//
// This is the noticing. It fails the way android/design-size.sh does, for the same reason: a native
// capture that cannot be measured is worse than a red run, because it looks like progress.
//
// It is silent when there are no design captures at all — a web-only run has none, and that is not
// a regression.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? path.join(process.env.E2E_OUT ?? 'e2e-out', 'screenshots');

/** Every `design--*.png` under a directory, and whether a hierarchy sits beside it. */
export function captures(dir) {
  const out = [];
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
      else if (e.isFile() && e.name.startsWith('design--') && e.name.endsWith('.png')) {
        out.push({ file: p, hasLayout: existsSync(p.replace(/\.png$/, '.hierarchy.json')) || existsSync(p.replace(/\.png$/, '.hierarchy.xml')) });
      }
    }
  };
  walk(dir);
  return out;
}

const found = captures(root);
const withLayout = found.filter((c) => c.hasLayout);

if (!found.length) {
  console.log('check-hierarchies: no design captures in this run; nothing to check');
  process.exit(0);
}

console.log(`check-hierarchies: ${withLayout.length} of ${found.length} design captures have a view hierarchy`);

if (!withLayout.length) {
  const names = found.slice(0, 5).map((c) => path.basename(c.file));
  console.error(
    '::error title=design captures have no view hierarchy::' +
      `${found.length} design captures were taken and not one has a hierarchy beside it, so no native board can be measured. ` +
      'Maestro writes it for the unmatched probe step in tools/e2e/native/design-capture.yaml, and ' +
      'tools/e2e/native/pick-hierarchies.mjs puts it beside the capture. A Maestro upgrade that stopped writing ' +
      `screen-hierarchy/ would look exactly like this. See https://github.com/shaiknoorullah/hg-mono/issues/1026. Captures: ${names.join(', ')}`,
  );
  process.exit(1);
}

// Some but not all: a flow that ended early took its later captures with it, which is the flow's
// failure to report, not this one's.
if (withLayout.length < found.length) {
  const missing = found.filter((c) => !c.hasLayout).slice(0, 5).map((c) => path.basename(c.file));
  console.log(`::warning title=some design captures have no view hierarchy::${found.length - withLayout.length} of ${found.length} are missing one (${missing.join(', ')}). The diff reports each as NO LAYOUT.`);
}
