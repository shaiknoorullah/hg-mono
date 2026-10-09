import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * The design preview: every `src/**\/*.preview.tsx` specimen on one page, for
 * people and for preview/shoot.mjs. Not a Storybook; no addons, no build.
 *
 *   pnpm --filter @hg/ui-web preview          → http://localhost:6106
 */
export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  resolve: {
    // The shadcn aliases in components.json, resolved without a self-install.
    alias: [{ find: /^@hg\/ui-web\/lib\//, replacement: `${here('../src/lib')}/` }],
  },
  server: { port: 6106, strictPort: true, fs: { allow: [here('..'), here('../../..')] } },
  preview: { port: 6106, strictPort: true },
});
