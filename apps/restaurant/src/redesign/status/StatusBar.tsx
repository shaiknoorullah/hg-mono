/**
 * The status bar's content (`StatusBarSlot`, region "Service status"; LO §3, wp1 §5), left
 * to right: screen-health button, stale badge, spacer, HalalBadge + divider, open-state badge
 * + reason, the Orders switch, and Pause (or "Resume now").
 *
 * - The switch moves only when the server confirms: it renders `is_accepting_orders` as read
 *   back from the PATCH response, and shows loading while the call is in flight.
 * - Turning orders off and resuming a pause confirm in the page (InlineConfirm under the
 *   status bar, first focus on the least-change button). Turning on needs no confirm.
 * - "Pause until closing" is hidden until #312 lands (Q7): the server would need
 *   `pause_until_closing` and the closing time, and the browser never computes it.
 *
 * The ringing link ("Ringing · 2 waiting") belongs to the strip's work package (WP3).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { Badge, Button, HalalBadge, Icon, InlineConfirm, Menu, Switch, reportHalalClientError, useToast } from '../ds';
import type { BadgeVariant, IconName } from '../ds';
import { useConsole } from '../data/console';
import { setAcceptingOrders, useAvailability, type Availability } from '../data/availability';
import { useConnection, type ConnectionView } from '../data/connection';
import { serverNow } from '../data/serverClock';
import { formatTime } from '../format/time';
import { useConsoleLayout } from '../shell/layout';
import { useStale } from '../shell/stale';
import { halalConsoleView } from './halal';
import { openStateView } from './openState';

const PAUSE_CHOICES = [
  { key: '15', minutes: 15, label: 'Pause for 15 minutes' },
  { key: '30', minutes: 30, label: 'Pause for 30 minutes' },
  { key: '60', minutes: 60, label: 'Pause for 1 hour' },
] as const;

export interface HealthBadge {
  label: string;
  variant: BadgeVariant;
  icon?: IconName;
}

/** The screen-health badge (wp1 spec §6) for this screen's connection. */
export function healthBadge(c: ConnectionView, firstLoadFailed: boolean, timeZone?: string): HealthBadge {
  if (c.kind === 'offline') {
    return { label: c.since ? `Offline since ${formatTime(c.since, timeZone)}` : 'Offline', variant: 'danger' };
  }
  if (firstLoadFailed) return { label: 'Not connected', variant: 'danger' };
  if (c.kind === 'reconnecting') {
    return { label: c.since ? `Reconnecting · since ${formatTime(c.since, timeZone)}` : 'Reconnecting', variant: 'warning' };
  }
  if (c.kind === 'connecting') return { label: 'Connecting…', variant: 'neutral' };
  return { label: 'Live', variant: 'neutral', icon: 'check' };
}

export function StatusBar() {
  const { core, profile, timezone } = useConsole();
  const availability = useAvailability();
  const connection = useConnection();
  const stale = useStale();
  const toast = useToast();
  const { setConfirm } = useConsoleLayout();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState<null | 'on' | 'off' | 'pause' | 'resume'>(null);
  const healthRef = useRef<HTMLButtonElement>(null);

  const restaurantId = core.data?.restaurantId ?? null;
  const { mutate, refresh } = availability;

  // `restaurant.status_changed`: another screen, the server's auto-off, or an admin changed it.
  useRealtimeChannel(restaurantId ? `restaurant:${restaurantId}` : null, (signal) => {
    if (signal.kind === 'refetch') {
      void refresh();
      return;
    }
    const ev = eventOfType(signal, 'restaurant.status_changed');
    if (!ev) return;
    mutate((prev) =>
      prev
        ? { ...prev, is_accepting_orders: ev.data.is_accepting_orders, open_state: ev.data.open_state, reason: ev.data.reason ?? prev.reason }
        : prev,
    );
  });

  // Halal (wp4 §7): missing → nothing on screen, and the absence is reported.
  const profileReady = profile.status === 'ready' || profile.status === 'stale';
  const halal = profileReady ? halalConsoleView(profile.data?.halal, null) : null;
  const missingHalal = Boolean(halal?.missing);
  useEffect(() => {
    if (missingHalal) {
      reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId: profile.data?.id, received: profile.data?.halal, surface: 'operational' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingHalal]);

  const view = openStateView(availability.data, { status: availability.status, halalBlocked: halal?.blocksOrdering });
  const health = healthBadge(connection, availability.status === 'error', timezone);
  const healthOpen = params.get('panel') === 'health';

  const toggleHealth = () => {
    const next = new URLSearchParams(params);
    if (healthOpen) next.delete('panel');
    else next.set('panel', 'health');
    setParams(next, { replace: true });
  };

  const write = useCallback(
    async (body: { is_accepting_orders: boolean; pause_until?: string | null }, kind: 'on' | 'off' | 'pause' | 'resume') => {
      setPending(kind);
      try {
        const next: Availability = await setAcceptingOrders(body);
        mutate(() => next);
        return true;
      } catch {
        return false;
      } finally {
        setPending(null);
      }
    },
    [mutate],
  );

  const turnOn = async () => {
    const ok = await write({ is_accepting_orders: true }, 'on');
    if (!ok) {
      toast.show({ variant: 'danger', title: 'Couldn’t turn on orders', description: 'You’re still not accepting orders. Check the connection and try again.' });
    }
  };

  const askTurnOff = () =>
    setConfirm(
      <InlineConfirm
        testId="turn-off-confirm"
        icon="info"
        title="Stop accepting new orders?"
        body="Orders already waiting still need an answer. Customers can’t order until you turn this back on."
        cancel={{ label: 'Keep accepting', onPress: () => setConfirm(null) }}
        actions={[
          {
            label: 'Stop accepting',
            variant: 'secondary',
            onPress: async () => {
              setConfirm(null);
              const ok = await write({ is_accepting_orders: false }, 'off');
              if (!ok) {
                toast.show({ variant: 'danger', title: 'Couldn’t turn off orders', description: 'You’re still accepting orders. Check the connection and try again.' });
              }
            },
          },
        ]}
      />,
    );

  const pause = async (minutes: number) => {
    const until = new Date(serverNow() + minutes * 60_000).toISOString();
    const ok = await write({ is_accepting_orders: true, pause_until: until }, 'pause');
    if (!ok) {
      toast.show({ variant: 'danger', title: 'Couldn’t pause new orders', description: 'New orders are still on. Check the connection and try again.' });
    }
  };

  const askResume = () => {
    const until = availability.data?.pause_until;
    setConfirm(
      <InlineConfirm
        testId="resume-confirm"
        icon="clock"
        title="Resume new orders now?"
        body={`New orders start ringing on this screen straight away.${until ? ` Your pause was set to end at ${formatTime(until, timezone)}.` : ''}`}
        cancel={{ label: 'Stay paused', onPress: () => setConfirm(null) }}
        actions={[
          {
            label: 'Resume now',
            variant: 'secondary',
            onPress: async () => {
              setConfirm(null);
              const ok = await write({ is_accepting_orders: true, pause_until: null }, 'resume');
              if (!ok) {
                toast.show({ variant: 'danger', title: 'Couldn’t resume new orders', description: 'You’re still paused. Check the connection and try again.' });
              }
            },
          },
        ]}
      />,
    );
  };

  const switchHelp = pending === 'on' ? 'Turning on…' : view.orders.help;

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-1.5" data-testid="status-bar">
      <button
        ref={healthRef}
        type="button"
        data-health-button=""
        aria-expanded={healthOpen}
        aria-label={`Screen health: ${health.label}. Show details`}
        onClick={toggleHealth}
        className="hg-focus inline-flex min-h-11 items-center gap-1 rounded-md"
      >
        <Badge size="lg" variant={health.variant} icon={health.icon} label={health.label} testId="health-badge" />
        <Icon name="back" size={16} className="rotate-180 text-fg-secondary" />
      </button>

      {stale ? (
        <Badge size="lg" variant="warning" icon="clock" label={`Last updated ${formatTime(stale.lastOkAt, timezone)} · may be out of date`} testId="stale-badge" />
      ) : null}

      <span className="flex-1" aria-hidden="true" />

      {halal?.badge ? (
        // DS defect (to report on #196): HalalShield passes `var(--hg-icon-sm)` as the SVG
        // width/height attributes, which browsers ignore, so the shield fills its container.
        // The slot pins the glyph to the md badge's 16 px icon size until the DS fix lands.
        <span className="flex items-center gap-3.5 [&_svg]:h-4 [&_svg]:w-4" data-testid="halal-slot">
          <HalalBadge state={halal.badge} surface="operational" size="md" restaurantId={profile.data?.id} />
          <span aria-hidden="true" className="h-7 w-px bg-line-decorative" />
        </span>
      ) : null}

      <span className="flex min-w-0 items-center gap-2">
        <Badge size="lg" variant={view.badge.variant} icon={view.badge.icon} label={view.badge.label} testId="open-state-badge" />
        {view.reason ? (
          <span className="max-w-[150px] truncate text-[15px] text-fg-secondary xl:max-w-[240px]" title={view.reason} data-testid="open-state-reason">
            {view.reason}
          </span>
        ) : null}
      </span>

      <Switch
        className="min-w-[240px] max-w-[280px]"
        label="Orders"
        checked={view.orders.checked}
        stateLabel={view.orders.stateLabel}
        description={switchHelp ?? undefined}
        disabled={view.orders.disabled}
        loading={pending === 'on' || pending === 'off'}
        onChange={(next) => (next ? void turnOn() : askTurnOff())}
      />

      {view.pause === 'resume' ? (
        <Button variant="tertiary" size="md" loading={pending === 'resume'} onPress={askResume}>
          Resume now
        </Button>
      ) : (
        <Menu
          label="Pause new orders"
          trigger={<span>Pause</span>}
          variant="tonal"
          align="end"
          disabled={view.pause === 'menu-disabled' || pending !== null}
          items={PAUSE_CHOICES.map((c) => ({ key: c.key, label: c.label, onSelect: () => void pause(c.minutes) }))}
          testId="pause-menu"
        />
      )}
    </div>
  );
}
