/**
 * The console's fixed regions that later work packages fill (WP1 leaves them empty):
 *
 * - `StatusBarSlot`: open state, Orders switch and Pause, HalalBadge (WP4);
 * - `StripSlot`: the NewOrderStrip, on every signed-in page (WP3);
 * - `SHELL_PANELS`: panels the shell owns, opened by `?panel=<key>` on any page
 *   (the strip's decline form, screen health, support, What's new).
 *
 * Each WP replaces its own entry, so any WP's PR can be reverted without touching the others.
 */
import type { ComponentType } from 'react';

export function StatusBarSlot() {
  return null;
}

export function StripSlot() {
  return null;
}

export interface ShellPanelProps {
  /** Close the panel and return focus to whatever opened it. */
  onClose: () => void;
  params: URLSearchParams;
}

export const SHELL_PANELS: Record<string, { title: string; Component: ComponentType<ShellPanelProps> }> = {};
