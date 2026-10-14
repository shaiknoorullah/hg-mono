/**
 * NativeWind 4 / Tailwind 3 for the customer app (redesign, N0).
 *
 * Every colour, space, radius and type utility comes from the generated preset
 * (`packages/ui-native/src/tokens/generated/nativewind-preset.cjs`); the app adds nothing.
 * `content` covers this app and @hg/ui-native's source, which Metro compiles in place.
 */
const path = require('path');

module.exports = {
  content: [
    path.join(__dirname, 'App.tsx'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
    path.join(__dirname, '../../packages/ui-native/src/**/*.{ts,tsx}'),
  ],
  presets: [require('nativewind/preset'), require('@hg/ui-native/preset')],
};
