/**
 * Runs before every redesign test file. The console loads its release notes in the background
 * and shows an update notice on a device that has not seen them; every other test would find a
 * banner it did not ask for. So the notes stay "loading" here until a test (the What's new
 * tests) supplies its own.
 */
import { beforeEach } from 'vitest';

import { resetWhatsNew, setReleaseNotesLoader } from '../whatsnew/store';

beforeEach(() => {
  setReleaseNotesLoader(() => new Promise(() => undefined));
  resetWhatsNew();
});
