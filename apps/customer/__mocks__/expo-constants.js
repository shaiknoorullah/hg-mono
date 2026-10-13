/**
 * Manual Jest mock for `expo-constants` (native module registry, as above). Carries an EAS project
 * id so `src/api/push.ts` goes as far as asking for permission.
 */
module.exports = {
  __esModule: true,
  default: {
    expoConfig: { version: '0.0.0', extra: { eas: { projectId: 'jest-project' } } },
    easConfig: null,
  },
};
