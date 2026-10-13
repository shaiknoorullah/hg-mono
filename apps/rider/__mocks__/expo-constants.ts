/**
 * Test double for `expo-constants`: Jest has no native module registry. The config `src/push.ts`
 * reads, with an EAS project id so the push path runs; tests change it as they need.
 */
const Constants: {
  expoConfig: { version?: string; extra?: { eas?: { projectId?: string } } } | null;
  easConfig: { projectId?: string } | null;
} = {
  expoConfig: { version: '0.0.0', extra: { eas: { projectId: 'test-project' } } },
  easConfig: null,
};

export default Constants;
