/**
 * Runs first (the first import of `main.tsx`): takes an email link's token out of the address
 * before anything else loads or calls the network. See `lib/linkToken.ts`.
 */
import { captureLinkToken } from './lib/linkToken';

captureLinkToken(['/verify-email', '/reset-password']);
