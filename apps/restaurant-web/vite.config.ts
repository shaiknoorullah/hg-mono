import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The restaurant app consumes `@hg/ui-web` as workspace source (the package's `main`
 * points at `src/index.ts`, not a build output), so the dev server has to be allowed to
 * serve files from above this app's directory.
 */
const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    host: true,
    fs: {
      // `@hg/ui-web` ships TypeScript source that lives outside this app root.
      allow: [monorepoRoot],
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
});
