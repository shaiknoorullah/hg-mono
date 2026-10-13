/**
 * `@hg/brand` — the HalalGoes logo as data.
 *
 * One geometry module, drawn by every surface that shows the logo:
 *   - `@hg/ui-web`'s `Wordmark` (restaurant and admin web apps)
 *   - `@hg/ui-native`'s `Wordmark` (customer and rider apps)
 *   - the marketing site's `Wordmark` and its OG card
 *   - `build-assets.mjs`, which writes every favicon and app icon
 *
 * `README.md` in this package has the provenance and the regeneration steps.
 */
export { WORDMARK, BRAND_NAME } from './wordmark-art';
