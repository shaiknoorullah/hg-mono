/**
 * Tone -> class tables shared by Banner and InlineAlert. Every tone is a TINT: there is no
 * solid danger fill anywhere here, and `slate` (the halal "we can't currently vouch" tone)
 * uses the halal expired tokens, never the danger ramp (rule 9). `success-tint` is tint
 * only (rule 10, lint L-4).
 */
import type { AnyIconName } from '../adapters/Icon.adapter';

export type AlertTone = 'neutral' | 'info' | 'warning' | 'danger' | 'slate' | 'success-tint';

export const TONE_CLASS: Record<AlertTone, { box: string; title: string; body: string; icon: string }> = {
  neutral: { box: 'bg-surface-subtle border-line-strong', title: 'text-fg-primary', body: 'text-fg-primary', icon: 'text-fg-secondary' },
  info: { box: 'bg-feedback-info-tint border-feedback-info-border', title: 'text-feedback-info-tint-text', body: 'text-feedback-info-tint-text', icon: 'text-feedback-info-icon' },
  warning: { box: 'bg-feedback-warning-tint border-feedback-warning-border', title: 'text-feedback-warning-tint-text', body: 'text-feedback-warning-tint-text', icon: 'text-feedback-warning-icon' },
  danger: { box: 'bg-feedback-danger-tint border-feedback-danger-border', title: 'text-feedback-danger-tint-text', body: 'text-feedback-danger-tint-text', icon: 'text-feedback-danger-icon' },
  slate: { box: 'bg-halal-expired-tint border-halal-expired-border', title: 'text-halal-expired-text', body: 'text-halal-expired-text', icon: 'text-halal-expired-text' },
  'success-tint': { box: 'bg-feedback-success-tint border-feedback-success-border', title: 'text-feedback-success-tint-text', body: 'text-feedback-success-tint-text', icon: 'text-feedback-success-icon' },
};

export const TONE_ICON: Record<AlertTone, AnyIconName> = {
  neutral: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'error',
  slate: 'info',
  'success-tint': 'check',
};
