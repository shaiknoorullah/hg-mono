# Design preview

A page that renders every `src/**/*.preview.tsx` specimen, and a script that screenshots each
specimen beside the live design system's own preview of the same component.

```bash
pnpm --filter @hg/ui-web preview
```

Serves the page on <http://localhost:6106>. Query parameters: `?component=Button`, `?theme=dark`,
`?hg-theme=restaurant`, `?density=compact`, `?text-scale=200`.

```bash
pnpm --filter @hg/ui-web preview:shoot -- --ref <claude-design-system/project dir> --widths 1440,390
```

Writes the screenshots and a side-by-side report (reference on the left, candidate on the right)
to `preview/out/report/index.html`. `preview/out/` is gitignored. Without `--ref` it shoots the
candidate only. It uses the repo's root Playwright and never
installs a browser; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if its pinned Chromium is missing.

## Writing a specimen file

A specimen file sits beside its component, for example `src/primitives/Button.preview.tsx`. It
exports `component` (the design system's component name) and one function per state, named after
the matching labelled row of `components/<Name>/preview.html`, so the report can pair them.

Lay specimens out with the plain classes in `preview/preview.css` (`hg-specimen-row`,
`hg-specimen-col`), not Tailwind utilities. The released apps' Tailwind scans every `.ts` and
`.tsx` file under `src/`, so a utility used only in a specimen would be added to their CSS.
