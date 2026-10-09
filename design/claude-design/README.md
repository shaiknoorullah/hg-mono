# Claude Design snapshot

A pinned, read-only copy of the live design tokens from [Claude Design](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv), the source of truth for tokens and components (AGENTS.md §4).

| File | What |
|---|---|
| `tokens.json` | The live `tokens.json`, normalised to W3C DTCG. Colour primitives are under `color`, themed roles under `theme.light` and `theme.dark`, keyed by their live names. Generated: never edit by hand |
| `VERSION` | The artifact id and the version the snapshot was taken from |
| `parity-allowlist.json` | Differences between this snapshot and `@hg/ui-web` that are held on purpose, each with its reason |

`docs/design/tokens.json` is still the source the generators read. This snapshot is what that file is checked against.

## Refresh the snapshot

```bash
node scripts/design-sync.mjs path/to/live/tokens.json --version <artifact version>
```

The script prints every token whose `{light, dark}` value nests a second `{light, dark}` pair. It keeps the light value from the light pair and the dark value from the dark pair. Each one it prints is a bug to fix in Claude Design. Version `1790874345-9d1d` has 15 of them, all roles that reference another themed role (for example `action-primary-fg` → `text-on-brand`).

## Check the web output against it

```bash
pnpm --filter @hg/ui-web design:parity
```

This resolves every colour in the snapshot and in `packages/ui-web/src/tokens/tokens.css` to a hex for each theme, then prints:

- the differences in the allow-list, with their reasons;
- the live values the web output does not carry yet. These are reported but do not fail the check;
- any other difference. This fails the check (exit 1).

Marketing-only roles (`mk-*`) are left out because they never ship in `@hg/ui-web`. Until after launch, a value that is held back goes in the allow-list instead of into the tokens, because the owner's answer O4 says nothing may change what the released apps show.

## Composition lint

```bash
pnpm --filter @hg/ui-web lint:composition
```

This is step 4 of [#112](https://github.com/shaiknoorullah/hg-mono/issues/112), in warn mode: it prints its findings and always exits 0. It reports:

- new files under `apps/{restaurant,admin}/src/components/`, which are files not in `packages/ui-web/src/lint/composition-baseline.json`;
- raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<a onClick>` in any app's `src/redesign/` folder, and in the new `@hg/ui-web` code under its `src/ds/` and `src/proposed/` folders. Raw elements belong only in `src/lib/`.
