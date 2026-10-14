/*
 * Compiles a theme's NativeWind stylesheet for a jest test of the className tier.
 *
 * Metro does this in an app (`withHgNativeWind` in build-config.cjs). Jest has no CSS pipeline,
 * so a test that asserts on `className` styles calls `compileThemeCss` once and registers the
 * result with react-native-css-interop's test runtime (`registerCSS`). Same chain as the app:
 * generated `global.<theme>.css` -> Tailwind 3 with NativeWind's preset and ours -> css-interop.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NATIVEWIND_DIR = fs.realpathSync(path.join(ROOT, 'node_modules/nativewind'));
/** The css-interop copy NativeWind's JSX runtime uses; jest maps every import onto it. */
const CSS_INTEROP_DIR = path.dirname(
  require.resolve('react-native-css-interop/package.json', { paths: [NATIVEWIND_DIR] }),
);

/**
 * @param {'customer' | 'rider'} theme which generated `global.<theme>.css` to compile
 * @param {string[]} [content] files whose classNames to generate (default: the whole lib tier)
 * @returns {Promise<{ css: string, options: object }>}
 */
async function compileThemeCss(theme, content = [path.join(ROOT, 'src/lib/**/*.tsx')]) {
  // NativeWind's preset emits its native-only at-rules only when it knows the platform.
  process.env.NATIVEWIND_OS = process.env.NATIVEWIND_OS || 'android';
  const input = path.join(ROOT, `src/tokens/generated/global.${theme}.css`);
  const tailwindDir = fs.realpathSync(path.join(ROOT, 'node_modules/tailwindcss'));
  const postcss = require(path.join(tailwindDir, '../postcss'));
  const tailwind = require(tailwindDir);
  const config = {
    content,
    presets: [
      require(path.join(NATIVEWIND_DIR, 'preset')),
      require('./src/tokens/generated/nativewind-preset.cjs'),
    ],
  };
  const result = await postcss([tailwind(config)]).process(fs.readFileSync(input, 'utf8'), { from: input });
  return {
    css: result.css,
    // What withNativeWind hands the compiler (build-config.cjs sets inlineRem 16).
    options: {
      inlineRem: 16,
      ...require(path.join(NATIVEWIND_DIR, 'dist/metro/common')).cssToReactNativeRuntimeOptions,
    },
  };
}

module.exports = { compileThemeCss, CSS_INTEROP_DIR };
