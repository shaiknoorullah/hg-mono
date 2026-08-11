/*
 * Jest for @hg/ui-native.
 */
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
