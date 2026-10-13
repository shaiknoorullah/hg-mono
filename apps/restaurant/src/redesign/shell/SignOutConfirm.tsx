/**
 * Account › "Sign out…" (LO `Board-sign-out`, `Board-sign-out-off`): an inline confirm in the
 * page, never a dialog. First focus and Escape: "Stay signed in".
 */
import { useState } from 'react';
import { InlineConfirm, useToast } from '../ds';
import { setAcceptingOrders, useAvailability } from '../data/availability';

export interface SignOutConfirmProps {
  onStay: () => void;
  onSignOut: () => Promise<void>;
}

export function SignOutConfirm({ onStay, onSignOut }: SignOutConfirmProps) {
  const availability = useAvailability();
  const { show: toast } = useToast();
  const [busy, setBusy] = useState<'stop' | 'out' | null>(null);
  // Unknown open state counts as accepting: the cautious copy is the one that asks to stop.
  const accepting = availability.data?.is_accepting_orders ?? true;

  const signOut = async () => {
    setBusy('out');
    await onSignOut();
  };

  if (!accepting) {
    return (
      <InlineConfirm
        testId="sign-out-confirm"
        icon="info"
        title="Sign out of this screen?"
        body="You’re not accepting orders, so no new orders will come. Orders already accepted are not affected."
        cancel={{ label: 'Stay signed in', onPress: onStay }}
        actions={[{ label: 'Sign out', variant: 'secondary', onPress: () => void signOut(), loading: busy === 'out' }]}
      />
    );
  }

  return (
    <InlineConfirm
      testId="sign-out-confirm"
      icon="warning"
      title="Stop orders before you sign out?"
      body="If you sign out while accepting, new orders can still come in for up to 5 minutes. Nobody will answer them, and customers wait 3 minutes each for nothing."
      cancel={{ label: 'Stay signed in', onPress: onStay }}
      actions={[
        { label: 'Sign out anyway', variant: 'ghost', onPress: () => void signOut(), loading: busy === 'out' },
        {
          label: 'Stop accepting and sign out',
          variant: 'secondary',
          loading: busy === 'stop',
          onPress: async () => {
            setBusy('stop');
            try {
              await setAcceptingOrders({ is_accepting_orders: false });
            } catch {
              // Never sign out with orders still on: the owner would think they had stopped.
              setBusy(null);
              toast({ variant: 'danger', title: 'Couldn’t turn off new orders', description: 'You are still accepting orders and still signed in. Try again.' });
              return;
            }
            await onSignOut();
          },
        },
      ]}
    />
  );
}
