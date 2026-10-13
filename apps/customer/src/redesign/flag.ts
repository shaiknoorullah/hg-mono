/**
 * The redesign build flag (MASTER-PLAN §0.2).
 *
 * `EXPO_PUBLIC_HG_REDESIGN` is inlined by Expo at build time. It is off in `release-builds.yml`, so
 * a release build never mounts anything under `src/redesign/`: `index.js` picks the legacy `App`
 * before any redesign module is evaluated.
 */
export function isRedesignEnabled(value: string | undefined = process.env.EXPO_PUBLIC_HG_REDESIGN): boolean {
  return value === '1' || value === 'true';
}
