import { makeRouteHandler } from '@keystatic/next/route-handler';
import keystaticConfig from '../../../../../keystatic.config';

/**
 * The editor's backend: reads and writes content, and in GitHub mode runs the
 * OAuth handshake. Disallowed in robots.ts — it is an API, not a page.
 */
export const { POST, GET } = makeRouteHandler({ config: keystaticConfig });
