/**
 * Runs first (the first import of `main.tsx`): takes an email link's token out of the address
 * before anything else loads or calls the network. See `@hg/ui-web/link-token`, which imports
 * nothing.
 */
import { captureLinkToken } from '@hg/ui-web/link-token';

captureLinkToken(['/verify-email', '/reset-password']);
