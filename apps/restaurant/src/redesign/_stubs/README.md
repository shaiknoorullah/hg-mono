# Temporary design-system stubs

Composites the design system has not shipped yet (SESSION-BRIEF: "use a clearly-named
temporary stub inside your redesign folder only if the DS track has not shipped it yet").

Each file names the `ds-request(web):` issue that asks for the real component, follows the
props the canvas's Proposed-components board draws, and is deleted the day `@hg/ui-web/ds`
or `/proposed` exports it (the import in `../ds.ts` switches; screens do not change).

Screens never import from here directly: they import from `../ds.ts`.
