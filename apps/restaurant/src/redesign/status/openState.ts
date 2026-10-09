/**
 * The status bar's open state (LO §3.1; wp4 spec §3.1): ONE pure function from the server's
 * `RestaurantAvailability` to what the badge, reason, Orders switch and Pause control show.
 *
 * The server evaluates the open state in strict precedence and sends the winner; the client
 * never recomputes it (`OPEN_STATE_PRECEDENCE` documents the order and drives the table
 * test). The reason line is `availability.reason` verbatim: the client never invents one.
 */
import type { Schema } from '@hg/api-client';
import type { BadgeVariant, IconName } from '../ds';

export type Availability = Schema['RestaurantAvailability'];
export type OpenState = Schema['RestaurantOpenState'];

/** Server precedence, strongest first (R-22). */
export const OPEN_STATE_PRECEDENCE: readonly OpenState[] = [
  'CLOSED_SUSPENDED',
  'CLOSED_OFFLINE',
  'CLOSED_TOGGLE',
  'PAUSED',
  'CLOSED_HOLIDAY',
  'CLOSED_HOURS',
  'OPEN',
];

export interface OpenStateView {
  /** The open state this view is for; `null` while unknown (loading, failed, unrecognised). */
  state: OpenState | null;
  badge: { label: string; variant: BadgeVariant; icon?: IconName };
  /** Verbatim from the server, or the shell's own copy for unknown/offline. */
  reason: string | null;
  orders: {
    checked: boolean;
    disabled: boolean;
    help: string | null;
    stateLabel: { on: string; off: string };
  };
  /** The Pause control: the menu (enabled or not), or "Resume now" while paused. */
  pause: 'menu' | 'menu-disabled' | 'resume';
  /** Turned off by the server after orders timed out in a row (`Board-auto-off`). */
  autoOff: boolean;
}

const LABELS = { on: 'Accepting orders', off: 'Not accepting orders' } as const;

export interface OpenStateContext {
  /** The availability read's status (`useServerResource`). */
  status: 'loading' | 'ready' | 'stale' | 'error';
  /** The suspension is the halal certificate's (expired / being checked / not accepted). */
  halalBlocked?: boolean;
}

export function openStateView(a: Availability | null, ctx: OpenStateContext): OpenStateView {
  if (!a) {
    const word = ctx.status === 'error' ? 'Unknown' : 'Checking…';
    return {
      state: null,
      badge: { label: word, variant: 'neutral' },
      reason: null,
      orders: { checked: false, disabled: true, help: 'Available once orders load', stateLabel: { on: word, off: word } },
      pause: 'menu-disabled',
      autoOff: false,
    };
  }
  const checked = a.is_accepting_orders;
  const reason = a.reason || null;
  const base = { state: a.open_state, reason, autoOff: false };
  switch (a.open_state) {
    case 'OPEN':
      return { ...base, badge: { label: 'Open', variant: 'info' }, orders: { checked, disabled: false, help: null, stateLabel: LABELS }, pause: 'menu' };
    case 'PAUSED':
      return {
        ...base,
        badge: { label: 'Paused', variant: 'warning', icon: 'clock' },
        orders: { checked, disabled: false, help: null, stateLabel: LABELS },
        pause: 'resume',
      };
    case 'CLOSED_TOGGLE':
      return {
        ...base,
        badge: { label: 'Closed', variant: 'neutral' },
        orders: { checked, disabled: false, help: null, stateLabel: LABELS },
        pause: 'menu-disabled',
        autoOff: (a.missed_order_count ?? 0) >= 2,
      };
    case 'CLOSED_HOURS':
      return {
        ...base,
        badge: { label: 'Closed', variant: 'neutral' },
        orders: { checked, disabled: false, help: checked ? 'On, but closed by your hours' : null, stateLabel: LABELS },
        pause: 'menu',
      };
    case 'CLOSED_HOLIDAY':
      return {
        ...base,
        badge: { label: 'Closed', variant: 'neutral' },
        orders: { checked, disabled: false, help: checked ? 'On, but closed today by your date override' : null, stateLabel: LABELS },
        pause: 'menu',
      };
    case 'CLOSED_SUSPENDED':
      return {
        ...base,
        badge: { label: 'Closed', variant: 'neutral' },
        orders: {
          checked,
          disabled: true,
          help: ctx.halalBlocked ? 'Customers can’t order until your certificate is approved' : null,
          stateLabel: LABELS,
        },
        pause: 'menu-disabled',
      };
    case 'CLOSED_OFFLINE':
      // The shell's own copy (wp1 §5): open state can't be confirmed while this screen is offline.
      return {
        ...base,
        badge: { label: 'Unknown · this screen offline', variant: 'neutral' },
        reason: 'Can’t check while offline.',
        orders: { checked, disabled: false, help: checked ? 'On · can’t confirm while offline' : null, stateLabel: LABELS },
        pause: 'menu',
      };
    default:
      // An open state this build doesn't know: say so, never guess (assertNever fallback).
      return {
        state: null,
        badge: { label: 'Unknown', variant: 'neutral' },
        reason,
        orders: { checked, disabled: true, help: 'Available once orders load', stateLabel: LABELS },
        pause: 'menu-disabled',
        autoOff: false,
      };
  }
}
