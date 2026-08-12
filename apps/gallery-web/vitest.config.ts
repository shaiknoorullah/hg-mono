import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One test, deliberately: every section mounts, produces real content, and logs no console
 * error the gallery did not ask for. The gallery has no logic of its own worth unit-testing
 * — but a review surface that silently fails to render is worse than no review surface, and
 * this catches that in a second.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['smoke/**/*.test.tsx'],
  },
});
