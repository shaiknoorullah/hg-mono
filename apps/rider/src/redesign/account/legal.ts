/**
 * R05 / R46: where the rider terms and the privacy notice come from.
 *
 * Needs API (rider manifest §5 #35): `PublicConfig` has `terms_version` but no document URLs.
 * Until it does, each document is one build-time config value holding a plain-text URL
 * (`EXPO_PUBLIC_RIDER_TERMS_URL`, `EXPO_PUBLIC_RIDER_PRIVACY_URL`), fetched on open. No legal
 * wording is written into the app: with the value unset, or the address failing, or no text,
 * the screen shows "We couldn't open …" (PA/Legal-Document-Error: "a document with no text is
 * treated as this error").
 */
import type { LegalDoc } from './routes';

export function legalUrl(doc: LegalDoc): string | null {
  // Read on each call (Expo inlines `process.env.EXPO_PUBLIC_*` member reads at build time).
  const url = doc === 'terms' ? process.env.EXPO_PUBLIC_RIDER_TERMS_URL : process.env.EXPO_PUBLIC_RIDER_PRIVACY_URL;
  return url && url.trim() ? url.trim() : null;
}

/** The document as paragraphs (split on blank lines). Throws when it cannot be had. */
export async function legalText(doc: LegalDoc): Promise<string[]> {
  const url = legalUrl(doc);
  if (!url) throw new Error(`no ${doc} document address is configured`);
  const res = await globalThis.fetch(url, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`the ${doc} document answered ${res.status}`);
  return (await res.text())
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
