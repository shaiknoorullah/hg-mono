import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The admin console consumes `@hg/ui-web` and `@hg/api-client` as workspace SOURCE
 * (their `main` points at `src/index.ts`, not a build output), so the dev server has to
 * be allowed to serve from the monorepo root — mirrors apps/gallery-web exactly.
 */
const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    host: true,
    fs: {
      // `@hg/ui-web` ships TypeScript source; the workspace packages live outside this app root.
      allow: [monorepoRoot],
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
