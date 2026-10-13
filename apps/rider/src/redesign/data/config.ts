/**
 * `PublicConfig` (support phone, hours) and the support helpers every rider board uses.
 *
 * Support is never hardcoded (contract: "Never hardcoded in a client"). When `support_enabled`
 * is false or no number is set, `supportPhone` is null and screens show their `*-NoSupport`
 * board: the "Call support" button is hidden, not disabled.
 */
import { Linking } from 'react-native';
import { unwrap, type Schema } from '@hg/api-client';

import { rider } from './client';
import { useApiQuery, type QueryResult } from './query';

export type PublicConfig = Schema['PublicConfig'];

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const body = await unwrap(rider.GET('/v1/config/public'));
  return (body as { data: PublicConfig }).data;
}

/** Read once per mount and on foreground; cheap and cacheable server-side. */
export function usePublicConfig(): QueryResult<PublicConfig> {
  return useApiQuery('public-config', fetchPublicConfig);
}

export interface Support {
  /** E.164, or null when support is off / not configured. */
  phone: string | null;
  hours: string | null;
  /** Email support (#312 adds `support_email`); null until the contract carries it. */
  email: string | null;
}

export function supportFrom(config: PublicConfig | undefined): Support {
  if (!config || !config.support_enabled) return { phone: null, hours: null, email: null };
  const email = (config as PublicConfig & { support_email?: string | null }).support_email ?? null;
  return { phone: config.support_phone_e164 ?? null, hours: config.support_hours ?? null, email };
}

export function useSupport(): Support {
  return supportFrom(usePublicConfig().data);
}

/** Opens the dialler. Returns false when there is no number to call. */
export function callSupport(support: Support): boolean {
  if (!support.phone) return false;
  void Linking.openURL(`tel:${support.phone}`);
  return true;
}
