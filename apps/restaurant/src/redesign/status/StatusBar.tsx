/**
 * The status bar's content (`StatusBarSlot`, region "Service status"; LO §3, wp1 §5), left
 * to right: screen-health button, stale badge, spacer, HalalBadge + divider, open-state badge
 * + reason, the Orders switch, and Pause (or "Resume now").
 *
 * - The switch moves only when the server confirms: it renders `is_accepting_orders` as read
 *   back from the PATCH response, and shows loading while the call is in flight.
 * - Turning orders off and resuming a pause confirm in the page (InlineConfirm under the
 *   status bar, first focus on the least-change button). Turning on needs no confirm.
 * - "Pause until closing" sends `pause_until_closing`: the server works out the closing time
 *   (a late night runs past midnight) and the browser never computes it.
 *
 * The ringing link ("Ringing · 2 waiting") shows while orders wait, from the strip's count.
 */
import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShellBadge, Button, HalalBadge, Icon, InlineConfirm, Menu, Switch, useToast } from '../ds';
import type { DsIconName } from '@hg/ui-web/ds';
import type { BadgeVariant, IconName } from '../ds';
import { useConsole } from '../data/console';
import { useConnection, type ConnectionView } from '../data/connection';
import { serverNow } from '../data/serverClock';
import { formatTime } from '../format/time';
import { useConsoleLayout } from '../shell/layout';
import { useWaitingCount } from '../shell/waiting';
import { useFirstLoadFailed, useStale } from '../shell/stale';
import { openStateView } from './openState';
import { useAcceptingOrders } from './acceptingOrders';
import { useHalalBadge } from './useHalalBadge';

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
  const { profile, timezone } = useConsole();
  const { availability, pending, write, turnOn, askTurnOff, outsideHours } = useAcceptingOrders();
  const connection = useConnection();
  const stale = useStale();
  const pageLoadFailed = useFirstLoadFailed();
  const toast = useToast();
  const { setConfirm } = useConsoleLayout();
  const [params, setParams] = useSearchParams();
  const healthRef = useRef<HTMLButtonElement>(null);
  const waiting = useWaitingCount();
  // Halal (wp4 §7): missing → nothing on screen, and the absence is reported.
  const { halal } = useHalalBadge();

  // A page whose first read failed (Board-first-load-error) makes the whole bar unknown: the
  // open state can't be shown as known beside "We couldn’t load your orders".
  const view = pageLoadFailed
    ? openStateView(null, { status: 'error' })
    : openStateView(availability.data, { status: availability.status, halalBlocked: halal?.blocksOrdering });
  const health = healthBadge(connection, availability.status === 'error' || pageLoadFailed, timezone);
  const healthOpen = params.get('panel') === 'health';

  const toggleHealth = () => {
    const next = new URLSearchParams(params);
    if (healthOpen) next.delete('panel');
    else next.set('panel', 'health');
    setParams(next, { replace: true });
  };

  const pause = async (minutes: number) => {
    const until = new Date(serverNow() + minutes * 60_000).toISOString();
    const ok = await write({ is_accepting_orders: true, pause_until: until }, 'pause');
    if (!ok) {
      toast.show({ variant: 'danger', title: 'Couldn’t pause new orders', description: 'New orders are still on. Check the connection and try again.' });
    }
  };

  const pauseToClosing = async () => {
    outsideHours.current = false;
    const ok = await write({ is_accepting_orders: true, pause_until_closing: true }, 'pause');
    if (!ok) {
      toast.show(
        outsideHours.current
          ? { variant: 'warning', title: 'No closing to pause until', description: 'You’re outside your opening hours, so new orders are already stopped.' }
          : { variant: 'danger', title: 'Couldn’t pause new orders', description: 'New orders are still on. Check the connection and try again.' },
      );
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
        <ShellBadge size="lg" variant={health.variant} icon={health.icon as DsIconName | undefined} label={health.label} testId="health-badge" />
        <Icon name="back" size={16} className="rotate-180 text-fg-secondary" />
      </button>

      {waiting > 0 ? (
        // The boards' "Ringing · 2 waiting": a link down to the strip, where the orders ring.
        <a
          href="#new-orders"
          aria-label={`Ringing · ${waiting} waiting. Go to new orders`}
          className="hg-focus inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-fg-primary no-underline"
          data-testid="ringing-link"
        >
          <ShellBadge size="lg" variant="brand" icon="bell" label={`Ringing · ${waiting} waiting`} testId="ringing-badge" />
        </a>
      ) : null}

      {stale ? (
        <ShellBadge size="lg" variant="warning" icon="clock" label={`Last updated ${formatTime(stale.lastOkAt, timezone)} · may be out of date`} testId="stale-badge" />
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
        <ShellBadge size="lg" variant={view.badge.variant} icon={view.badge.icon as DsIconName | undefined} label={view.badge.label} testId="open-state-badge" />
        {view.reason ? (
          <span className="max-w-[150px] truncate text-[15px] text-fg-secondary xl:max-w-[240px]" title={view.reason} data-testid="open-state-reason">
            {view.reason}
          </span>
        ) : null}
      </span>

      <Switch
        className="min-w-0 max-w-[280px] md:min-w-[240px]"
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
          trigger={
            <span className="inline-flex items-center gap-1.5">
              Pause
              <Icon name="back" size={16} className="-rotate-90" />
            </span>
          }
          variant="tonal"
          align="end"
          disabled={view.pause === 'menu-disabled' || pending !== null}
          items={[
            ...PAUSE_CHOICES.map((c) => ({ key: c.key, label: c.label, onSelect: () => void pause(c.minutes) })),
            { key: 'close', label: 'Pause until closing', onSelect: () => void pauseToClosing() },
          ]}
          testId="pause-menu"
        />
      )}
    </div>
  );
}
