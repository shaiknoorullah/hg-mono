/**
 * The go-live gate on /orders (LO `Board-gate`, `Board-gate-notif-denied`): browsers need a
 * user gesture before a page may play sound, and a kitchen screen that cannot ring is not a
 * working screen. The button is that gesture: it plays the test chime, arms the order alert,
 * asks for notification permission and requests a screen wake lock. It does NOT turn
 * accepting orders on or off (`is_accepting_orders` is the status bar's switch).
 *
 * Shown once per page load; the strip stays hidden behind it on this page.
 */
import { useState, type ReactNode } from 'react';
import { Button, Icon, InlineNotice } from '../ds';
import { useNewOrders } from '../strip/NewOrdersProvider';

export function OrdersGate({ children }: { children: ReactNode }) {
  const { gate } = useNewOrders();
  if (gate === 'passed') return <>{children}</>;
  return <GoLiveGate />;
}

function GoLiveGate() {
  const { gate, goLive, goLiveWithoutNotifications, checkNotificationsAgain } = useNewOrders();
  const [busy, setBusy] = useState(false);
  const denied = gate === 'denied';
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <section
        aria-labelledby="gate-title"
        data-testid="go-live-gate"
        className="flex w-[560px] max-w-full flex-col gap-3.5 rounded-xl border border-line-decorative bg-surface-raised p-7 shadow-md"
      >
        <Icon name="bell" size={40} weight="bold" className="text-brand-600" />
        <h2 id="gate-title" className="text-[24px] font-bold tracking-[-0.01em]">
          Turn on order sound and go live
        </h2>
        <p className="text-[17px] leading-[26px] text-fg-secondary">
          New orders ring on this screen. Each one keeps ringing until it is accepted, declined or times out after 3 minutes.
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 ps-[22px] text-[15px] leading-[21px]">
          <li>We play a test chime. Check you can hear it over the kitchen.</li>
          <li>Your browser asks to show notifications. Choose Allow.</li>
          <li>You start accepting orders.</li>
        </ol>
        {denied ? (
          <InlineNotice tone="warning" icon="warning" role="status" title="Step 2: notifications are blocked">
            The chime worked, so orders still ring while this screen is open and in front. If you switch to another tab or app, you won’t get an alert.
            Allow notifications in the browser’s site settings, then check again.
          </InlineNotice>
        ) : null}
        <Button
          variant="primary"
          size="xl"
          fullWidth
          loading={busy}
          iconStart={<Icon name="bell" size={22} />}
          onPress={() => {
            if (denied) {
              goLiveWithoutNotifications();
              return;
            }
            setBusy(true);
            void goLive().finally(() => setBusy(false));
          }}
        >
          {denied ? 'Go live without notifications' : 'Turn on sound and go live'}
        </Button>
        {denied ? (
          <Button variant="tertiary" size="lg" fullWidth onPress={checkNotificationsAgain}>
            Check notifications again
          </Button>
        ) : null}
        <p className="text-[15px] text-fg-secondary">
          Keep this screen open and on. If it closes or sleeps, new orders stop reaching you within 5 minutes.
        </p>
      </section>
    </div>
  );
}
