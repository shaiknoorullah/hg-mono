/**
 * TEMPORARY STUB for the proposed DS `Banner` (ds-request(web): #674 or #675). Delete when
 * `@hg/ui-web/proposed` exports it. Page-level, not dismissible; tones danger / warning /
 * info / neutral plus the halal tones. The pre-redesign `@hg/ui-web/feedback` Banner has no
 * halal tones (expiring tint, expired slate, unverified dashed), so it cannot draw LO `Board-cert-*`.
 *
 * Layout (LO §3.4): icon lg in the tone's icon colour, title 17/700, body 15/21, optional link
 * (44 px), optional Button lg on the right. Default role `status`; `alert` for the ones that
 * must interrupt. Halal tones never use danger colours (AGENTS.md invariant 9).
 */
import type { ReactNode } from 'react';
import { Button, Icon, type IconName } from '@hg/ui-web/primitives';

export type PageBannerTone = 'info' | 'warning' | 'danger' | 'neutral' | 'halal-expiring' | 'halal-expired' | 'halal-unverified';

export interface PageBannerProps {
  tone: PageBannerTone;
  title: string;
  body: ReactNode;
  /** Glyphs the Solar set lacks (warning, info, error, refresh: #198) draw nothing. */
  icon?: IconName | 'warning' | 'info' | 'error' | 'refresh';
  role?: 'status' | 'alert';
  link?: { label: string; href: string; accessibilityLabel?: string };
  action?: { label: string; onPress: () => void };
  testId?: string;
}

const TONE: Record<PageBannerTone, { box: string; icon: string }> = {
  info: { box: 'bg-feedback-info-tint border border-feedback-info-border', icon: 'text-feedback-info-icon' },
  warning: { box: 'bg-feedback-warning-tint border border-feedback-warning-border', icon: 'text-feedback-warning-icon' },
  danger: { box: 'bg-feedback-danger-tint border border-feedback-danger-border', icon: 'text-feedback-danger-icon' },
  neutral: { box: 'bg-surface-subtle border border-line-decorative', icon: 'text-fg-secondary' },
  'halal-expiring': { box: 'bg-halal-expiring-tint border border-halal-expiring-border', icon: 'text-halal-expiring-icon' },
  'halal-expired': { box: 'bg-halal-expired-tint border border-halal-expired-border', icon: 'text-halal-expired-text' },
  'halal-unverified': { box: 'bg-surface-raised border-[1.5px] border-dashed border-halal-unverified-border', icon: 'text-halal-unverified-text' },
};

const SOLAR: readonly string[] = ['home', 'search', 'cart', 'orders', 'profile', 'map', 'bell', 'back', 'close', 'plus', 'check', 'star', 'clock', 'menu'];

export function PageBanner({ tone, title, body, icon, role = 'status', link, action, testId }: PageBannerProps) {
  const t = TONE[tone];
  const glyph = icon && SOLAR.includes(icon) ? (icon as IconName) : null;
  return (
    <div role={role} data-testid={testId} data-tone={tone} className={`flex flex-wrap items-start gap-3 rounded-md px-4 py-3 text-fg-primary ${t.box}`}>
      {glyph ? <Icon name={glyph} size={24} className={`mt-0.5 shrink-0 ${t.icon}`} /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold leading-6">{title}</p>
        <p className="text-[15px] leading-[21px]">{body}</p>
        {link ? (
          <a href={link.href} aria-label={link.accessibilityLabel} className="hg-focus inline-flex min-h-11 items-center text-[15px] font-semibold text-fg-link underline">
            {link.label}
          </a>
        ) : null}
      </div>
      {action ? (
        <Button variant="tertiary" size="lg" onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
