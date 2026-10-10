/**
 * TEMPORARY STUB for the proposed DS `InlineNotice` (LO `Proposed-components`; ds-request(web):
 * #675). Delete when `@hg/ui-web/proposed` exports it.
 *
 * Icon · title · body on a feedback tint (info, warning, danger, neutral, brand). The caller
 * picks the role: `alert` for something that just went wrong, `status` for progress, `note`
 * for static context. Glyphs the DS Solar set does not have yet (warning, error, info,
 * refresh: #198) draw no icon; the words carry the meaning.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@hg/ui-web/primitives';
import { glyph, type GlyphName } from './glyph';

export type NoticeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'brand';

export interface InlineNoticeProps {
  tone?: NoticeTone;
  icon?: GlyphName;
  title?: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status' | 'note';
  label?: string;
  className?: string;
  testId?: string;
}

const TONE: Record<NoticeTone, string> = {
  neutral: 'bg-surface-subtle border-line-decorative text-fg-primary',
  info: 'bg-feedback-info-tint border-feedback-info-border text-fg-primary',
  warning: 'bg-feedback-warning-tint border-feedback-warning-border text-fg-primary',
  danger: 'bg-feedback-danger-tint border-feedback-danger-border text-fg-primary',
  brand: 'bg-brand-50 border-line-brand text-fg-primary',
};

const ICON_TONE: Record<NoticeTone, string> = {
  neutral: 'text-fg-secondary',
  info: 'text-feedback-info-icon',
  warning: 'text-feedback-warning-icon',
  danger: 'text-feedback-danger-icon',
  brand: 'text-brand-600',
};

export function InlineNotice({ tone = 'neutral', icon, title, children, role, label, className, testId }: InlineNoticeProps) {
  const name: IconName | null = icon ? glyph(icon) : null;
  return (
    <div
      role={role}
      aria-label={label}
      data-testid={testId}
      data-tone={tone}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${TONE[tone]} ${className ?? ''}`}
    >
      {name ? <Icon name={name} size={20} className={`mt-0.5 shrink-0 ${ICON_TONE[tone]}`} /> : null}
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <span className="text-[17px] font-bold leading-[22px]">{title}</span> : null}
        {children ? <div className="text-[15px] leading-[21px]">{children}</div> : null}
      </div>
    </div>
  );
}
