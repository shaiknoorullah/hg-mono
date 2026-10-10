/**
 * Guards for the React Native Reusables tier (design-system plan section 6.1, risks 3 and 4).
 *
 * RNR's templates colour everything with `hsl(var(--x))` and draw icons with
 * `lucide-react-native`. Our variables hold complete hex colours (`global.<theme>.css`), so an
 * `hsl()` wrapper produces an invalid colour, and our icons are the Solar set behind `Icon`.
 * Both are edited out on copy-in; this test fails the build when one slips through, anywhere in
 * `packages/ui-native/src`, generated files included. The RNR CLI (components.json) also writes
 * `@/lib/...` imports, which Metro cannot resolve in a source package: those must become
 * relative. Comments are ignored, so a note saying "never hsl()" is fine.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.css']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name)) && full !== __filename) out.push(full);
  }
  return out;
}

/** Drops block and line comments; good enough for a guard (strings are left intact). */
const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const files = sourceFiles(SRC);

describe('the RNR tier stays on our tokens and icons', () => {
  it('scans the package source', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no hsl() colour anywhere in packages/ui-native/src', () => {
    const offenders = files.filter((f) => /\bhsla?\(/i.test(withoutComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('no lucide import anywhere in packages/ui-native/src', () => {
    const offenders = files.filter((f) =>
      /(from\s+|require\(\s*|import\(\s*)['"]lucide/.test(withoutComments(fs.readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('no `@/` alias import survives a copy-in (Metro cannot resolve it; use relative paths)', () => {
    const offenders = files.filter((f) =>
      /(from\s+|require\(\s*|import\(\s*)['"]@\//.test(withoutComments(fs.readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
