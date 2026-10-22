/**
 * The release notes list and its states, drawn once for the panel and the Settings section
 * (canvas `PartWhatsNew`: modes since, all, loading, empty, error).
 */
import { Badge, Button, GlyphIcon, Skeleton } from '../ds';
import { APP_VERSION, releaseDate, type Release } from './releaseNotes';
import { WHATS_NEW } from './copy';
import { retryReleaseNotes } from './store';
import type { NotesView } from './useNotes';

function ReleaseSection({ release, fresh }: { release: Release; fresh: boolean }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line-decorative pb-5 last:border-b-0" data-testid="whats-new-release" data-version={release.version}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 text-heading-md">
          {WHATS_NEW.version} <span className="font-mono font-medium">{release.version}</span>
        </h3>
        <span className="text-body-sm text-fg-secondary">{releaseDate(release.date)}</span>
        {fresh ? <Badge variant="info" size="sm" label={WHATS_NEW.newToYou} /> : null}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {release.notes.map((note) => (
          <li key={note.title} className="text-body-md leading-normal">
            <span className="font-semibold">{note.title}.</span> {note.body}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotesBody({ view }: { view: NotesView }) {
  if (view.kind === 'loading') {
    return (
      <div aria-busy="true" role="status" aria-label={WHATS_NEW.loading} className="flex flex-col gap-4" data-testid="whats-new-loading">
        <Skeleton variant="rect" width={180} height={22} />
        <Skeleton variant="rect" width="100%" height={16} />
        <Skeleton variant="rect" width="86%" height={16} />
        <Skeleton variant="rect" width="92%" height={16} />
        <div className="mt-4">
          <Skeleton variant="rect" width={160} height={22} />
        </div>
        <Skeleton variant="rect" width="96%" height={16} />
        <Skeleton variant="rect" width="70%" height={16} />
      </div>
    );
  }
  if (view.kind === 'error') {
    return (
      <div role="alert" className="flex flex-col gap-3 py-8" data-testid="whats-new-error">
        <GlyphIcon name="info" size="lg" className="text-fg-secondary" />
        <h3 className="m-0 text-heading-md">{WHATS_NEW.error.title}</h3>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">{WHATS_NEW.error.body}</p>
        <div className="flex">
          <Button variant="tertiary" size="md" onPress={retryReleaseNotes}>
            {WHATS_NEW.error.retry}
          </Button>
        </div>
      </div>
    );
  }
  if (view.kind === 'upToDate') {
    return (
      <div className="flex flex-col gap-3 py-8" data-testid="whats-new-up-to-date">
        <GlyphIcon name="check" size="lg" className="text-fg-secondary" />
        <h3 className="m-0 text-heading-md">{WHATS_NEW.upToDate.title}</h3>
        <p className="m-0 text-body-md leading-normal text-fg-secondary">{WHATS_NEW.upToDate.body(APP_VERSION)}</p>
      </div>
    );
  }
  const intro =
    view.mode === 'since' ? WHATS_NEW.sinceIntro(view.items.length) : view.mode === 'first' ? WHATS_NEW.firstIntro(APP_VERSION) : WHATS_NEW.allIntro(APP_VERSION);
  return (
    <div className="flex flex-col gap-5" data-testid="whats-new-list" data-mode={view.mode}>
      <p className="m-0 text-body-md leading-normal text-fg-secondary">{intro}</p>
      {view.items.map((release) => (
        <ReleaseSection key={release.version} release={release} fresh={view.fresh.has(release.version)} />
      ))}
    </div>
  );
}
