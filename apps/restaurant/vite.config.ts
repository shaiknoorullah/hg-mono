import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5183,
    host: true,
    fs: {
      allow: [monorepoRoot],
    },
  },
  build: {
    outDir: 'dist',
    // mapbox-gl is ~1.9 MB minified; it is a lazy chunk loaded only when a rider map shows.
    chunkSizeWarningLimit: 2000,
  },
});
