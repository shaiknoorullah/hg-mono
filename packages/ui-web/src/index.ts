/**
 * `@hg/ui-web` — the web component library for the two `operational` surfaces
 * (restaurant queue and admin), built against `docs/design/*`.
 *
 * Each tier owns a barrel and is also importable directly (`@hg/ui-web/data`),
 * which is the preferred form in app code: it keeps the import graph honest
 * about what a screen actually depends on.
 *
 * Tiers, in dependency order — foundation first, because everything above it
 * consumes the tokens and the primitives:
 *
 *   ./tokens         generated from docs/design/tokens.json (foundation)
 *   ./primitives     Tier 1 of 02-components.md (foundation)
 *   ./certification  Tier 2 ★ — the product
 *   ./content        Tier 3
 *   ./navigation     Tier 4
 *   ./feedback       Tier 5
 *   ./data           admin data display
 *
 * The stylesheet is not re-exported. Import it once, in the app:
 *   import '@hg/ui-web/styles.css';
 */

export * from './tokens/index.js';
export * from './primitives/index.js';
export * from './certification/index.js';
export * from './content/index.js';
export * from './navigation/index.js';
export * from './feedback/index.js';
export * from './data/index.js';
