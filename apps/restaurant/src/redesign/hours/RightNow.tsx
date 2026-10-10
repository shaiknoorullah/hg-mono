/**
 * The "Right now" card on Hours (spec wp9-hours §3, canvas `PartNowCard`, boards
 * `HoursOpenStates`, `HoursPauseMenu`, `HoursToggleStates`, `HoursPaused`, `HoursPauseStale`,
 * `HoursClosedHours`, `HoursOffline`, `HoursSuspended`).
 *
 * The switch holds its old position with a spinner until the server answers, then shows what
 * was read back; a failure leaves everything as it was and says so. Pause lengths each name
 * their end time and none is preselected. "Pause until closing" stays hidden until the API
 * can send the closing time (#312, plan Q7): the browser never computes it.
 *
 * Not built here yet: the sound prompt that turning New orders on with sound off opens
 * (`HoursSoundGate`, `HoursSoundOff`). It needs WP3's sound store, which is not on main.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { channel, type RestaurantOpenState } from '@hg/api-client';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { Badge, Button, InlineConfirm, Menu, Skeleton, Switch, useToast, type BadgeProps } from '../ds';
import { setAcceptingOrders, type Availability } from '../data/availability';
import type { ServerResource } from '../data/useServerResource';
import { serverNow } from '../data/serverClock';
import { useConsoleLayout } from '../shell/layout';
import { formatTime, isoDateIn } from '../format/time';
import type { HoursOverride } from './model';

export type NowState =
  | 'open'
  | 'paused'
  | 'paused_stale'
  | 'closed_toggle'
  | 'auto_off'
  | 'offline'
  | 'closed_hours'
  | 'closed_holiday'
  | 'closed_no_hours'
  | 'suspended';

/** The card's state from the server's open state (and what only the client can see). */
export function nowState(av: Availability, ctx: { noHours: boolean; now: number }): NowState {
  const s: RestaurantOpenState = av.open_state;
  switch (s) {
    case 'CLOSED_SUSPENDED':
      return 'suspended';
    case 'CLOSED_OFFLINE':
      return 'offline';
    case 'CLOSED_TOGGLE':
      return (av.missed_order_count ?? 0) >= 2 ? 'auto_off' : 'closed_toggle';
    case 'PAUSED':
      return av.pause_until && Date.parse(av.pause_until) <= ctx.now ? 'paused_stale' : 'paused';
    case 'CLOSED_HOLIDAY':
      return 'closed_holiday';
    case 'CLOSED_HOURS':
      return ctx.noHours ? 'closed_no_hours' : 'closed_hours';
    case 'OPEN':
      return ctx.noHours ? 'closed_no_hours' : 'open';
    default:
      return 'closed_hours';
  }
}

const WHO: Record<string, string> = {
  RESTAURANT: 'You can change this.',
  ADMIN: 'Only HalalGoes support can change this.',
  TIME: 'This changes by itself.',
};

const BADGE: Record<NowState, Pick<BadgeProps, 'label' | 'variant' | 'icon'>> = {
  open: { label: 'Open', variant: 'neutral', icon: 'check' },
  paused: { label: 'Paused', variant: 'warning', icon: 'clock' },
  paused_stale: { label: 'Paused', variant: 'warning', icon: 'clock' },
  closed_toggle: { label: 'Not accepting orders', variant: 'neutral' },
  auto_off: { label: 'Not accepting orders', variant: 'neutral' },
  offline: { label: 'Not receiving orders', variant: 'warning' },
  closed_hours: { label: 'Closed', variant: 'neutral', icon: 'clock' },
  closed_holiday: { label: 'Closed today', variant: 'neutral', icon: 'clock' },
  closed_no_hours: { label: 'Closed', variant: 'neutral', icon: 'clock' },
  suspended: { label: 'Suspended', variant: 'neutral' },
};

/** "Why switching on doesn’t open you" (R-22 precedence, spec §3.4). */
const WHY_STEPS = [
  'Your account is suspended',
  'No order screen has checked in for 5 minutes',
  'New orders are switched off',
  'You paused new orders',
  'A special date closes you today',
  'You are outside your opening hours, or past your last-order time',
  'Otherwise, you are open',
] as const;
const WHY_STEP_OF: Partial<Record<NowState, number>> = { closed_holiday: 5, closed_hours: 6 };

type Op = { kind: 'off' | 'on' | 'pause' | 'resume'; phase: 'busy' | 'done' | 'failed'; until?: string } | null;

const PAUSES = [15, 30, 60] as const;

/** "7:25 pm", or "12:10 am tomorrow" when the pause ends after midnight. */
function pauseEndLabel(endMs: number, now: number, tz: string): string {
  const label = formatTime(endMs, tz);
  return isoDateIn(endMs, tz) !== isoDateIn(now, tz) ? `${label} tomorrow` : label;
}

export interface RightNowProps {
  availability: ServerResource<Availability>;
  /** For `restaurant.status_changed` on `restaurant:{id}`. */
  restaurantId: string | null;
  timezone: string;
  noHours: boolean;
  /** The special date in effect today, if any (its reason names the holiday). */
  todayOverride?: HoursOverride | null;
  onSeeHours: () => void;
  onSeeSpecialDates: () => void;
  supportPhone?: string | null;
}

export function RightNow({ availability, restaurantId, timezone, noHours, todayOverride, onSeeHours, onSeeSpecialDates, supportPhone }: RightNowProps) {
  const headingId = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const { setConfirm } = useConsoleLayout();
  const [op, setOp] = useState<Op>(null);
  const [, setTick] = useState(0);
  const av = availability.data;
  const now = serverNow();

  // A pause ends by itself: re-read when its time passes (the stale copy covers the gap).
  const pauseUntil = av?.open_state === 'PAUSED' ? av.pause_until : null;
  useEffect(() => {
    if (!pauseUntil) return;
    const wait = Date.parse(pauseUntil) - serverNow();
    const id = window.setTimeout(() => {
      setTick((t) => t + 1);
      void availability.refresh();
    }, Math.max(0, wait) + 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseUntil]);

  useEffect(() => () => setConfirm(null), [setConfirm]);

  // Live: another screen, HalalGoes or the server changed the status. Only this event (never
  // a page load) raises the auto-off toast, and it names HalalGoes only when the event does.
  useRealtimeChannel(restaurantId ? channel.restaurant(restaurantId) : null, (signal) => {
    if (signal.kind === 'refetch') {
      void availability.refresh();
      return;
    }
    const ev = eventOfType(signal, 'restaurant.status_changed');
    if (!ev) return;
    // Events are signals, REST is truth: re-read the availability rather than patch it.
    const d = ev.data;
    void availability.refresh();
    if (!d.is_accepting_orders && d.open_state === 'CLOSED_TOGGLE' && /halalgoes|system/i.test(d.changed_by)) {
      toast.show({
        variant: 'warning',
        title: 'HalalGoes switched off new orders',
        description: d.reason ?? undefined,
        action: { label: 'Go to Orders', onAction: () => navigate('/orders') },
      });
    }
  });

  if (!av) {
    return (
      <section aria-labelledby={headingId} className="shrink-0 rounded-lg border border-line-decorative bg-surface-raised px-4 py-3">
        <h2 id={headingId} className="text-[20px] font-semibold">
          Right now
        </h2>
        {availability.status === 'error' ? (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-[15px] text-fg-primary">
              We couldn’t check whether you’re open.
            </p>
            <Button variant="tertiary" size="md" onPress={() => availability.reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <div aria-hidden="true" className="mt-2">
            <Skeleton variant="text" width="60%" />
          </div>
        )}
      </section>
    );
  }

  const state = nowState(av, { noHours, now });
  const badge = BADGE[state];
  const pauseLabel = av.pause_until ? formatTime(av.pause_until, timezone) : '';
  const busy = op?.phase === 'busy';

  const patch = async (kind: NonNullable<Op>['kind'], body: { is_accepting_orders: boolean; pause_until?: string | null }) => {
    setOp({ kind, phase: 'busy' });
    try {
      const next = await setAcceptingOrders(body);
      availability.mutate(() => next);
      setOp({ kind, phase: 'done' });
    } catch {
      setOp({ kind, phase: 'failed', until: pauseLabel });
      if (kind === 'off') {
        toast.show({
          variant: 'danger',
          title: 'Couldn’t turn off new orders',
          description: 'You are still accepting orders. Check your connection and try again.',
          action: { label: 'Try again', onAction: () => void patch('off', { is_accepting_orders: false }) },
        });
      }
    }
  };

  const turnOff = () =>
    setConfirm(
      <InlineConfirm
        icon="info"
        title="Stop accepting new orders?"
        body="Orders already waiting still need an answer. Customers can’t order until you turn this back on."
        cancel={{ label: 'Keep accepting', onPress: () => setConfirm(null) }}
        actions={[
          {
            label: 'Stop accepting',
            variant: 'secondary',
            onPress: () => {
              setConfirm(null);
              void patch('off', { is_accepting_orders: false });
            },
          },
        ]}
        testId="turn-off-confirm"
      />,
    );

  const resume = () =>
    setConfirm(
      <InlineConfirm
        icon="clock"
        title="Resume new orders now?"
        body={`New orders start ringing on this screen straight away. Your pause was set to end at ${pauseLabel}.`}
        cancel={{ label: 'Stay paused', onPress: () => setConfirm(null) }}
        actions={[
          {
            label: 'Resume now',
            variant: 'secondary',
            onPress: () => {
              setConfirm(null);
              void patch('resume', { is_accepting_orders: true, pause_until: null });
            },
          },
        ]}
        testId="resume-confirm"
      />,
    );

  // Reason line: the server's words, except where only the client knows the time.
  let reason: string = av.reason;
  let who = av.resolvable_by ? (WHO[av.resolvable_by] ?? '') : '';
  switch (state) {
    case 'open':
      who = 'You can pause new orders for a short time, or switch them off.';
      break;
    case 'paused':
      reason = `Paused until ${pauseLabel}.`;
      who = 'This changes by itself. Resume now to take orders straight away.';
      break;
    case 'paused_stale':
      reason = `Your pause ended at ${pauseLabel}. Updating this screen…`;
      who = 'If this doesn’t change within a minute, refresh.';
      break;
    case 'offline':
      who = 'You can change this. Orders only reach a screen with the Orders page open. Open it here to make this device your order screen.';
      break;
    case 'closed_holiday':
      if (todayOverride?.reason) reason = `Closed today: ${todayOverride.reason} (special date).`;
      who = WHO.TIME!;
      break;
    case 'closed_no_hours':
      reason = 'You have no opening hours set, so customers can’t order.';
      who = WHO.RESTAURANT!;
      break;
    case 'suspended':
      who = 'Only HalalGoes support can change this. Orders already in progress still complete.';
      break;
    case 'closed_hours':
      who = WHO.TIME!;
      break;
    default:
      break;
  }

  const onLabel: Record<NowState, string> = {
    open: 'On – accepting orders',
    paused: `On – paused until ${pauseLabel}`,
    paused_stale: `On – paused until ${pauseLabel}`,
    closed_toggle: 'On – accepting orders',
    auto_off: 'On – accepting orders',
    offline: 'On – no order screen',
    closed_hours: 'On – starts with your hours',
    closed_holiday: 'On – closed today',
    closed_no_hours: 'On – but you have no hours',
    suspended: 'On – locked while suspended',
  };

  const lines: ReactNode[] = [];
  if (state === 'open' && av.missed_order_count === 1) {
    lines.push(
      <p key="missed" className="flex items-start gap-2 text-[15px]">
        <span aria-hidden="true" className="mt-0.5 font-bold text-feedback-warning-icon">
          !
        </span>
        1 order timed out without an answer. One more in a row and new orders stop. Answer each order in the New orders strip within 3 minutes.
      </p>,
    );
  }
  if (state === 'closed_hours' && av.is_accepting_orders) {
    lines.push(
      <p key="why-line" className="text-[15px]">
        New orders is on. You’re closed because it’s outside your opening hours.
      </p>,
    );
  }
  if (state === 'closed_no_hours' && av.is_accepting_orders) {
    lines.push(
      <p key="no-hours" className="text-[15px]">
        New orders are switched on, but you have no hours, so none can arrive.
      </p>,
    );
  }

  const status = opLine(op);

  const actions: ReactNode[] = [];
  if (state === 'open') {
    actions.push(
      <Menu
        key="pause"
        label="Pause new orders"
        trigger={<span>{op?.kind === 'pause' && busy ? 'Pausing…' : 'Pause new orders'}</span>}
        variant="tonal"
        align="end"
        disabled={busy}
        items={PAUSES.map((m) => {
          const end = now + m * 60_000;
          return {
            key: `p${m}`,
            label: `Pause for ${m} minutes (until ${pauseEndLabel(end, now, timezone)})`,
            onSelect: () => void patch('pause', { is_accepting_orders: true, pause_until: new Date(serverNow() + m * 60_000).toISOString() }),
          };
        })}
        testId="pause-menu"
      />,
    );
  }
  if (state === 'paused') {
    actions.push(
      <Button key="resume" variant="tertiary" size="md" loading={op?.kind === 'resume' && busy} onPress={resume}>
        {op?.kind === 'resume' && busy ? 'Resuming…' : 'Resume now'}
      </Button>,
    );
  }
  if (state === 'paused_stale') {
    actions.push(
      <Button key="refresh" variant="tertiary" size="md" onPress={() => void availability.refresh()}>
        Refresh
      </Button>,
    );
  }
  if (state === 'offline') {
    actions.push(
      <Button key="orders" variant="primary" size="md" onPress={() => navigate('/orders')}>
        Open Orders on this device
      </Button>,
    );
  }
  if (state === 'closed_hours') {
    actions.push(
      <Button key="hours" variant="ghost" size="md" onPress={onSeeHours}>
        See your hours
      </Button>,
    );
  }
  if (state === 'closed_holiday') {
    actions.push(
      <Button key="dates" variant="ghost" size="md" onPress={onSeeSpecialDates}>
        See special dates
      </Button>,
    );
  }
  if (state === 'suspended' && supportPhone) {
    actions.push(
      <Button key="support" variant="tertiary" size="md" href={`tel:${supportPhone}`}>
        Contact support
      </Button>,
    );
  }

  const whyStep = WHY_STEP_OF[state];

  return (
    <section
      aria-labelledby={headingId}
      data-testid="right-now"
      data-state={state}
      className="shrink-0 rounded-lg border border-line-decorative bg-surface-raised px-4 py-3"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-[360px]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-[20px] font-semibold">
              Right now
            </h2>
            <Badge size="lg" {...badge} testId="right-now-badge" />
          </div>
          <p className="mt-1 text-[15px] leading-[21px] text-fg-primary">
            <span data-testid="right-now-reason">{reason}</span> {who ? <span className="text-fg-secondary">{who}</span> : null}
          </p>
          {lines}
          {status}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {actions}
          {state === 'closed_no_hours' ? null : (
            <div className="min-w-[260px]">
              <Switch
                label="New orders"
                checked={av.is_accepting_orders}
                loading={op?.kind === 'off' || op?.kind === 'on' ? busy : false}
                disabled={state === 'suspended' || busy}
                stateLabel={{ on: onLabel[state], off: 'Off – not accepting orders' }}
                onChange={(next) => (next ? void patch('on', { is_accepting_orders: true }) : turnOff())}
              />
            </div>
          )}
        </div>
      </div>
      {whyStep ? (
        <details className="mt-2 rounded-md border border-line-decorative">
          <summary className="hg-focus flex min-h-11 cursor-pointer items-center px-3 text-[15px] font-semibold">
            Why switching on doesn’t open you
          </summary>
          <div className="px-3 pb-3">
            <p className="text-[15px]">
              HalalGoes checks these in order and stops at the first one that applies. New orders is already on. You’re closed because of step {whyStep}.
            </p>
            <ol className="mt-2 list-decimal columns-2 gap-6 ps-5 text-[14px]">
              {WHY_STEPS.map((s, i) => (
                <li key={s} className={i + 1 === whyStep ? 'font-semibold text-fg-primary' : 'text-fg-secondary'}>
                  {s}
                  {i + 1 === whyStep ? ' — this is why you are closed now' : ''}
                </li>
              ))}
            </ol>
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** The result line under the reason (spec §3.3): status while in flight, alert on failure. */
function opLine(op: Op): ReactNode {
  if (!op) return null;
  const text: Record<string, string> = {
    'off:busy': 'Turning off new orders… The switch moves when HalalGoes confirms.',
    'off:done': 'Orders already waiting keep their countdown in the New orders strip. Answer them before it runs out.',
    'off:failed': 'Couldn’t turn off new orders. You are still accepting orders.',
    'on:busy': 'Turning on new orders… The switch moves when HalalGoes confirms.',
    'on:done': 'New orders are on again. Answer each order in the New orders strip within 3 minutes.',
    'on:failed': 'Couldn’t turn on new orders. You are still not accepting orders.',
    'pause:failed': 'Couldn’t pause new orders. You are still taking orders.',
    'resume:failed': `Couldn’t resume. You are still paused until ${op.until ?? ''}.`,
  };
  const msg = text[`${op.kind}:${op.phase}`];
  if (!msg) return null;
  return op.phase === 'failed' ? (
    <p role="alert" className="mt-1 text-[15px] font-semibold text-feedback-danger-text">
      {msg}
    </p>
  ) : (
    <p role="status" className="mt-1 text-[15px] text-fg-primary">
      {msg}
    </p>
  );
}

