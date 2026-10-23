/**
 * The capture entry, present only in a build made with `EXPO_PUBLIC_HG_CAPTURE=1`.
 *
 * The test is the literal env expression, as in `index.js` for the redesign flag: Expo inlines it
 * and the bundler drops the dead `require`, so a build without the flag contains none of
 * `./entry`. A release bundle is checked for that (scripts/release/redesign-off.cjs, and the
 * `apk` job in .github/workflows/e2e.yml).
 */
export const captureEntry: typeof import('./entry') | null =
  process.env.EXPO_PUBLIC_HG_CAPTURE === '1' ? (require('./entry') as typeof import('./entry')) : null;
