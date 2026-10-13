/**
 * Focus classes shared by the stubs. `hg-focus` is the two-layer ring from
 * `@hg/ui-web/styles.css`; on the forest chrome the offset becomes the chrome colour and the
 * ring the on-accent colour, so the ring stays visible on the dark rail.
 */
import { HG_FOCUS, HG_FOCUS_INSET } from '@hg/ui-web';

export const FOCUS = HG_FOCUS;
export const FOCUS_INSET = HG_FOCUS_INSET;
export const FOCUS_ON_CHROME = `${HG_FOCUS} [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-text-on-accent)]`;

/** Moves focus without scrolling the page when the browser supports it. */
export function focusElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Every keyboard-reachable element inside `root`, in DOM order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Keeps Tab and Shift+Tab inside `root` (for modal surfaces only: Modal, Sheet, NavDrawer). */
export function trapTab(event: KeyboardEvent | React.KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== 'Tab' || !root) return;
  const items = focusableWithin(root);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusElement(first);
  }
}
