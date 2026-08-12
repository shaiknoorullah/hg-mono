import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One smoke test: the queue screen mounts, resolves the mocked GET, and renders real
 * rows through @hg/ui-web's DataTable. A console that silently fails to render is worse
 * than no console; this catches it in a second.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['smoke/**/*.test.tsx'],
  },
});
