/**
 * The update notice in the system banner slot (boards `ASS/WhatsNewNotice`, `-FirstDevice`,
 * `-AfterNotNow`, `-Returns`, `-Queued`; issue 102). It shows once per version per device, below
 * any warning banner, and never interrupts: while a panel with unsent input is open it waits.
 *
 * "See what's new" opens the panel. "Not now" stores the current version as last-seen on this
 * device, so the notice does not come back; the sidebar's New label stays until the panel opens.
 * A device that cannot store anything shows no notice (What's new is still in the sidebar).
 */
import { Banner, Button } from '../ds';
import { WHATS_NEW } from './copy';
import { APP_VERSION, selectReleases } from './releaseNotes';
import { markNoticed, useWhatsNewState } from './store';
import { readableReleases, useWhatsNewApi, WHATS_NEW_PANEL_ID } from './WhatsNewProvider';

export function WhatsNewNotice() {
  const api = useWhatsNewApi();
  const state = useWhatsNewState();
  const readable = readableReleases(state, api.role);
  if (readable === null || state.storage !== 'ok' || api.open || state.holds > 0) return null;
  const selection = selectReleases(readable, state.lastSeen, APP_VERSION);
  if (selection.mode === 'current') return null;

  const first = selection.mode === 'first';
  return (
    <section role="region" aria-label={WHATS_NEW.noticeRegion} data-testid="whats-new-notice" data-mode={selection.mode}>
      <Banner
        tone="info"
        icon="bell"
        announce="status"
        title={first ? WHATS_NEW.noticeFirst(APP_VERSION) : WHATS_NEW.noticeSince(APP_VERSION)}
        {...(first ? {} : { description: WHATS_NEW.noticeCount(selection.items.length) })}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              size="md"
              aria-expanded={false}
              aria-controls={WHATS_NEW_PANEL_ID}
              accessibilityLabel={WHATS_NEW.seeWhatsNewLabel}
              onPress={(event) => api.openFrom(event.currentTarget as HTMLElement)}
            >
              {WHATS_NEW.seeWhatsNew}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onPress={() => {
                markNoticed();
                document.getElementById('main-content')?.focus({ preventScroll: true });
              }}
            >
              {WHATS_NEW.notNow}
            </Button>
          </div>
        }
      />
    </section>
  );
}
