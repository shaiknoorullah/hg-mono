import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One smoke test: the dashboard mounts, drives its states (loading, then the fetched
 * queue), and logs no unexpected console error. A dashboard that silently fails to render
 * is worse than none, and this catches that in a second.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['smoke/**/*.test.tsx'],
  },
});
