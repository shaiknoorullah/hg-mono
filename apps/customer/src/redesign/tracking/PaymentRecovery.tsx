/**
 * The page for an order that is waiting on the customer's payment (the `Track-3DS` and
 * `Track-PaymentFailed` boards of the customer redesign, issue #921 under the redesign tracker #656).
 * It replaces the waiting page's body while the payment record says the order is stuck:
 *
 * - **Confirm with your bank** (3-D Secure): "Continue to your bank" resumes the challenge from the
 *   `client_secret` the payment record re-issues. The answer that matters is the server's: the page
 *   re-reads the payment and moves on when the card is authorised; the sheet closing is a hint.
 * - **Your payment didn't go through** (a decline): the headline comes from a fixed map of the
 *   server's decline codes (never the bank's text). "Choose another card" opens the card sheet; only
 *   its primary, then a reason in the cancel sheet, cancels the order. Cancelling puts the same items
 *   back in the cart (the server prices them again) and the chosen card is chosen at checkout.
 *
 * Not drawn, because the contract cannot do it: paying the same order with another card (a second
 * `createOrder` answers `409 ACTIVE_ORDER_EXISTS`) and the three-attempts count (issue #924).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { confirmPayment } from '../checkout/confirmPayment';
import { rememberNextCard } from '../checkout/nextCard';
import type { PayChoice } from '../checkout/Sheets';
import { Banner, Button, Card, Icon, StatusTimeline, useTheme, useTypeStyle } from '../ds';
import { cardName } from '../orders/format';
import { useServerNow } from '../lib/now';
import { formatTime } from '../lib/time';
import { CancelSheet } from './CancelSheet';
import { ChooseCardSheet } from './ChooseCardSheet';
import { RECOVERY_COPY, declineTitleOf, type Recovery } from './paymentRecovery';
import { usePutItemsBack } from './putItemsBack';
import type { TrackedOrder } from './trackingApi';

type BankNotice = 'closed' | 'failed' | { message: string } | null;

/** What the payment recovery page needs from the tracking page. */
export interface PaymentRecoveryProps {
  data: TrackedOrder;
  recovery: Recovery;
  /** Re-reads the order. */
  reload: () => void;
  /** The bank's check was completed: the page says the hold is being placed until the server moves on. */
  onBankConfirmed: () => void;
  /** The restaurant and its total, drawn by the tracking page so both pages share one card. */
  restaurantCard: React.ReactNode;
  /** Opens the Get help sheet. */
  onGetHelp?: () => void;
}

/** The body of the tracking page for an unpaid order that needs the customer (a bank check or a declined card). */
export function PaymentRecoveryBody({ data, recovery, reload, onBankConfirmed, restaurantCard, onGetHelp }: PaymentRecoveryProps): React.ReactElement {
  const theme = useTheme();
  const display = useTypeStyle('display.md');
  const body = useTypeStyle('body.md');
  const now = useServerNow(5_000);
  const { order, payment } = data;
  const card = payment ? cardName(payment) : null;
  const by = order.deadline_at ? formatTime(order.deadline_at) : null;
  const secondary = { color: theme.color.text.secondary };

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [chooseOpen, setChooseOpen] = React.useState(false);
  /** Set when the cancel sheet was opened from the card sheet: the cancel is a step to ordering again. */
  const [reorder, setReorder] = React.useState<{ choice: PayChoice; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<BankNotice>(null);
  const putBack = usePutItemsBack(order);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // If the items cannot be put back (a failure, or another restaurant's cart), the order is already
  // cancelled: the outcome page takes over with its own "Put these items back" and replace dialog.
  const putState = putBack.state.kind;
  React.useEffect(() => {
    if (putState === 'failed' || putState === 'replace') reload();
  }, [putState, reload]);

  const continueToBank = async () => {
    if (busy) return;
    if (!(recovery.kind === 'bank' && recovery.secret)) {
      // The secret is re-issued with the payment record: read it again.
      reload();
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await confirmPayment(order.id, recovery.secret);
      if (!live.current) return;
      switch (outcome.kind) {
        case 'authorised':
        case 'processing':
          onBankConfirmed();
          break;
        case 'closed':
          setNotice('closed');
          break;
        case 'needsAction':
          setNotice('failed');
          break;
        case 'unavailable':
          setNotice({ message: outcome.message });
          break;
        case 'declined':
          break;
      }
      reload();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const bankNotice =
    notice === null
      ? null
      : notice === 'closed'
        ? RECOVERY_COPY.bankClosed
        : notice === 'failed'
          ? RECOVERY_COPY.bankFailed
          : notice.message;

  const putting = putBack.state.kind === 'busy';

  return (
    <ScrollView contentContainerStyle={styles.page} testID="Recovery-body">
      <View style={styles.gap8}>
        <Text accessibilityRole="header" aria-level={1} style={[display, { color: theme.color.text.primary }]} testID="Recovery-h1">
          {recovery.kind === 'bank' ? RECOVERY_COPY.bankTitle : RECOVERY_COPY.failedTitle}
        </Text>
        {recovery.kind === 'bank' ? (
          <Text style={[body, secondary]} testID="Recovery-line">
            {`Your bank wants to check it's you before we can place the hold on your ${card ?? 'card'}.`}
          </Text>
        ) : null}
      </View>

      {recovery.kind === 'declined' ? (
        <Banner
          variant="neutral"
          icon={<Icon name="info" size={22} color={theme.color.text.primary} />}
          title={declineTitleOf(recovery.code, card)}
          description={RECOVERY_COPY.failedBody}
          testID="Recovery-declined"
        />
      ) : null}

      {by ? (
        <Text style={[body, { color: theme.color.text.primary }]} testID="Recovery-deadline">
          {recovery.kind === 'bank'
            ? `Your order waits until ${by}. If it isn't confirmed by then, it is cancelled and nothing is charged.`
            : `Your order waits until ${by}. After that it is closed and nothing is charged.`}
        </Text>
      ) : null}

      {recovery.kind === 'bank' ? (
        <Card variant="outlined" radius={16}>
          <StatusTimeline
            audience="customer"
            state={order.state}
            transitions={data.tracking?.timeline}
            deadlineAt={order.deadline_at}
            now={now}
            testID="Recovery-timeline"
          />
        </Card>
      ) : null}

      {restaurantCard}

      {bankNotice ? <Banner variant="neutral" title={bankNotice} testID="Recovery-notice" /> : null}
      {putting ? <Banner variant="neutral" title={RECOVERY_COPY.puttingBack} testID="Recovery-puttingBack" /> : null}

      <View style={styles.gap12} testID="Recovery-actions">
        {recovery.kind === 'bank' ? (
          <>
            <Button variant="primary" size="lg" fullWidth iconStart="lock" loading={busy} onPress={() => void continueToBank()} testID="Recovery-continue">
              {RECOVERY_COPY.bankContinue}
            </Button>
            <Button variant="ghost" size="md" fullWidth disabled={busy} onPress={() => setCancelOpen(true)} testID="Recovery-cancel">
              {RECOVERY_COPY.cancelOrder}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" fullWidth disabled={putting} onPress={() => setChooseOpen(true)} testID="Recovery-chooseCard">
              {RECOVERY_COPY.chooseAnother}
            </Button>
            <Button variant="ghost" size="md" fullWidth disabled={putting} onPress={() => setCancelOpen(true)} testID="Recovery-cancel">
              {RECOVERY_COPY.cancelLeave}
            </Button>
          </>
        )}
      </View>

      <ChooseCardSheet
        variant="live"
        open={chooseOpen}
        restaurantName={order.restaurant.name}
        declined={payment ? { brand: payment.card_brand ?? null, last4: payment.card_last4 ?? null } : null}
        onClose={() => setChooseOpen(false)}
        onConfirm={(choice, chosenLabel) => {
          setReorder({ choice, label: chosenLabel });
          setChooseOpen(false);
          setCancelOpen(true);
        }}
      />

      <CancelSheet
        order={order}
        open={cancelOpen}
        accepted={false}
        intro={reorder ? `After you cancel, we'll put your items back in your cart. ${reorder.label} is chosen when you pay.` : undefined}
        onClose={() => {
          setCancelOpen(false);
          // "Keep my order" from the reorder path returns to the card sheet.
          if (reorder) setChooseOpen(true);
          setReorder(null);
        }}
        onCancelled={() => {
          setCancelOpen(false);
          if (reorder) {
            rememberNextCard(reorder.choice);
            putBack.run(false);
          } else {
            reload();
          }
        }}
        onWindowClosed={() => {
          setCancelOpen(false);
          setReorder(null);
          reload();
        }}
        onGetHelp={() => {
          setCancelOpen(false);
          onGetHelp?.();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 14 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
});
