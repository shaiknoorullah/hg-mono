/**
 * The single `@hg/api-client` instance for the rider app.
 *
 * Base URL defaults to the local mock (`http://localhost:4010/v1`, Prism against
 * `contracts/openapi.yaml`). Override with EXPO_PUBLIC_API_BASE_URL for a real backend.
 * `clientSurface: 'rider-app'` is what the contract's force-upgrade / role checks key off.
 */
import { createHgClient } from '@hg/api-client';

const DEFAULT_BASE_URL = 'http://localhost:4010';

export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL) || DEFAULT_BASE_URL;

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  clientSurface: 'rider-app',
  clientVersion: '0.0.0',
});
