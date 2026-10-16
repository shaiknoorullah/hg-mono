#!/usr/bin/env node
// report: one self-contained HTML page from a diff run. README.md, "Report".
//
//   node src/report.mjs --results <diff out> [--out <file>] [--title "…"]
//
// Per pair: the verdict, the share of differing pixels, the largest region, the differences in
// words (when the capture has a layout), the designers' notes for the board, and the side by side
// (design | app | diff), embedded. Boards whose notes say the drawing is not the approved design
// come first, so nobody moves an app toward a drawing that is known to be wrong. Full-size images
// stay beside results.json and are linked.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ORDER = { FAIL: 0, 'NO BOARD': 1, UNCOVERED: 1, 'DEFECTIVE REFERENCE': 1, 'NOT COMPARED': 2, UNPAIRABLE: 2, 'BROWSER MISMATCH': 3, 'NO PROVENANCE': 3, 'NO LAYOUT': 3, PASS: 4 };
// The percentage's name says which scale it is on (src/compare.mjs). A results.json from before the
// change has `mismatchPct`, which counted a short capture's missing rows as different; it is shown, but
// marked, and the two are never put in one column without saying so.
const pctOf = (p) => p.sharedHeightMismatchPct ?? p.mismatchPct;
const isLegacy = (p) => p.sharedHeightMismatchPct === undefined && p.mismatchPct !== undefined;
const shortText = (p) => (p.shortfall?.dp ? `${p.shortfall.dp} dp short, ${p.shortfall.pctOfBoardArea} % of the board not compared` : isLegacy(p) ? 'not measured (older scale)' : 'none');
const KIND_ORDER = ['missing', 'extra', 'copy', 'type', 'colour', 'box', 'spacing'];

function args(argv) {
  const o = { results: null, out: null, title: 'Design fidelity' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--results') o.results = path.resolve(argv[++i]);
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else if (argv[i] === '--title') o.title = argv[++i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!o.results) throw new Error('--results <diff out dir> is required');
  o.out ??= path.join(o.results, 'report.html');
  return o;
}

function img(dir, rel) {
  const file = path.join(dir, rel);
  return existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : '';
}

const slug = (p) => `${p.id}@${p.capture}`.replace(/[^A-Za-z0-9-]+/g, '-');

function pairCard(p, dir) {
  const findings = [...(p.layout?.findings ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const metrics =
    p.verdict === 'PASS' || p.verdict === 'FAIL'
      ? `<dl class="metrics"><div><dt>${isLegacy(p) ? 'Differing pixels, OLD scale (short capture padded, padding counted)' : 'Differing pixels, of the compared height'}</dt><dd>${pctOf(p)} %</dd></div><div><dt>Shortfall (not compared)</dt><dd>${esc(shortText(p))}</dd></div><div><dt>Largest region</dt><dd>${p.largestRegion ? `${p.largestRegion.w}×${p.largestRegion.h} dp at ${p.largestRegion.x}, ${p.largestRegion.y}` : 'none'}</dd></div><div><dt>Regions over the limit</dt><dd>${p.regionsOverLimit}</dd></div><div><dt>Board</dt><dd>${esc(p.size)} dp, ×${p.scale}${p.theme ? `, ${p.theme}` : ''}</dd></div></dl>`
      : `<p class="reason">${esc(p.reason)}</p>`;
  return `<article class="pair" id="${slug(p)}">
<header><h3>${esc(p.id)}</h3><span class="verdict v-${p.verdict.replace(' ', '-').toLowerCase()}">${p.verdict}</span></header>
<p class="sub">${esc(p.title ?? '')} · capture <code>${esc(p.capture)}</code></p>
${p.caveats?.length ? `<div class="caveat"><strong>The drawing is not the approved design here.</strong> Do not change the app toward these parts:<ul>${p.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
${p.boardErrors?.length ? `<div class="caveat"><strong>The board did not render cleanly</strong>, so this comparison is not trustworthy:<ul>${p.boardErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
${metrics}
${(p.heightNotes ?? []).map((n) => `<p class="blob">${esc(n)}</p>`).join('')}
${p.missingBlobs?.length ? `<p class="blob">The board's uploaded image${p.missingBlobs.length > 1 ? 's are' : ' is'} missing offline (${p.missingBlobs.map(esc).join(', ')}): it shows as empty in the design.</p>` : ''}
${p.areas?.length ? `<details><summary>${p.areas.length} areas of difference (dp)</summary><ol class="areas">${p.areas.map((a) => `<li>${a.w}×${a.h} at ${a.x}, ${a.y} · ${a.px} px</li>`).join('')}</ol></details>` : ''}
${findings.length ? `<h4>In words (${findings.length})</h4><ul class="findings">${findings.slice(0, 25).map((f) => `<li class="k-${f.kind}">${esc(f.text)}</li>`).join('')}</ul>${findings.length > 25 ? `<p class="more">and ${findings.length - 25} more in results.json</p>` : ''}` : p.verdict === 'FAIL' ? '<p class="more">No layout snapshot for this capture (a phone screenshot), so the differences are in the picture only.</p>' : ''}
${p.notes?.length ? `<details><summary>Designers' notes on this board (${p.notes.length}), hidden from the picture</summary><ul class="notes">${p.notes.map((n) => `<li><b>${esc(n.kind)}</b> ${esc(n.text)}</li>`).join('')}</ul></details>` : ''}
${p.images ? `<figure><img loading="lazy" alt="Design, app and difference side by side for ${esc(p.id)}" src="${img(dir, p.images.preview)}"><figcaption>Design · app · difference (pink: differs, yellow: anti-aliasing only, blue boxes: the areas). Full size: <a href="${esc(p.images.sideBySide)}">side by side</a>, <a href="${esc(p.images.diff)}">difference</a>.</figcaption></figure>` : ''}
</article>`;
}

function main() {
  const o = args(process.argv.slice(2));
  const r = JSON.parse(readFileSync(path.join(o.results, 'results.json'), 'utf8'));
  const pairs = [...r.pairs].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (pctOf(b) ?? 0) - (pctOf(a) ?? 0) || a.id.localeCompare(b.id));
  const count = (v) => pairs.filter((p) => p.verdict === v).length;
  const t = r.thresholds;
  const paired = new Set(pairs.map((p) => p.id));
  const scaleBanner = r.comparison
    ? `<div class="caveat"><strong>Scale: ${esc(r.comparison.convention)}.</strong> ${esc(r.comparison.note)}</div>`
    : `<div class="caveat"><strong>Older scale: these percentages are not comparable with <code>shared-height-v2</code> results.</strong> In this run a capture shorter than its board was padded and the padding counted as different, so a short page reads as mismatched pixels. Re-run the diff on the same captures to get the shared-height figures and the shortfall.</div>`;
  const caveats = Object.entries(r.caveatBoards ?? {});
  const rows = pairs
    .map((p) => `<tr><td><a href="#${slug(p)}">${esc(p.id)}</a>${p.caveats?.length ? ' <span class="flag" title="the drawing is not the approved design in places">not approved as drawn</span>' : ''}</td><td><span class="verdict v-${p.verdict.replace(' ', '-').toLowerCase()}">${p.verdict}</span></td><td class="n">${pctOf(p) ?? '–'}${isLegacy(p) ? ' <span class="flag">old scale</span>' : ''}</td><td>${esc(p.verdict === 'PASS' || p.verdict === 'FAIL' ? shortText(p) : '–')}</td><td class="n">${p.largestRegion ? `${p.largestRegion.w}×${p.largestRegion.h}` : '–'}</td><td>${esc((p.layout?.findings ?? []).slice(0, 2).map((f) => f.text).join(' ') || p.reason || '')}</td></tr>`)
    .join('\n');
  const blobs = Object.values(r.areas ?? {}).filter((a) => a.missingBlobs?.length);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d1d1b;--muted:#5d5c57;--line:#dedbd2;--fail:#a34a00;--fail-bg:#fdf0e3;--pass:#145a8c;--pass-bg:#e6f0f8;--na:#5d5c57;--na-bg:#ecebe6;--warn-bg:#fff6d6;--warn-line:#d9b64c;--link:#0b57a4}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--card:#20201e;--ink:#ecebe6;--muted:#a9a79f;--line:#3a3935;--fail:#ffb36b;--fail-bg:#3a2612;--pass:#8cc4ef;--pass-bg:#13293a;--na:#a9a79f;--na-bg:#2b2a27;--warn-bg:#3a3213;--warn-line:#8a7225;--link:#8cc4ef}}
:root[data-theme=dark]{--bg:#161615;--card:#20201e;--ink:#ecebe6;--muted:#a9a79f;--line:#3a3935;--fail:#ffb36b;--fail-bg:#3a2612;--pass:#8cc4ef;--pass-bg:#13293a;--na:#a9a79f;--na-bg:#2b2a27;--warn-bg:#3a3213;--warn-line:#8a7225;--link:#8cc4ef}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}h3{font-size:16px;margin:0;word-break:break-all}h4{margin:16px 0 4px;font-size:14px}
a{color:var(--link)}code{font-size:13px}.sub,.more,.reason,figcaption{color:var(--muted);font-size:13px}
.summary{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.summary div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}.summary b{display:block;font-size:24px}
.verdict{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}.v-fail{color:var(--fail);background:var(--fail-bg)}.v-pass{color:var(--pass);background:var(--pass-bg)}.v-not-compared,.v-unpairable,.v-uncovered,.v-no-board,.v-defective-reference,.v-browser-mismatch,.v-no-provenance,.v-no-layout{color:var(--na);background:var(--na-bg)}
.flag{font-size:11px;padding:1px 6px;border:1px solid var(--warn-line);background:var(--warn-bg);border-radius:4px;white-space:nowrap}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card);font-size:13px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pair{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}.pair header{display:flex;gap:12px;align-items:center;justify-content:space-between}
.metrics{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0}.metrics dt{font-size:12px;color:var(--muted)}.metrics dd{margin:0;font-weight:600}
.caveat{background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:8px 12px;margin:12px 0;font-size:14px}.caveat ul{margin:4px 0 0;padding-left:20px}
.blob{font-size:13px;color:var(--muted)}.findings,.notes,.areas{margin:4px 0;padding-left:20px;font-size:14px}.findings li{margin:2px 0}
figure{margin:16px 0 0}figure img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#fff}details{margin:8px 0;font-size:14px}summary{cursor:pointer}
</style></head><body><main>
<h1>${esc(o.title)}</h1>
<p class="sub">Captures of the apps against their Claude Design boards (canvases ${esc(r.source?.ref ?? '')}${r.source?.commit ? ` at ${esc(r.source.commit.slice(0, 10))}` : ''}). PASS: at most ${t.maxMismatchPct} % of pixels differ after anti-aliasing and no connected difference is larger than ${t.maxRegionPx}×${t.maxRegionPx} device px. Colour threshold ${t.threshold}.${r.crop ? ` Phone captures cut by ${r.crop.top} px at the top and ${r.crop.bottom} px at the bottom (${esc(r.crop.source)}).` : ''}</p>
${scaleBanner}
<div class="summary"><div><b>${pairs.length}</b>captures</div><div><b>${count('PASS')}</b>pass</div><div><b>${count('FAIL')}</b>fail</div><div><b>${count('NOT COMPARED')}</b>not compared</div><div><b>${count('NO BOARD')}</b>without a board</div><div><b>${count('UNCOVERED')}</b>uncovered</div><div><b>${count('UNPAIRABLE')}</b>unpairable</div><div><b>${count('DEFECTIVE REFERENCE')}</b>defective reference</div><div><b>${count('BROWSER MISMATCH')}</b>other browser</div><div><b>${count('NO PROVENANCE')}</b>no provenance</div></div>
<h2>Every capture</h2><div class="tablewrap"><table><thead><tr><th>Board</th><th>Verdict</th><th>Differing % of compared height</th><th>Shortfall (not compared)</th><th>Largest region (dp)</th><th>First differences</th></tr></thead><tbody>
${rows}
</tbody></table></div>
${caveats.length ? `<h2>Drawings that are not the approved design</h2><p class="sub">Boards whose notes say a part of the drawing is not approved as drawn (a design-system issue, a fix logged, not for approval). Match the app to the approved design there, not to the picture. ${caveats.filter(([id]) => paired.has(id)).length} of them have a capture in this run.</p><details><summary>All ${caveats.length} boards</summary><ul class="notes">${caveats.map(([id, b]) => `<li><b>${esc(id)}</b> ${esc(b.title)}<ul>${b.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></li>`).join('')}</ul></details>` : ''}
${blobs.length ? `<h2>Uploaded images missing offline</h2><p class="sub">These boards load images from the canvas's asset store (/_blob/&lt;id&gt;), which the mirror does not carry; they render empty. Fetch them from the artifact to complete the references.</p><div class="tablewrap"><table><thead><tr><th>Area</th><th>Artifact</th><th>Missing image ids</th></tr></thead><tbody>${blobs.map((a) => `<tr><td>${esc(a.id)}</td><td>${a.artifact ? `<a href="${esc(a.artifact)}">${esc(a.title)}</a>` : esc(a.title)}</td><td><code>${a.missingBlobs.map(esc).join('<br>')}</code></td></tr>`).join('')}</tbody></table></div>` : ''}
<h2>Each capture</h2>
${pairs.map((p) => pairCard(p, o.results)).join('\n')}
</main></body></html>
`;
  writeFileSync(o.out, html);
  console.log(`report: ${o.out} (${Math.round(html.length / 1024)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`report: ${e.message}`);
    process.exit(2);
  }
}
