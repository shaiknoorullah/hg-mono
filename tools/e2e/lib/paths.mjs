// Where things are, whatever directory a script or test runs from: the repository root, and the
// run's output folder ($E2E_OUT, by default e2e-out/ at the root) with world.json, screenshots,
// reports and logs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : path.join(ROOT, 'e2e-out');
