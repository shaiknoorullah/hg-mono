/**
 * Placeholder for a console route whose redesigned screen has not merged yet and that has no
 * legacy screen to fall back to (History is new in the redesign). It is replaced by its WP.
 */
import { EmptyState } from '../ds';

export function PendingRoute({ title, description }: { title: string; description: string }) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-line-decorative bg-surface-raised">
      <EmptyState title={title} description={description} />
    </section>
  );
}
