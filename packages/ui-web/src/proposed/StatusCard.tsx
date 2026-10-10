/**
 * `StatusCard` — the restaurant's "Right now": is it taking orders, and the two controls that
 * change that (approval packet P34; Menu & Hours canvas `PartNowCard`, Live Orders canvas
 * `Board-paused`, `Board-pause-menu`, `Board-resume-confirm`, `Board-turn-off-confirm`,
 * `Board-auto-off`). Proposed: awaiting the owner's approval.
 *
 * - The open-state Badge ("Open", "Paused", "Closed", "Not accepting orders", …) and the
 *   server's reason, word for word, with who can change it.
 * - The Orders Switch with its required `stateLabel`. It moves only when HalalGoes confirms
 *   (`busy` holds it in place with a spinner). Turning it off asks first, in the page: "Stop
 *   accepting new orders?" with first focus on "Keep accepting".
 * - The pause Menu: each length is a `menuitemradio` ("Pause for 15 minutes (until 7:25 pm)").
 *   While paused it becomes "Resume now", which asks first: "Resume new orders now?" with first
 *   focus on "Stay paused".
 * - `layout="bar"` is the Live Orders status bar (one row, no heading); `card` is the "Right now"
 *   card on Hours and Settings.
 *
 * Every tone is neutral, info or warning; none is danger, and none is a success fill. Times are
 * 12-hour through the one shared formatter.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import type { RestaurantOpenState } from '@hg/api-client';

import { Badge, type BadgeVariant } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import type { DsIconName } from '../ds/Icon.js';
import { Icon } from '../ds/Icon.js';
import { Menu, type MenuItem } from '../ds/Menu.js';
import { Switch } from '../ds/Switch.js';
import { formatTime12h } from '../ds/time.js';
import { cn } from '../lib/utils.js';
import { InlineConfirm } from './InlineConfirm.js';

/** What the card shows. The packet's four plus the console's other open states. */
export type StatusCardStatus =
  | 'open'
  | 'paused'
  | 'closed'
  | 'closed-today'
  | 'switched-off'
  | 'auto-off'
  | 'offline'
  | 'suspended'
  | 'unknown';

/** Which control is waiting for HalalGoes to confirm. `true` means the switch. */
export type StatusCardBusy = boolean | 'toggle' | 'pause' | 'resume';

/** One pause length in the menu. */
export interface StatusCardPauseOption {
  /** Minutes, or `closing` for "until closing". */
  minutes: number | 'closing';
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

/** Props of `StatusCard`. */
export interface StatusCardProps {
  /** The open state to show. Default: from `openState`, else `unknown`. */
  status?: StatusCardStatus;
  /** The contract's `RestaurantOpenState`, when `status` is not given. */
  openState?: RestaurantOpenState | null;
  /** The server's reason, shown word for word (`RestaurantAvailability.reason`). */
  reason?: string | null;
  /** The second sentence: who can change it ("You can change this."). */
  who?: string | null;
  /** The stored toggle (`is_accepting_orders`). Default: off only when switched off or auto-off. */
  accepting?: boolean;
  /** `pause_until` (RFC 3339): "Paused until 7:10 pm." */
  pausedUntil?: string | null;
  /** Today's closing time (RFC 3339) for "Pause until closing (11:00 pm)". */
  closingAt?: string | null;
  /** Offer "Pause until closing". Default true; it needs `onPauseUntilClosing`. */
  pauseUntilClosing?: boolean;
  /** The lengths in the pause menu. Default 15, 30 and 60 minutes, then until closing. */
  pauseOptions?: readonly StatusCardPauseOption[];
  /** The switch: true turns orders on; false (after the in-page confirm) turns them off. */
  onToggle?: (accepting: boolean) => void;
  /** A pause length was chosen. */
  onPause?: (minutes: number) => void;
  onPauseUntilClosing?: () => void;
  /** Resume now (after the in-page confirm). */
  onResume?: () => void;
  /** A request is in flight: its control holds its place with a spinner. */
  busy?: StatusCardBusy;
  /** Why the last change failed ("Couldn’t pause new orders. You are still taking orders."). */
  errorText?: string | null;
  /** Ask before turning orders off. Default true. */
  confirmTurnOff?: boolean;
  /** Ask before resuming. Default true. */
  confirmResume?: boolean;
  /** `card` (default) or the Live Orders status `bar`. */
  layout?: 'card' | 'bar';
  /** Default "Right now". */
  heading?: string;
  /** The switch's label. Default "New orders" (card), "Orders" (bar). */
  switchLabel?: string;
  /** The switch's required state words. Default "Accepting orders" / "Not accepting orders". */
  stateLabel?: { on: string; off: string };
  /** Extra lines under the reason (a missed-order warning, the sound line). */
  children?: ReactNode;
  /** Zone for the 12-hour times. Default America/Toronto. */
  timeZone?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

interface StatusLook {
  badge: string;
  variant: BadgeVariant;
  icon: DsIconName;
  /** The reason when the server gave none. */
  fallback: string;
}

/** Never `danger`: being closed is not an error. */
const LOOK: Record<StatusCardStatus, StatusLook> = {
  open: { badge: 'Open', variant: 'info', icon: 'check', fallback: 'You are open and taking orders.' },
  paused: { badge: 'Paused', variant: 'warning', icon: 'clock', fallback: 'New orders are paused.' },
  closed: { badge: 'Closed', variant: 'neutral', icon: 'clock', fallback: 'Outside your opening hours.' },
  'closed-today': { badge: 'Closed today', variant: 'neutral', icon: 'clock', fallback: 'A special date closes you today.' },
  'switched-off': { badge: 'Not accepting orders', variant: 'neutral', icon: 'info', fallback: 'New orders are switched off.' },
  'auto-off': {
    badge: 'Not accepting orders',
    variant: 'neutral',
    icon: 'info',
    fallback: 'New orders were switched off after 2 orders in a row timed out.',
  },
  offline: { badge: 'Not receiving orders', variant: 'warning', icon: 'warning', fallback: 'No order screen has checked in for 5 minutes.' },
  suspended: { badge: 'Suspended', variant: 'neutral', icon: 'lock', fallback: 'Your account is suspended.' },
  unknown: { badge: 'Checking…', variant: 'neutral', icon: 'refresh', fallback: 'Checking whether you are open.' },
};

const FROM_OPEN_STATE: Record<RestaurantOpenState, StatusCardStatus> = {
  OPEN: 'open',
  PAUSED: 'paused',
  CLOSED_HOURS: 'closed',
  CLOSED_HOLIDAY: 'closed-today',
  CLOSED_TOGGLE: 'switched-off',
  CLOSED_OFFLINE: 'offline',
  CLOSED_SUSPENDED: 'suspended',
};

/** The card's status for a contract open state (`auto-off` needs the caller: it is CLOSED_TOGGLE). */
export function statusFromOpenState(state: RestaurantOpenState | null | undefined): StatusCardStatus {
  return state ? (FROM_OPEN_STATE[state] ?? 'unknown') : 'unknown';
}

const DEFAULT_LENGTHS = [15, 30, 60] as const;

/** "Right now"; see the module comment. */
export function StatusCard({
  status: statusProp,
  openState,
  reason,
  who,
  accepting: acceptingProp,
  pausedUntil,
  closingAt,
  pauseUntilClosing = true,
  pauseOptions,
  onToggle,
  onPause,
  onPauseUntilClosing,
  onResume,
  busy = false,
  errorText,
  confirmTurnOff = true,
  confirmResume = true,
  layout = 'card',
  heading = 'Right now',
  switchLabel,
  stateLabel = { on: 'Accepting orders', off: 'Not accepting orders' },
  children,
  timeZone,
  testId = 'StatusCard',
  style,
}: StatusCardProps) {
  const status = statusProp ?? statusFromOpenState(openState);
  const look = LOOK[status] ?? LOOK.unknown;
  const [asking, setAsking] = useState<'off' | 'resume' | null>(null);
  const accepting = acceptingProp ?? !(status === 'switched-off' || status === 'auto-off');
  const until = pausedUntil ? formatTime12h(pausedUntil, { timeZone }) : null;
  const switchBusy = busy === true || busy === 'toggle';
  const locked = status === 'suspended' || status === 'unknown';
  const isBar = layout === 'bar';

  const options = useMemo<readonly StatusCardPauseOption[]>(() => {
    if (pauseOptions) return pauseOptions;
    const at = (minutes: number) => formatTime12h(Date.now() + minutes * 60_000, { timeZone });
    const lengths: StatusCardPauseOption[] = DEFAULT_LENGTHS.map((m) => ({
      minutes: m,
      label: `Pause for ${m} minutes${at(m) ? ` (until ${at(m)})` : ''}`,
    }));
    if (pauseUntilClosing && onPauseUntilClosing) {
      const closing = closingAt ? formatTime12h(closingAt, { timeZone }) : null;
      lengths.push({ minutes: 'closing', label: closing ? `Pause until closing (${closing})` : 'Pause until closing' });
    }
    return lengths;
  }, [pauseOptions, pauseUntilClosing, onPauseUntilClosing, closingAt, timeZone]);

  const items: MenuItem[] = options.map((o, i) => ({
    type: 'radio',
    key: String(o.minutes),
    label: o.label,
    checked: false,
    disabled: o.disabled,
    disabledReason: o.disabledReason,
    separatorBefore: o.minutes === 'closing' && i > 0,
  }));

  const choosePause = (key: string) => {
    if (key === 'closing') onPauseUntilClosing?.();
    else onPause?.(Number(key));
  };

  const reasonText = reason ?? (status === 'paused' && until ? `Paused until ${until}.` : look.fallback);
  const badge = <Badge variant={look.variant} size="lg" icon={look.icon} label={look.badge} />;

  const controls = (
    <div className={cn('flex shrink-0 flex-wrap items-center gap-3', isBar ? 'ms-auto' : undefined)}>
      {status === 'paused' ? (
        <Button
          variant="tertiary"
          size="md"
          loading={busy === 'resume'}
          disabled={switchBusy}
          onPress={() => (confirmResume ? setAsking('resume') : onResume?.())}
        >
          {busy === 'resume' ? 'Resuming…' : 'Resume now'}
        </Button>
      ) : (
        <Menu
          label="Pause new orders"
          triggerText={busy === 'pause' ? 'Pausing…' : isBar ? 'Pause' : 'Pause new orders'}
          triggerVariant="tonal"
          align="end"
          items={items}
          disabled={!accepting || locked || status !== 'open' || busy !== false}
          onSelect={(key) => choosePause(key)}
        />
      )}
      <Switch
        label={switchLabel ?? (isBar ? 'Orders' : 'New orders')}
        stateLabel={stateLabel}
        checked={accepting}
        loading={switchBusy}
        disabled={locked}
        onCheckedChange={(next) => {
          if (next) onToggle?.(true);
          else if (confirmTurnOff) setAsking('off');
          else onToggle?.(false);
        }}
      />
    </div>
  );

  const confirm =
    asking === 'off' ? (
      <InlineConfirm
        title="Stop accepting new orders?"
        prompt="Orders already waiting still need an answer. Customers can’t order until you turn this back on."
        cancelLabel="Keep accepting"
        confirmLabel="Stop accepting"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          onToggle?.(false);
        }}
      />
    ) : asking === 'resume' ? (
      <InlineConfirm
        title="Resume new orders now?"
        prompt={`New orders start ringing on this screen straight away.${until ? ` Your pause was set to end at ${until}.` : ''}`}
        cancelLabel="Stay paused"
        confirmLabel="Resume now"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          onResume?.();
        }}
      />
    ) : null;

  const error = errorText ? (
    <p role="alert" className="m-0 flex items-center gap-1.5 text-body-sm font-semibold text-feedback-danger-text">
      <Icon name="error" size={16} className="shrink-0" />
      {errorText}
    </p>
  ) : null;

  if (isBar) {
    return (
      <div data-testid={testId} data-status={status} style={style} className="flex flex-col gap-2 font-ui text-fg-primary">
        <div role="region" aria-label="Service status" className="flex flex-wrap items-center gap-3">
          {badge}
          <span className="text-body-md text-fg-secondary">{reasonText}</span>
          {controls}
        </div>
        {error}
        {confirm}
      </div>
    );
  }

  return (
    <section
      aria-label={heading}
      data-testid={testId}
      data-status={status}
      style={style}
      className="flex flex-col gap-3 rounded-lg border border-line-decorative bg-surface-raised p-4 font-ui text-fg-primary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-heading-md">{heading}</h2>
            {badge}
          </div>
          <p className="m-0 text-body-md">
            {reasonText} {who ? <span className="text-fg-secondary">{who}</span> : null}
          </p>
          {children}
          {error}
        </div>
        {controls}
      </div>
      {confirm}
    </section>
  );
}
