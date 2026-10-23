/**
 * The app bar's service badges in the compact frame (board `PartTop`, Settings and Payouts): the
 * connection ("Live · checked in 12 s ago"), the order sound ("Sound on", from Settings › This
 * device) and the halal badge, in place of the service status bar under the app bar. The
 * connection badge opens and closes Screen health, as the status bar's health button does.
 *
 * "Live" and the check-in time come from the realtime connection and the heartbeat the status bar
 * already reads; nothing new is asked of the server. The stale note ("Last updated … may be out of
 * date") that the status bar shows stays, since that state has nowhere else to go.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HalalBadge, ShellBadge } from '../ds';
import { useConsole } from '../data/console';
import { useConnection } from '../data/connection';
import { useDevicePrefs } from '../data/devicePrefs';
import { useHeartbeatHealth } from '../data/heartbeat';
import { useAvailability } from '../data/availability';
import { formatTime } from '../format/time';
import { useHalalBadge } from '../status/useHalalBadge';
import { connectionBadge, latestCheckIn, soundBadge } from './serviceBadges';
import { useFirstLoadFailed, useStale } from './stale';

/** Re-render once a second while `active`, so "checked in 12 s ago" keeps counting. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function ServiceBadges() {
  const { timezone } = useConsole();
  const connection = useConnection();
  const beat = useHeartbeatHealth();
  const availability = useAvailability();
  const pageLoadFailed = useFirstLoadFailed();
  const stale = useStale();
  const prefs = useDevicePrefs();
  const { halal, restaurantId } = useHalalBadge();
  const [params, setParams] = useSearchParams();
  const now = useNow(connection.kind === 'live');

  // The last check-in is the later of this screen's own heartbeat (it starts once the screen went
  // live on Live orders) and the server's record of the restaurant's last heartbeat from any screen.
  const lastOkAt = latestCheckIn(beat.lastOkAt, availability.data?.last_heartbeat_at);
  const health = connectionBadge(connection, {
    firstLoadFailed: availability.status === 'error' || pageLoadFailed,
    lastOkAt,
    now,
    timeZone: timezone,
  });
  const sound = soundBadge(prefs.soundOff);
  const healthOpen = params.get('panel') === 'health';
  const toggleHealth = () => {
    const next = new URLSearchParams(params);
    if (healthOpen) next.delete('panel');
    else next.set('panel', 'health');
    setParams(next, { replace: true });
  };

  return (
    <div role="region" aria-label="Service status" className="me-1 flex items-center gap-2" data-testid="service-badges">
      <button
        type="button"
        data-health-button=""
        aria-expanded={healthOpen}
        aria-label={`Screen health: ${health.label}. Show details`}
        onClick={toggleHealth}
        className="hg-focus inline-flex min-h-11 items-center rounded-md"
      >
        <ShellBadge variant={health.variant} icon={health.icon} size="md" testId="health-badge">
          {health.label}
        </ShellBadge>
      </button>
      {stale ? (
        <ShellBadge variant="warning" icon="clock" size="md" testId="stale-badge">
          {`Last updated ${formatTime(stale.lastOkAt, timezone)} · may be out of date`}
        </ShellBadge>
      ) : null}
      <ShellBadge variant={sound.variant} icon={sound.icon} size="md" testId="sound-badge">
        {sound.label}
      </ShellBadge>
      {halal?.badge ? (
        // The slot pins the glyph to the badge's icon size (the shield fills its container otherwise).
        <span className="flex items-center [&_svg]:h-4 [&_svg]:w-4" data-testid="halal-slot">
          <HalalBadge state={halal.badge} surface="operational" size="sm" restaurantId={restaurantId} />
        </span>
      ) : null}
    </div>
  );
}
