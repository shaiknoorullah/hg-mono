/**
 * Settings, What's new (`/settings/whatsnew`; boards `WhatsNew-Page`, `-Loading`, `-Error`,
 * `-UpToDate`): every release, newest first. Reading them here counts as having seen them, like
 * the panel. The notes load from the app's own bundled file (`./store`), so loading and error are
 * the state of that file, not of the server.
 */
import { WHATS_NEW } from './copy';
import { NotesBody } from './NotesBody';
import { useMarkSeenWhenShown, useNotesView } from './useNotes';

export function WhatsNewSection() {
  const view = useNotesView('all', null);
  useMarkSeenWhenShown(view.kind === 'list');
  return (
    <section aria-labelledby="whats-new-h" className="flex max-w-[720px] flex-col gap-4" data-testid="section-whats-new">
      <h2 id="whats-new-h" className="m-0 text-heading-md">
        {WHATS_NEW.section}
      </h2>
      <div className="flex flex-col gap-4 rounded-lg border border-line-decorative bg-surface-raised p-6">
        <NotesBody view={view} />
      </div>
    </section>
  );
}
