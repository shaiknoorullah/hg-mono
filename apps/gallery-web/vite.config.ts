import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The gallery is a composition-only app: it imports `@hg/ui-web` as workspace source
 * (the package's `main` points at `src/index.ts`, not a build output) and reads the
 * contract fixtures straight off disk. Both live above this directory, so the dev
 * server has to be allowed to serve from the monorepo root.
 */
const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    host: true,
    fs: {
      // `@hg/ui-web` ships TypeScript source and the fixtures are outside the app root.
      allow: [monorepoRoot],
    },
  },
  build: {
    outDir: 'dist',
    // Nothing here is code-split: the whole point is that one page shows everything.
    chunkSizeWarningLimit: 2000,
  },
});
