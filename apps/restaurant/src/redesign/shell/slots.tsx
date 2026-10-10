/**
 * The console's fixed regions that later work packages fill (WP1 leaves them empty):
 *
 * - `StatusBarSlot`: open state, Orders switch and Pause, HalalBadge (WP4);
 * - `StripSlot`: the NewOrderStrip, on every signed-in page (WP3);
 * - `SHELL_PANELS`: panels the shell owns, opened by `?panel=<key>` on any page
 *   (the strip's offer and decline panels (WP3), screen health, support, What's new).
 *
 * Each WP replaces its own entry, so any WP's PR can be reverted without touching the others.
 */
import type { ComponentType } from 'react';
import { StripView } from '../strip/StripView';
import { OfferPanel } from '../strip/OfferPanel';
import { DeclinePanelRoute } from '../strip/DeclinePanel';

export function StatusBarSlot() {
  return null;
}

/** WP3: the new-order strip (state lives in `strip/NewOrdersProvider`, mounted by the console). */
export function StripSlot() {
  return <StripView />;
}

export interface ShellPanelProps {
  /** Close the panel and return focus to whatever opened it. */
  onClose: () => void;
  params: URLSearchParams;
}

export const SHELL_PANELS: Record<string, { title: string; Component: ComponentType<ShellPanelProps> }> = {
  // WP3: a new order (`?panel=offer&order=ID`) and its decline form (`?panel=decline&order=ID`).
  offer: { title: 'New order', Component: OfferPanel },
  decline: { title: 'Decline order', Component: DeclinePanelRoute },
};
