/**
 * The contract's route table and the fixture set, loaded once per test file and shared by
 * `mockApi` and `fixture`. Both come from the mock server's own modules
 * (`tools/mock-server/src/{routes,fixtures}.ts`), so a screen test and `pnpm mock` cannot
 * disagree about which operation a path is or what a scenario contains.
 * Test-only: never import this from app code (it reads files from disk).
 *
 * Why the loading dance: `fixtures.ts` finds the repository with
 * `fileURLToPath(new URL('.', import.meta.url))`. Under the jsdom environment Vite transforms
 * modules for the web and rewrites that expression to an `/@fs/...` URL against
 * `self.location` (`http://localhost:3000`), which `fileURLToPath` rejects. So `fixtures.ts`
 * (no relative imports, only `node:*`) is loaded by Node's `require` itself, untransformed, and handed to
 * `routes.ts` through `vi.doMock`.
 */
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

import type * as FixturesModule from '../../../../../tools/mock-server/src/fixtures';
import type * as RoutesModule from '../../../../../tools/mock-server/src/routes';
import type { Route } from '../../../../../tools/mock-server/src/routes';

const FIXTURES_SPECIFIER = '../../../../../tools/mock-server/src/fixtures';
const FIXTURES_FILE = resolve(dirname(fileURLToPath(import.meta.url)), `${FIXTURES_SPECIFIER}.ts`);

// Node's own `require` (which loads an ES module synchronously and strips its types) is not
// routed through Vite, unlike `import()`.
const fixturesModule = createRequire(import.meta.url)(FIXTURES_FILE) as typeof FixturesModule;
vi.doMock(FIXTURES_SPECIFIER, () => fixturesModule);
const routesModule: typeof RoutesModule = await import('../../../../../tools/mock-server/src/routes');
vi.doUnmock(FIXTURES_SPECIFIER);

let store: FixturesModule.FixtureStore | null = null;
let routes: Route[] | null = null;

export function fixtureStore(): FixturesModule.FixtureStore {
  store ??= new fixturesModule.FixtureStore();
  return store;
}

export function contractRoutes(): Route[] {
  routes ??= routesModule.loadRoutes().routes;
  return routes;
}

export type { Route };
