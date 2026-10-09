/**
 * Composition lint (#112 step 4), web side. WARN mode: it reports, it never fails.
 *
 * The redesign builds screens by composing @hg/ui-web, not by drawing controls in the
 * apps. Two rules, from the owner's 28 Sep version (plan/design-system.md §4.0):
 *
 *   C-1  apps may not define components. In the web apps (restaurant, admin) any file
 *        under src/components/ that is not in the baseline taken when this lint landed
 *        is reported. The baseline is the legacy code the rebuild replaces.
 *   C-2  no raw interactive elements outside the library layer. Reported:
 *        - `<button>`, `<input>`, `<select>`, `<textarea>` or `<a onClick>` anywhere in
 *          the web apps' src/** (restaurant, admin), except in the legacy files that
 *          already had one when this lint landed (the raw-element baseline: 8 files);
 *        - the same anywhere in apps/<app>/src/redesign/**, baseline or not;
 *        - the same inside @hg/ui-web, but only in the new code: src/ds/** and
 *          src/proposed/**. src/lib/** is the library layer where raw elements belong,
 *          and the legacy tiers are left alone until they are rebuilt.
 *
 * It flips to an error at W8 (design-system.md §4.1). Until then exit 0, always.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** C-1: an app defines a component. C-2: a raw interactive element outside src/lib/. */
export type CompositionRule = 'C-1' | 'C-2';

/** One warning from the composition lint. */
export interface CompositionFinding {
  rule: CompositionRule;
  /** Repo-relative, forward slashes. */
  file: string;
  line: number;
  message: string;
}

/** The web apps whose src/components/ is frozen at the baseline. */
export const WEB_APPS = ['restaurant', 'admin'] as const;

/** Directories inside @hg/ui-web whose code is new and must compose. */
export const UI_WEB_NEW_DIRS = ['src/ds', 'src/proposed'] as const;

const SOURCE = /\.(tsx|jsx|ts|js)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '__snapshots__']);

/** Raw interactive elements. `<a … onClick` may span lines; `=>` inside the tag is allowed. */
const RAW_ELEMENT = /<(button|input|select|textarea)(?=[\s/>])/g;
const ANCHOR_ONCLICK = /<a\s(?:[^>]|=>)*?\bonClick\b/g;

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Every raw interactive element in one source text, as `{ line, element }`. */
export function findRawElements(source: string): Array<{ line: number; element: string }> {
  const out: Array<{ line: number; element: string }> = [];
  for (const m of source.matchAll(RAW_ELEMENT)) {
    out.push({ line: lineOf(source, m.index ?? 0), element: `<${m[1]}>` });
  }
  for (const m of source.matchAll(ANCHOR_ONCLICK)) {
    out.push({ line: lineOf(source, m.index ?? 0), element: '<a onClick>' });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * The two baselines the lint compares against, both repo-relative file lists:
 * `files` for C-1 (legacy src/components files) and `rawElementFiles` for C-2 (legacy
 * app files that already held a raw interactive element).
 */
export interface CompositionBaseline {
  files: readonly string[];
  rawElementFiles?: readonly string[];
}

/** Every source file under `root` (absolute paths); none if it does not exist. */
export function listSources(root: string, into: string[] = []): string[] {
  if (!existsSync(root)) return into;
  if (statSync(root).isFile()) {
    if (SOURCE.test(root)) into.push(root);
    return into;
  }
  for (const entry of readdirSync(root)) {
    if (SKIP.has(entry)) continue;
    listSources(join(root, entry), into);
  }
  return into;
}

const rel = (repo: string, path: string): string => relative(repo, path).split(sep).join('/');

/** The files C-1 compares against the baseline, repo-relative. */
export function componentFiles(repo: string): string[] {
  return WEB_APPS.flatMap((app) =>
    listSources(join(repo, 'apps', app, 'src', 'components')).map((f) => rel(repo, f)),
  ).sort();
}

/** The web-app files that hold a raw interactive element today, repo-relative. */
export function rawElementFiles(repo: string): string[] {
  return WEB_APPS.flatMap((app) =>
    listSources(join(repo, 'apps', app, 'src'))
      .filter((f) => findRawElements(readFileSync(f, 'utf8')).length > 0)
      .map((f) => rel(repo, f)),
  ).sort();
}

function rawFindings(repo: string, files: string[], where: string): CompositionFinding[] {
  const out: CompositionFinding[] = [];
  for (const file of files) {
    for (const hit of findRawElements(readFileSync(file, 'utf8'))) {
      out.push({
        rule: 'C-2',
        file: rel(repo, file),
        line: hit.line,
        message: `raw ${hit.element} in ${where}: compose a @hg/ui-web component instead`,
      });
    }
  }
  return out;
}

/** Run both rules over a repo checkout against the legacy baselines. */
export function lintComposition(repo: string, baseline: CompositionBaseline): CompositionFinding[] {
  const known = new Set(baseline.files);
  const legacyRaw = new Set(baseline.rawElementFiles ?? []);
  const findings: CompositionFinding[] = [];

  for (const file of componentFiles(repo)) {
    if (known.has(file)) continue;
    findings.push({
      rule: 'C-1',
      file,
      line: 1,
      message: 'new file under src/components/: apps compose @hg/ui-web, they do not define components',
    });
  }

  // Web apps: every file outside src/redesign/ (checked below) and the legacy baseline.
  const isRedesign = (file: string): boolean => /^apps\/[^/]+\/src\/redesign\//.test(file);
  for (const app of WEB_APPS) {
    const files = listSources(join(repo, 'apps', app, 'src')).filter((f) => {
      const path = rel(repo, f);
      return !isRedesign(path) && !legacyRaw.has(path);
    });
    findings.push(...rawFindings(repo, files, `apps/${app}/src`));
  }

  // Redesign folders in any app: no exceptions.
  const appsDir = join(repo, 'apps');
  const apps = existsSync(appsDir) ? readdirSync(appsDir) : [];
  for (const app of apps) {
    const files = listSources(join(appsDir, app, 'src', 'redesign'));
    findings.push(...rawFindings(repo, files, `apps/${app}/src/redesign`));
  }

  for (const dir of UI_WEB_NEW_DIRS) {
    const files = listSources(join(repo, 'packages', 'ui-web', dir));
    findings.push(...rawFindings(repo, files, `@hg/ui-web ${dir} (raw elements belong in src/lib/)`));
  }

  return findings;
}
