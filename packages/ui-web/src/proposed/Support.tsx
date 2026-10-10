/**
 * `SupportBlock` and `SupportSentence` — partner support on the restaurant sign-in boards
 * (proposed, #737; SI `SignIn-LockedPermanent`, `-Suspended`, `-NotActive`, `-TooMany`,
 * `Ref-SupportUnavailable`).
 *
 * Nothing about support renders unless `PublicConfig.support_enabled` is true. The phone and
 * hours come from the public config and are never hardcoded; when support is off they are
 * absent, and even if a caller passes them they are not shown. A missing flag is not consent,
 * the same rule as a missing halal field:
 * - `supportEnabled` undefined (config still loading, or `loading`): SupportBlock shows a
 *   placeholder that names no number; SupportSentence renders nothing.
 * - `supportEnabled` false, or true without a phone: SupportBlock shows the "Partner support
 *   isn't available right now" replacement (or nothing, with `unavailable="none"`);
 *   SupportSentence shows `fallback`, or nothing.
 * - `supportEnabled` true with a phone: the block (label, the phone as a `tel:` link with a
 *   44px target, hours) or the sentence ("Need help signing in? Call partner support on
 *   <phone>, <hours>.").
 *
 * True with no phone is a config fault, reported as `SUPPORT_PHONE_MISSING`.
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react';

import { reportDsClientError } from '../ds/client-error.js';
import { cn } from '../lib/utils.js';
import { Skeleton } from './Skeleton.js';
import { TextLink } from './TextLink.js';

/** The three PublicConfig fields partner support reads (contract `PublicConfig`). */
export interface SupportConfig {
  support_enabled?: boolean | null;
  support_phone_e164?: string | null;
  support_hours?: string | null;
}

/** What both support components take: the flag, the phone and the hours, or the config. */
export interface SupportSource {
  /** `PublicConfig.support_enabled`. Undefined while the config loads. */
  supportEnabled?: boolean | null;
  /** `PublicConfig.support_phone_e164`, e.g. "+18005550199". */
  phoneE164?: string | null;
  /** How the number is shown; defaults to `formatSupportPhone(phoneE164)`. */
  phoneDisplay?: string;
  /** `PublicConfig.support_hours`, shown as given. */
  hours?: string | null;
  /** The public config itself; the separate props above win over it. */
  config?: SupportConfig | null;
}

/** Props of the proposed `SupportBlock` (#737). */
export interface SupportBlockProps extends SupportSource {
  /** The block's label. Default "Partner support". */
  label?: string;
  /** The config is loading: a placeholder that names no number. */
  loading?: boolean;
  /** `block` (default) shows the replacement when support is off; `none` renders nothing. */
  unavailable?: 'block' | 'none';
  /** Default "Partner support isn't available right now". */
  unavailableTitle?: string;
  /** Default "Try again later. What you've already sent stays on record." */
  unavailableBody?: ReactNode;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** Props of the proposed `SupportSentence` (#737). */
export interface SupportSentenceProps extends SupportSource {
  /** The words before the phone. Default "Need help signing in? Call partner support on". */
  lead?: string;
  /** What to say when support is off (e.g. "If you didn't expect this, contact HalalGoes after signing in."). Default: nothing. */
  fallback?: ReactNode;
  /** Default `center`, as under every sign-in card. */
  align?: 'center' | 'start';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** North American toll-free area codes, written with a leading "1-". */
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);

/**
 * "+18005550199" → "1-800-555-0199"; "+14165550123" → "416-555-0123". Any other number is
 * returned as given.
 */
export function formatSupportPhone(e164: string): string {
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.replace(/[\s()-]/g, ''));
  if (!nanp) return e164;
  const [, area, exchange, line] = nanp;
  const local = `${area}-${exchange}-${line}`;
  return TOLL_FREE.has(area ?? '') ? `1-${local}` : local;
}

/** What a support component may show, from its props. */
export type SupportResolution =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'on'; href: string; display: string; hours: string | null };

/** Applies the support rule (module comment) to a component's props. */
export function resolveSupport(source: SupportSource, loading = false): SupportResolution {
  const enabled = source.supportEnabled ?? source.config?.support_enabled;
  if (loading || enabled === undefined) return { kind: 'loading' };
  if (enabled !== true) return { kind: 'off' };
  const phone = (source.phoneE164 ?? source.config?.support_phone_e164 ?? '').trim();
  if (!phone) return { kind: 'off' };
  const hours = (source.hours ?? source.config?.support_hours ?? '').trim();
  return {
    kind: 'on',
    href: `tel:${phone.replace(/[^\d+]/g, '')}`,
    display: source.phoneDisplay ?? formatSupportPhone(phone),
    hours: hours || null,
  };
}

/** Reports support switched on without a phone: a config fault, never shown. */
function useReportMissingPhone(source: SupportSource, resolution: SupportResolution) {
  const enabled = source.supportEnabled ?? source.config?.support_enabled;
  const missing = enabled === true && resolution.kind === 'off';
  useEffect(() => {
    if (missing) reportDsClientError('SUPPORT_PHONE_MISSING', { component: 'Support' });
  }, [missing]);
}

const TILE = 'flex flex-col rounded-md bg-surface-sunken p-4';

/** The partner-support block, or its "isn't available" replacement. */
export function SupportBlock({
  label = 'Partner support',
  loading = false,
  unavailable = 'block',
  unavailableTitle = "Partner support isn't available right now",
  unavailableBody = "Try again later. What you've already sent stays on record.",
  testId = 'SupportBlock',
  style,
  className,
  ...source
}: SupportBlockProps) {
  const support = resolveSupport(source, loading);
  useReportMissingPhone(source, support);

  if (support.kind === 'loading') {
    return (
      <div data-testid={testId} data-state="loading" aria-busy="true" style={style} className={cn(TILE, 'gap-2', className)}>
        <Skeleton width="40%" />
        <Skeleton width="60%" height={28} />
      </div>
    );
  }

  if (support.kind === 'off') {
    if (unavailable === 'none') return null;
    return (
      <div data-testid={testId} data-state="unavailable" style={style} className={cn(TILE, 'gap-2', className)}>
        <span className="text-label-lg text-fg-primary">{unavailableTitle}</span>
        {unavailableBody ? (
          <span className="text-body-sm leading-normal text-fg-secondary">{unavailableBody}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid={testId} data-state="available" style={style} className={cn(TILE, 'gap-1', className)}>
      <span className="text-label-md text-fg-secondary">{label}</span>
      <TextLink href={support.href} variant="standalone" textStyle="heading-sm" testId={`${testId}-phone`}>
        {support.display}
      </TextLink>
      {support.hours ? <span className="text-body-sm text-fg-secondary">{support.hours}</span> : null}
    </div>
  );
}

/** The one-line support sentence under a card, or its fallback. */
export function SupportSentence({
  lead = 'Need help signing in? Call partner support on',
  fallback,
  align = 'center',
  testId = 'SupportSentence',
  style,
  className,
  ...source
}: SupportSentenceProps) {
  const support = resolveSupport(source);
  useReportMissingPhone(source, support);

  const sentence = cn(
    'm-0 text-body-sm leading-normal text-fg-secondary',
    align === 'center' ? 'text-center' : 'text-start',
    className,
  );

  if (support.kind === 'loading') return null;
  if (support.kind === 'off') {
    if (fallback === undefined || fallback === null || fallback === false) return null;
    return (
      <p data-testid={testId} data-state="unavailable" style={style} className={sentence}>
        {fallback}
      </p>
    );
  }

  return (
    <p data-testid={testId} data-state="available" style={style} className={sentence}>
      {lead} <TextLink href={support.href} testId={`${testId}-phone`}>{support.display}</TextLink>
      {support.hours ? `, ${support.hours}` : ''}.
    </p>
  );
}
