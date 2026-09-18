import { SITE } from '@/lib/site';

/**
 * Umami, self-hosted, and inert until consent.
 *
 * The tag ships as `type="text/plain"` with the real values on `data-type` and
 * `data-src`, which is Klaro's contextual-consent contract: on consent it swaps
 * the attributes back and the browser fetches the script; on decline it leaves
 * them alone and nothing ever runs. That means the gate is one HTML attribute
 * rather than a race between two bits of client JavaScript — and the failure
 * mode of a broken consent manager is "no analytics", not "analytics anyway".
 *
 * Unconfigured renders nothing at all, rather than a script tag pointing at
 * undefined.
 */
export function Analytics() {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return null;

  return (
    <script
      type="text/plain"
      data-type="text/javascript"
      data-name="umami"
      data-src={src}
      data-website-id={websiteId}
      // Umami ignores events from any other origin, so a preview deploy or a
      // local build cannot pollute production's numbers even if someone sets
      // the env vars there.
      data-domains={new URL(SITE.origin).host}
      defer
    />
  );
}
