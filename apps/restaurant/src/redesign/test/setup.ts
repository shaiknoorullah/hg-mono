/**
 * Runs before every test file. The app loads its release notes in the background and, on a device
 * that has not seen them, opens What's new by itself; every other test would find a panel it did
 * not ask for. So the notes stay "loading" here until a test (the What's new tests) supplies its own.
 */
import { beforeEach } from 'vitest';

import { resetWhatsNew, setReleaseNotesLoader } from '../whatsnew/store';

beforeEach(() => {
  setReleaseNotesLoader(() => new Promise(() => undefined));
  resetWhatsNew();
});
