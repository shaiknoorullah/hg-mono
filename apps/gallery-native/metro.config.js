/* eslint-env node */
/**
 * Metro for a pnpm workspace, plus one deliberate stub.
 *
 * 1. `watchFolders` + `nodeModulesPaths` point at the monorepo root so `@hg/ui-native` and
 *    `@hg/api-client` are consumed as TypeScript source (their `main` is `src/index.ts`) rather
 *    than as a build artefact that does not exist.
 *
 * 2. `react-native-maps` is an *optional* peer of `@hg/ui-native`. `feedback/internal/maps.ts`
 *    resolves it inside a try/catch at render time so a host without it degrades to the text
 *    panel — but Metro resolves the literal string statically at bundle time and would fail the
 *    build before that try/catch ever runs. The stub below makes the require succeed and return
 *    nothing usable, which is the input `resolveNativeMaps()` is written to handle. Result:
 *    `MapView` renders its designed "Map unavailable" + text-panel fallback instead of crashing
 *    the page. See the Map row in the Feedback section of the gallery.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

const MAPS_STUB = path.resolve(projectRoot, 'shims/react-native-maps.js');
const CLIPBOARD_SHIM = path.resolve(projectRoot, 'shims/clipboard.ts');
const A11Y_SHIM = path.resolve(projectRoot, 'shims/a11y.ts');
const UI_NATIVE_SRC = path.resolve(monorepoRoot, 'packages/ui-native/src');

/**
 * Modules inside `@hg/ui-native` that cannot run under react-native-web as written, mapped to a
 * host-side adapter with the same export contract. Both are documented in `shims/` and in the
 * gallery README; neither changes a component's behaviour, and neither is applied on native.
 */
const WEB_SHIMS = [
  { match: /(^|\/)internal\/clipboard$/, filePath: CLIPBOARD_SHIM },
  { match: /(^|\/)internal\/a11y$/, filePath: A11Y_SHIM },
];

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: MAPS_STUB };
  }

  /**
   * 2b. Two internals of `@hg/ui-native` do not survive a web bundle as written:
   *
   *     - `feedback/internal/clipboard.ts` resolves `expo-clipboard` through `require(name)` with
   *       a *variable* argument, which Metro's dependency collector rejects at transform time —
   *       before that module's own try/catch can degrade;
   *     - `feedback/internal/a11y.ts` calls `findNodeHandle()`, which react-native-web throws
   *       from, out of an effect, which unmounts the tree.
   *
   *     Both are redirected to an adapter with the same export contract rather than edited in the
   *     library, which this app does not own. Native builds are unaffected: pass `platform` here
   *     if you ever want the real modules back on iOS/Android.
   */
  if (typeof context.originModulePath === 'string' && context.originModulePath.startsWith(UI_NATIVE_SRC)) {
    for (const shim of WEB_SHIMS) {
      if (shim.match.test(moduleName)) {
        return { type: 'sourceFile', filePath: shim.filePath };
      }
    }
  }

  const resolve = upstreamResolveRequest ?? context.resolveRequest;

  /**
   * 3. `@hg/api-client` is authored for NodeNext and writes `export * from './client.js'`
   *    against a file that is actually `client.ts`. TypeScript remaps that extension; Metro
   *    does not. Rather than edit a package this app does not own, fall back to the
   *    extensionless specifier when the literal `.js` path does not exist.
   */
  if (/^\.\.?\//.test(moduleName) && /\.jsx?$/.test(moduleName)) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.replace(/\.jsx?$/, ''), platform);
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
