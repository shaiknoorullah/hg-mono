/*
 * Jest for @hg/rider. Mirrors apps/customer/jest.config.cjs and packages/ui-native's own
 * config: this app consumes @hg/ui-native and @hg/api-client as TypeScript source (their
 * `main` is `src/index.ts`), and @hg/api-client re-exports its own siblings with an explicit
 * `.js` extension the CJS resolver cannot follow against a `.ts` file on disk.
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
    /*
     * Same duplicate-copy problem as react-native/react above, now that this app pulls
     * `react-native-svg` directly (for @hg/ui-native's `Icon`) alongside the copy nativewind's
     * dependency chain resolves for @hg/ui-native's own devDependency: two peer-hash directories,
     * two native-module registries. Pin to this app's copy.
     */
    '^react-native-svg$': require.resolve('react-native-svg'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/)?(?:@?react-native|@react-native-community|@testing-library|expo|@expo|nativewind))',
  ],
};
