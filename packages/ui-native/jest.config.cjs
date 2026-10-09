/*
 * Jest for @hg/ui-native.
 */
const { CSS_INTEROP_DIR } = require('./jest.nativewind.cjs');

module.exports = {
  preset: 'react-native',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    /*
     * `@hg/api-client` is an ESM source package: it imports its own siblings as `./client.js`
     * while the file on disk is `client.ts`. Metro and tsc both resolve that; jest's CJS
     * resolver does not.
     */
    '^(\\.{1,2}/.*)\\.js$': '$1',
    /*
     * The className tier (src/lib) compiles through NativeWind, whose JSX runtime resolves
     * react-native-css-interop beside itself. A test that registers a stylesheet must reach that
     * same copy, so every import of it is pinned there (jest.nativewind.cjs).
     */
    '^react-native-css-interop(/.*)?$': `${CSS_INTEROP_DIR}$1`,
    /*
     * css-interop's `/test` runtime re-exports @testing-library/react-native, which pnpm can
     * resolve against a second peer-hash copy of react-native / react: two native-module
     * registries, only one set up by the preset (role queries then crash in StyleSheet). Pin both
     * to this package's copy, as apps/rider/jest.config.cjs and Metro's singleton list do.
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
    'node_modules/(?!(?:\\.pnpm/)?(?:@?react-native|@react-native-community|@testing-library|expo|@expo|nativewind|@rn-primitives))',
  ],
};
