/**
 * Runs first (the first import of `main.tsx`): takes an email link's token out of the address
 * before anything else loads or calls the network, mapbox-gl's import included. See
 * `lib/linkToken.ts`.
 */
import { captureLinkToken } from './lib/linkToken';

/** The admin pages an email links to: the public-route list in `App.tsx`. */
export const LINK_PATHS = ['/reset-password', '/accept-invite'] as const;

captureLinkToken(LINK_PATHS);
