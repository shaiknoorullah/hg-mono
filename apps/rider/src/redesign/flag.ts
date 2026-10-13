/**
 * The redesign flag (MASTER-PLAN §0.2). Off in every release build (`release-builds.yml` never
 * sets it), on in the redesign dev APK and the redesign e2e runs.
 *
 * Written as the plain `process.env.EXPO_PUBLIC_HG_REDESIGN` expression on purpose: Expo inlines
 * exactly that expression at build time (see `src/api.ts` for the optional-chaining trap).
 */
export const REDESIGN_ENABLED = process.env.EXPO_PUBLIC_HG_REDESIGN === '1';
