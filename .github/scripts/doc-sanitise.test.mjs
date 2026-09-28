// node --test .github/scripts/doc-sanitise.test.mjs   — issue #121
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeFindings, htmlProse, inScope, newFindings } from './doc-sanitise.mjs';

test('scope: docs, root markdown and app READMEs; never skills or vendored files', () => {
  for (const p of ['docs/spec/01-platform.md', 'docs/reports/05-scope.html', 'AGENTS.md', 'apps/customer/README.md']) assert.ok(inScope(p), p);
  for (const p of ['.claude/skills/x/SKILL.md', 'docs/vendor/lib.md', 'packages/ui-web/README.md', 'docs/a.pdf', 'apps/customer/src/x.md']) assert.ok(!inScope(p), p);
});

test('bare codes are found in markdown, but not inside a link', () => {
  const md = 'Line one.\nSee invariant 10 and [rule L-4](https://x/y).\n';
  const got = codeFindings('docs/a.md', md);
  assert.deepEqual(got.map((f) => [f.match, f.line]), [['invariant 10', 2]]);
});

test('HTML briefs: codes inside <a>, <code> and attributes do not count; line numbers hold', () => {
  const html = '<p>intro</p>\n<p>see <a href="https://x">L-4</a> and <code>R-05</code></p>\n<p title="S-08">bare §4.1</p>';
  assert.equal(htmlProse(html).split('\n').length, 3);
  assert.deepEqual(codeFindings('docs/r.html', html).map((f) => [f.match, f.line]), [['§4.1', 3]]);
});

test('only findings above the baseline count are new', () => {
  const f = (file, key) => ({ file, key });
  const found = [f('a.md', 'Name: Halal Goes'), f('a.md', 'Name: Halal Goes'), f('a.md', 'Emoji: x'), f('b.md', 'Name: Halal Goes')];
  const baseline = { 'a.md': { 'Name: Halal Goes': 2 } };
  assert.deepEqual(newFindings(found, baseline).map((x) => `${x.file} ${x.key}`), ['a.md Emoji: x', 'b.md Name: Halal Goes']);
  // one more occurrence than baselined → every occurrence of that key is reported
  assert.equal(newFindings([...found, f('a.md', 'Name: Halal Goes')], baseline).filter((x) => x.file === 'a.md' && x.key.startsWith('Name')).length, 3);
});
