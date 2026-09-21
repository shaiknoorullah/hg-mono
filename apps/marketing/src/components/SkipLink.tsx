/**
 * The first thing in the tab order, on every page.
 *
 * Without it a keyboard reader crosses five header controls before the first
 * control in the content — and on a track page the content behind them is
 * 20,000px of pinned beats, which is not a thing anyone should have to tab
 * past. WCAG 2.4.1, and the cheapest item on the list.
 *
 * Hidden until it is focused rather than always visible: `sr-only` keeps it out
 * of the layout, and `not-sr-only` on focus puts it back as an ordinary chip
 * over the masthead. It is a real anchor, so it works before hydration.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-surface-raised px-4 py-2.5 text-body-sm font-semibold text-fg-primary underline decoration-line-decorative underline-offset-4 shadow-[var(--hg-elevation-3)] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to content
    </a>
  );
}
