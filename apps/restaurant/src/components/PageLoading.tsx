import { Spinner } from '@hg/ui-web';

/**
 * A full-region loading placeholder — `@hg/ui-web` ships the `Spinner` primitive itself but,
 * deliberately, no "loading page" wrapper (a spinner's container is layout, not a design-
 * system concern), so this stays a small local composition around it.
 */
export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-3 py-24">
      <Spinner size="lg" decorative />
      <p className="text-label-md font-semibold text-fg-secondary">{label}</p>
    </div>
  );
}
