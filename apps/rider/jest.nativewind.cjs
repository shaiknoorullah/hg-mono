/*
 * Compiles the rider app's NativeWind stylesheet for a jest test (redesign, N0).
 *
 * Metro does this in the app (`withNativeWind` in metro.config.js). Jest has no CSS pipeline,
 * so a test that asserts on `className` styles calls this once and registers the result with
 * react-native-css-interop's test runtime. Plain CJS, outside the TypeScript program, because
 * the app's tsconfig carries no Node types.
 */
const fs = require('fs');
const path = require('path');

const APP_ROOT = __dirname;
const GLOBAL_CSS = path.resolve(
  APP_ROOT,
  '../../packages/ui-native/src/tokens/generated/global.rider.css',
);

/**
 * @param {string[]} content files whose classNames to generate (scanning every source file is
 *   the app build's job, not a unit test's)
 * @returns {Promise<{ css: string, options: object }>}
 */
async function compileRiderCss(content) {
  // NativeWind's Tailwind preset emits its native-only at-rules (`@cssInterop set darkMode
  // class dark`) only when it knows it is compiling for a native platform; Metro sets this.
  process.env.NATIVEWIND_OS = process.env.NATIVEWIND_OS || 'android';
  const tailwindDir = fs.realpathSync(path.join(APP_ROOT, 'node_modules/tailwindcss'));
  // postcss is tailwindcss's own dependency (its sibling in pnpm's store); use that copy.
  const postcss = require(path.join(tailwindDir, '../postcss'));
  const tailwind = require(tailwindDir);
  const config = require('./tailwind.config.js');
  const result = await postcss([tailwind({ ...config, content })]).process(
    fs.readFileSync(GLOBAL_CSS, 'utf8'),
    { from: GLOBAL_CSS },
  );
  return {
    css: result.css,
    // The same options withNativeWind hands the compiler (metro.config.js sets inlineRem 16).
    options: {
      inlineRem: 16,
      ...require('nativewind/dist/metro/common').cssToReactNativeRuntimeOptions,
    },
  };
}

module.exports = { compileRiderCss, UI_NATIVE_LIB: path.resolve(APP_ROOT, '../../packages/ui-native/src/lib') };
