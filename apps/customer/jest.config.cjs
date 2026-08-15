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
