/*
 * Jest for @hg/customer. Mirrors packages/ui-native/jest.config.cjs: this app consumes
 * @hg/ui-native and @hg/api-client as TypeScript source (their `main` is `src/index.ts`), and
 * @hg/api-client re-exports its own siblings with an explicit `.js` extension the CJS resolver
 * cannot follow against a `.ts` file on disk.
 */
module.exports = {
  preset: 'react-native',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Preloads react-native's lazy component getters outside any test's timeout; see the file.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    /*
     * pnpm resolves more than one physical copy of `react-native` / `react` under different
     * peer-hash directories (one reached via this app's own deps, another via @hg/ui-native's
     * workspace-source require chain). Two copies means two independent native-module
     * registries — only the one the preset's `setupFiles` patches is safe to call
     * `StyleSheet.create` against. Pin both to this app's copy, mirroring the Metro
     * SINGLETONS resolver in metro.config.js.
     */
    '^react-native$': require.resolve('react-native'),
    '^react$': require.resolve('react'),
    /*
     * Same duplicate-physical-copy problem as react-native/react above, one layer down:
     * `@hg/ui-native`'s `Icon` primitive imports `react-native-svg`, which pnpm's peer-hash
     * virtual store resolves under its OWN nested `react-native` copy — a copy the preset's
     * `setupFiles` never patched with the RN test-environment's `NativeModules` mock, so
     * `codegenNativeComponent` (Fabric-generated `Circle`/`Path`/etc.) throws
     * "__fbBatchedBridgeConfig is not set" the first time it resolves a native component.
     * Pinning the specifier to this app's own resolution collapses it back to the one copy
     * jest's preset already initialised.
     */
    '^react-native-svg$': require.resolve('react-native-svg'),
  },
  /*
   * pnpm stores real packages under `node_modules/.pnpm/<name>@<version>/node_modules/<name>`, so
   * the usual `node_modules/(?!react-native/)` pattern never matches. Matching the package name
   * without a trailing slash covers both the store path and the symlinked one.
   */
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?(?:@?react-native|@react-native-community|@testing-library|expo|@expo|nativewind))',
  ],
};
