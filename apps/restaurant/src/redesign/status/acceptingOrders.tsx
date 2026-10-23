/**
 * Turning orders on and off, shared by the two places the console draws the Orders switch: the
 * service status bar (`StatusBar`) and the compact new-orders strip on Settings and Payouts
 * (`AcceptingSwitch`).
 *
 * - The switch moves only when the server confirms: it renders `is_accepting_orders` as read
 *   back from the PATCH response, and shows loading while the call is in flight.
 * - Turning orders off confirms in the page (InlineConfirm under the app bar, first focus on the
 *   least-change button). Turning on needs no confirm.
 * - `restaurant.status_changed` (another screen, the server's auto-off, or an admin) updates it.
 */
import { useCallback, useRef, useState } from 'react';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { InlineConfirm, useToast } from '../ds';
import { useConsole } from '../data/console';
import { isOutsideTradingHours, setAcceptingOrders, useAvailability, type Availability, type AvailabilityWrite } from '../data/availability';
import { useConsoleLayout } from '../shell/layout';

export type AcceptingWrite = 'on' | 'off' | 'pause' | 'resume';

export function useAcceptingOrders() {
  const { core } = useConsole();
  const availability = useAvailability();
  const toast = useToast();
  const { setConfirm } = useConsoleLayout();
  const [pending, setPending] = useState<null | AcceptingWrite>(null);
  // The last write was refused because the restaurant is outside its trading hours.
  const outsideHours = useRef(false);

  const restaurantId = core.data?.restaurantId ?? null;
  const { mutate, refresh } = availability;

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

  const write = useCallback(
    async (body: AvailabilityWrite, kind: AcceptingWrite) => {
      setPending(kind);
      try {
        const next: Availability = await setAcceptingOrders(body);
        mutate(() => next);
        return true;
      } catch (err) {
        outsideHours.current = isOutsideTradingHours(err);
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

  return { availability, pending, write, turnOn, askTurnOff, outsideHours };
}
