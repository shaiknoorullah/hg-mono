/**
 * The redesign build flag (MASTER-PLAN §0.2). `VITE_HG_REDESIGN` is replaced at build time,
 * so with the flag off Vite folds this to `false` and tree-shakes every redesign module out
 * of the release bundle: the released app is the legacy app, byte for byte in behaviour.
 */
export const REDESIGN_ENABLED: boolean =
  import.meta.env['VITE_HG_REDESIGN'] === '1' || import.meta.env['VITE_HG_REDESIGN'] === 'true';
