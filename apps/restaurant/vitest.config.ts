import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * A small, high-value smoke net (AGENTS.md §6: "few and high-value"), salvaged from the
 * abandoned `apps/restaurant-web` stub and adapted to this app's real routes and auth model:
 * the sign-in gate (deny by default), the live order queue's loading/empty/error states, and
 * the accept-order transition (capture-on-accept, idempotency key attached).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['smoke/**/*.test.tsx'],
    testTimeout: 15000,
  },
});
