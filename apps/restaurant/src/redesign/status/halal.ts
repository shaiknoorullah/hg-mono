/**
 * Halal on the console (LO `Board-cert-*`; wp4 spec §7): what the status bar's HalalBadge and
 * the page banner show for `getRestaurantProfile.halal` and the HALAL_CERTIFICATE document row.
 *
 * Rules that must not bend (AGENTS.md §3 invariants 8–10):
 * - `halal` missing → no badge, no divider, no banner, and the absence is reported;
 * - UNVERIFIED (being checked, or the certificate was not accepted) → no HalalBadge at all;
 * - EXPIRED is cool slate ("we can't currently vouch"), never danger or red;
 * - no tone here is ever `danger`.
 */
import type { Schema } from '@hg/api-client';
import { formatCalendarDate } from '../format/time';

export type HalalBadgeData = Schema['HalalBadge'];
export type KycDocument = Schema['KycDocument'];

export type HalalBannerTone = 'expiring' | 'expired' | 'unverified';

export interface HalalBannerView {
  tone: HalalBannerTone;
  role: 'status' | 'alert';
  icon: 'clock' | 'info';
  title: string;
  body: string;
  action: { label: string; href: string } | null;
}

export interface HalalConsoleView {
  /** The HalalBadge state to draw in the status bar, or null for none (and no divider). */
  badge: 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  banner: HalalBannerView | null;
  /** The field is missing: report `HALAL_DISPLAY_STATE_MISSING`. */
  missing: boolean;
  /** Customers can't order because of the certificate (switch help on a halal suspension). */
  blocksOrdering: boolean;
}

const RENEW_HREF = '/settings?panel=renew';

/** The current HALAL_CERTIFICATE row (the server returns one non-superseded row per type). */
export function halalCertificateRow(docs: readonly KycDocument[] | null | undefined): KycDocument | null {
  return docs?.find((d) => d.doc_type === 'HALAL_CERTIFICATE' && d.state !== 'SUPERSEDED') ?? null;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function halalConsoleView(halal: HalalBadgeData | null | undefined, certificate: KycDocument | null): HalalConsoleView {
  const state = halal?.display_state;
  switch (state) {
    case 'CERTIFIED':
      return { badge: 'CERTIFIED', banner: null, missing: false, blocksOrdering: false };
    case 'EXPIRING_SOON': {
      const on = halal?.expires_on ? formatCalendarDate(halal.expires_on, 'long') : null;
      return {
        badge: 'EXPIRING_SOON',
        missing: false,
        blocksOrdering: false,
        banner: {
          tone: 'expiring',
          role: 'status',
          icon: 'clock',
          title: on ? `Your halal certificate expires on ${on}` : 'Your halal certificate expires soon',
          body: 'Upload the renewed certificate before then. We check it before it goes live, so customers can keep ordering without a gap. We remind you 30, 14, 7 and 1 days before it expires.',
          action: { label: 'Upload renewal', href: RENEW_HREF },
        },
      };
    }
    case 'EXPIRED': {
      const on = halal?.expires_on ? formatCalendarDate(halal.expires_on, 'long') : null;
      return {
        badge: 'EXPIRED',
        missing: false,
        blocksOrdering: true,
        banner: {
          tone: 'expired',
          role: 'status',
          icon: 'info',
          title: 'We can’t currently vouch for your halal certificate',
          body: `${on ? `It expired on ${on}, so customers` : 'It has expired, so customers'} can’t find or order from you. Orders already in progress can be finished. Upload the renewed certificate; we review documents within 3 business days.`,
          action: { label: 'Upload renewal', href: RENEW_HREF },
        },
      };
    }
    case 'UNVERIFIED': {
      if (certificate?.state === 'REJECTED') {
        // Rejection reason: Needs API (structured); the row's review_note verbatim meanwhile.
        const note = certificate.review_note?.trim();
        return {
          badge: null,
          missing: false,
          blocksOrdering: true,
          banner: {
            tone: 'unverified',
            role: 'alert',
            icon: 'info',
            title: 'Your certificate wasn’t accepted',
            body: `${note ? `Reason from HalalGoes: ${sentence(note)} ` : ''}Customers can’t find you until a valid certificate is approved. Orders already in progress can be finished.`,
            action: { label: 'Upload a new certificate', href: RENEW_HREF },
          },
        };
      }
      return {
        badge: null,
        missing: false,
        blocksOrdering: true,
        banner: {
          tone: 'unverified',
          role: 'status',
          icon: 'clock',
          title: 'We’re checking your certificate',
          body: 'We review documents within 3 business days. Customers can’t find you until it’s approved; we’ll tell you as soon as it is.',
          action: null,
        },
      };
    }
    default:
      // Absent or unrecognised: silence is never consent on a halal claim (invariant 8).
      return { badge: null, banner: null, missing: true, blocksOrdering: false };
  }
}
