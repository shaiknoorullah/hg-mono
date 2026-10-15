/**
 * `PublicConfig`, read once and shared: support line and hours, tip limit, quote lifetime,
 * restaurant response window, served provinces.
 *
 * Support is a phone line during set hours (owner decision, 1 Oct). The server turns it off outside
 * them (`support_enabled: false`); the app never works out opening times and shows `support_hours`
 * as written (manifest global rule 7). Ported from #635 `api/support.ts`.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type PublicConfig = Schema['PublicConfig'];

let cached: Promise<PublicConfig> | null = null;

export function getPublicConfig(): Promise<PublicConfig> {
  cached ??= unwrap(api.GET('/v1/config/public'))
    .then((body) => body.data as PublicConfig)
    .catch((e: unknown) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** Tests only. */
export function resetPublicConfigCache(): void {
  cached = null;
}

export type Support =
  /** The line is open: "Call support" with these hours. */
  | { kind: 'open'; phoneE164: string; hours: string | null }
  /** Closed now, with hours to say when it opens. */
  | { kind: 'closed'; hours: string }
  /** No line at all (or the config could not be read). */
  | { kind: 'unavailable' };

export function supportFrom(config: PublicConfig | null): Support {
  if (!config) return { kind: 'unavailable' };
  if (config.support_enabled && config.support_phone_e164) {
    return { kind: 'open', phoneE164: config.support_phone_e164, hours: config.support_hours ?? null };
  }
  if (config.support_hours) return { kind: 'closed', hours: config.support_hours };
  return { kind: 'unavailable' };
}

/** The support line, or `null` while it loads. A failed read is "unavailable", never a guess. */
export function useSupport(): Support | null {
  const [support, setSupport] = React.useState<Support | null>(null);
  React.useEffect(() => {
    let live = true;
    getPublicConfig()
      .then((c) => live && setSupport(supportFrom(c)))
      .catch(() => live && setSupport({ kind: 'unavailable' }));
    return () => {
      live = false;
    };
  }, []);
  return support;
}

export function callSupport(phoneE164: string): void {
  void Linking.openURL(`tel:${phoneE164}`).catch(() => {});
}
