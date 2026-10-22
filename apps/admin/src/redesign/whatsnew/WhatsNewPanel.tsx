/**
 * The What's new panel (boards `ASS/WhatsNewPanel`, `-Admin`, `-Support`, `-UpToDate`, `-Loading`,
 * `-Empty`, `-Error`, `-Offline`, `-FocusReturn`, `-Zoom200`, `-Reflow320`).
 *
 * Beside the page, never over it, 480 px wide. In a window 720 px wide or narrower (200% zoom of
 * 1440) it takes the whole content area and the app bar offers Back. Its heading takes focus on
 * open; Done, Close and Escape close it and focus goes back to the button that opened it.
 */
import { Button, DetailPanel, EmptyState, ErrorState, Badge } from '../ds';
import { useOnline } from '../system/banners';
import { WHATS_NEW } from './copy';
import { APP_VERSION, releaseDate, selectReleases, type Release } from './releaseNotes';
import { retryReleaseNotes, useWhatsNewState } from './store';
import { readableReleases, useWhatsNewApi, WHATS_NEW_PANEL_ID } from './WhatsNewProvider';

function ReleaseSection({ release, fresh }: { release: Release; fresh: boolean }) {
  return (
    <section className="flex flex-col gap-2" data-testid="whats-new-release" data-version={release.version}>
      <div className="flex items-baseline gap-3">
        <h3 className="text-heading-sm font-semibold text-fg-primary">
          {WHATS_NEW.version} <span className="font-mono">{release.version}</span>
        </h3>
        {fresh ? (
          <Badge variant="brand" size="sm">
            {WHATS_NEW.newBadge}
          </Badge>
        ) : null}
      </div>
      <p className="text-body-sm text-fg-secondary">{WHATS_NEW.released(releaseDate(release.date))}</p>
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-md">
        {release.notes.map((note) => (
          <li key={note.title}>
            <span className="font-semibold">{note.title}.</span> {note.body}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WhatsNewPanel({ layout }: { layout: 'side' | 'page' }) {
  const api = useWhatsNewApi();
  const state = useWhatsNewState();
  const online = useOnline();
  if (!api.open) return <div id={WHATS_NEW_PANEL_ID} hidden />;

  const readable = readableReleases(state, api.role);
  const failed = state.load.status === 'error';
  const selection = readable ? selectReleases(readable, api.baseline, APP_VERSION) : null;

  let body;
  let footer;
  if (failed) {
    body = <ErrorState title={WHATS_NEW.error.title} description={WHATS_NEW.error.body(APP_VERSION)} headingLevel={3} />;
    footer = (
      <Button variant="tertiary" size="md" iconStart="refresh" onPress={retryReleaseNotes}>
        {WHATS_NEW.error.retry}
      </Button>
    );
  } else if (!readable || !selection) {
    body = (
      <p role="status" className="text-body-md text-fg-secondary">
        {WHATS_NEW.loading}
      </p>
    );
  } else if (readable.length === 0) {
    body = <EmptyState icon="bell" title={WHATS_NEW.empty.title} description={WHATS_NEW.empty.body(APP_VERSION)} headingLevel={3} />;
  } else {
    const current = selection.mode === 'current';
    const items = current ? readable : selection.items;
    const fresh = new Set(current ? [] : selection.items.map((r) => r.version));
    const roleLine = api.role && api.role !== 'SUPER_ADMIN' ? WHATS_NEW.changesFor(api.role) : WHATS_NEW.changedSince;
    const intro =
      selection.mode === 'first' ? WHATS_NEW.firstIntro : selection.mode === 'since' ? `${WHATS_NEW.looked(api.baseline ?? '')} ${roleLine}` : null;
    body = (
      <div className="flex flex-col gap-6">
        {current ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-heading-sm font-semibold text-fg-primary">{WHATS_NEW.upToDate}</h3>
            <p className="text-body-md text-fg-secondary">{WHATS_NEW.upToDateBody(APP_VERSION)}</p>
          </div>
        ) : null}
        {intro || !online ? (
          <p className="text-body-md text-fg-secondary">{[!online ? WHATS_NEW.offline : null, intro].filter(Boolean).join(' ')}</p>
        ) : null}
        {items.map((release) => (
          <ReleaseSection key={release.version} release={release} fresh={fresh.has(release.version)} />
        ))}
      </div>
    );
    footer = (
      <Button variant="primary" size="md" onPress={api.close}>
        {WHATS_NEW.done}
      </Button>
    );
  }

  const panel = (
    <DetailPanel
      id={WHATS_NEW_PANEL_ID}
      testId="whats-new-panel"
      title={WHATS_NEW.panelTitle}
      closeLabel={WHATS_NEW.close}
      onClose={api.close}
      {...(footer ? { footer } : {})}
    >
      {body}
    </DetailPanel>
  );
  return layout === 'side' ? (
    <aside className="flex h-full w-[480px] shrink-0 flex-col border-s border-line-decorative bg-surface-raised">{panel}</aside>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
  );
}
