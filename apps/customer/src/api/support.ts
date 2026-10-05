/**
 * The support line, from `getPublicConfig` — never hard-coded in a client (contract,
 * `PublicConfig.support_phone_e164`).
 *
 * Support is a phone line during set hours only (owner decision, 1 October): the server turns it
 * off outside them (`support_enabled: false`), so the app never works out opening times itself. It
 * shows `support_hours` as written, and drops "Call support" whenever the line is off.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { unwrap } from '@hg/api-client';

import { api } from './client';

export interface Support {
  /** `tel:` target, present only while the line is open. */
  phoneE164: string | null;
  /** Free text from the server, e.g. "9 am to 9 pm, every day". */
  hours: string | null;
}

export async function getSupport(): Promise<Support> {
  const body = await unwrap(api.GET('/v1/config/public'));
  const c = body.data;
  return {
    phoneE164: c.support_enabled ? (c.support_phone_e164 ?? null) : null,
    hours: c.support_hours ?? null,
  };
}

/**
 * The support line, or `null` until it loads (a failed read offers no line). `enabled: false`
 * skips the read until a screen actually needs the line.
 */
export function useSupport(enabled = true): Support | null {
  const [support, setSupport] = React.useState<Support | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    getSupport()
      .then((s) => live && setSupport(s))
      .catch(() => live && setSupport({ phoneE164: null, hours: null }));
    return () => {
      live = false;
    };
  }, [enabled]);
  return support;
}

export function callSupport(phoneE164: string): void {
  void Linking.openURL(`tel:${phoneE164}`).catch(() => {});
}
