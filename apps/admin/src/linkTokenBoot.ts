/**
 * Runs first (the first import of `main.tsx`): takes an email link's token out of the address
 * before anything else loads or calls the network, mapbox-gl's import included. See
 * `@hg/ui-web/link-token`, which imports nothing.
 */
import { captureLinkToken } from '@hg/ui-web/link-token';

/** The admin pages an email links to: the public-route list in `App.tsx`. */
export const LINK_PATHS = ['/reset-password', '/accept-invite'] as const;

captureLinkToken(LINK_PATHS);
