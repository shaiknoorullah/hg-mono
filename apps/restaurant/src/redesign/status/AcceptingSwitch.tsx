/**
 * The "Accepting orders" switch on the compact new-orders strip (Settings and Payouts, board
 * `PartNewOrders`), where the service status bar's Orders switch would be. It shows the stored
 * `is_accepting_orders` and moves only when the server confirms (see `useAcceptingOrders`). A
 * suspended or unknown restaurant gets it disabled with the reason beneath, never a switch that
 * looks usable. Pause is not drawn on these pages; it stays on Live orders, Menu and Hours.
 */
import { Switch } from '../ds';
import { useFirstLoadFailed } from '../shell/stale';
import { useAcceptingOrders } from './acceptingOrders';
import { openStateView } from './openState';
import { useHalalBadge } from './useHalalBadge';

export function AcceptingSwitch() {
  const { availability, pending, turnOn, askTurnOff } = useAcceptingOrders();
  const pageLoadFailed = useFirstLoadFailed();
  const { halal } = useHalalBadge();
  const view = pageLoadFailed
    ? openStateView(null, { status: 'error' })
    : openStateView(availability.data, { status: availability.status, halalBlocked: halal?.blocksOrdering });
  const help = pending === 'on' ? 'Turning on…' : view.orders.help;
  return (
    <Switch
      className="min-w-[220px] max-w-[288px]"
      label="Accepting orders"
      checked={view.orders.checked}
      stateLabel={{ on: 'On', off: 'Off' }}
      description={help ?? undefined}
      disabled={view.orders.disabled}
      loading={pending === 'on' || pending === 'off'}
      onChange={(next) => (next ? void turnOn() : askTurnOff())}
    />
  );
}
