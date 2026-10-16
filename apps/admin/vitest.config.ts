import { defineConfig } from 'vitest/config';

import { forkPool } from '../../vitest.shared';
import react from '@vitejs/plugin-react';

/**
 * One smoke test: the queue screen mounts, resolves the mocked GET, and renders real
 * rows through @hg/ui-web's DataTable. A console that silently fails to render is worse
 * than no console; this catches it in a second.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    ...forkPool(),
    environment: 'jsdom',
    globals: false,
    include: ['smoke/**/*.test.tsx', 'src/redesign/**/__tests__/**/*.test.{ts,tsx}'],
    env: { TZ: 'America/Toronto' },
    testTimeout: 15000,
  },
});
