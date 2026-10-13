import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // components.json's shadcn aliases (`@hg/ui-web/lib/utils`), without a self-install.
  resolve: { alias: [{ find: /^@hg\/ui-web\/lib\//, replacement: `${here('./src/lib')}/` }] },
  test: {
    globals: true,
    environment: 'jsdom',
    // jsdom lacks ResizeObserver / pointer capture, which every Radix floating
    // primitive calls on open. Without this the keyboard tests are not trustworthy.
    setupFiles: [here('./src/test-setup.ts')],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
