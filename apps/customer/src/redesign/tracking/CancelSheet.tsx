/**
 * The cancel sheet, and what replaces it when cancelling is no longer possible (the `Cancel-*`
 * boards of the customer redesign, tracked in issue #921 under the redesign tracker #656).
 *
 * Cancelling is free only until the restaurant accepts: the authorisation is voided, so nothing was
 * charged and there is no refund to fail. The sheet:
 * - opens with no reason chosen and never fills one in for the customer;
 * - validates on press, not by disabling the button: no reason shows the group's error, "Something
 *   else" needs a note of 5 to 200 characters;
 * - while sending keeps the sheet open with the button busy and nothing else pressable;
 * - on a network or server failure keeps the reason and offers the same request again. The request
 *   carries one Idempotency-Key per reason-and-note, so pressing again can never cancel twice;
 * - when the restaurant accepts while it is open, swaps its content in place for the accepted
 *   message instead of closing under the customer's finger;
 * - on `409 CANCELLATION_WINDOW_CLOSED` hands over to the "too late" notice below.
 *
 * The helper line says what the button will do ("the hold is released"), never a result.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { idempotencyKey } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { cancelCheckoutOrder } from '../checkout/checkoutApi';
import { NOTE_LIMIT } from '../checkout/model';
import { Banner, Button, Card, Icon, Price, Radio, RadioGroup, Sheet, Skeleton, Textarea, useTheme, useTypeStyle } from '../ds';
import { errorCodeOf, errorStatusOf, useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import { cardName } from '../orders/format';
import { getOrderPayment, type OrderCustomerView } from '../orders/ordersApi';

type Reason = Schema['CustomerCancellationReasonCode'];

/** The customer's reasons, in the boards' order and words. */
export const CANCEL_REASON_OPTIONS: ReadonlyArray<{ value: Reason; label: string; description?: string }> = [
  { value: 'ORDERED_BY_MISTAKE', label: 'I ordered by mistake' },
  { value: 'TOO_LONG_WAIT', label: 'It is taking too long' },
  { value: 'WRONG_ADDRESS', label: 'The delivery address is wrong' },
  { value: 'CHANGED_MIND', label: 'I changed my mind' },
  { value: 'DUPLICATE_ORDER', label: 'I placed the same order twice' },
  { value: 'OTHER', label: 'Something else', description: 'You will be asked to say what' },
];

export const NOTE_MIN_LENGTH = 5;

export const CANCEL_COPY = {
  title: 'Cancel this order?',
  helperUnpaid: "Cancelling ends this order and nothing is charged. This can't be undone.",
  helperHeld: "If you cancel, the hold on your card is released and you won't be charged.",
  reasonLabel: 'Reason for cancelling',
  reasonError: 'Choose a reason to cancel',
  noteLabel: 'Tell us what happened (required)',
  noteError: 'Write at least 5 characters.',
  cancel: 'Cancel order',
  keep: 'Keep my order',
  failedTitle: "We couldn't cancel your order",
  failedBody: 'Your order is still active. Check your connection and try again.',
  acceptedBody1: 'They accepted it while you were choosing, so it can no longer be cancelled here. Your card has been charged for this order.',
  acceptedBody2: 'If something is wrong, get help and our team will look at it.',
  backToOrder: 'Back to my order',
  getHelp: 'Get help',
  closedTitle: "It's too late to cancel here",
  closedFooter: 'Cancelling is only free before the restaurant accepts.',
} as const;

export interface CancelSheetProps {
  order: OrderCustomerView;
  open: boolean;
  /** The order is no longer cancellable (a re-read says so) while the sheet is open. */
  accepted: boolean;
  onClose: () => void;
  /** The server cancelled the order. */
  onCancelled: () => void;
  /** The server answered that the window is closed. */
  onWindowClosed: () => void;
  onGetHelp: () => void;
  /**
   * A line above the helper that says where the customer goes next, when cancelling is a step on the
   * way to ordering again ("After you cancel, we'll put your items back in your cart. ...").
   */
  intro?: string;
}

export function CancelSheet({ order, open, accepted, onClose, onCancelled, onWindowClosed, onGetHelp, intro }: CancelSheetProps): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const [reason, setReason] = React.useState<Reason | null>(null);
  const [note, setNote] = React.useState('');
  const [phase, setPhase] = React.useState<'choosing' | 'sending' | 'failed'>('choosing');
  const [showReasonError, setShowReasonError] = React.useState(false);
  const [showNoteError, setShowNoteError] = React.useState(false);
  const attempt = React.useRef<{ sig: string; key: string } | null>(null);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The sheet always opens with nothing chosen.
  React.useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
      setPhase('choosing');
      setShowReasonError(false);
      setShowNoteError(false);
      attempt.current = null;
    }
  }, [open]);

  const sending = phase === 'sending';
  const trimmed = note.trim();
  const noteOk = trimmed.length >= NOTE_MIN_LENGTH && trimmed.length <= NOTE_LIMIT;

  const send = async () => {
    if (sending) return;
    if (!reason) {
      setShowReasonError(true);
      return;
    }
    if (reason === 'OTHER' && !noteOk) {
      setShowNoteError(true);
      return;
    }
    const sentNote = reason === 'OTHER' ? trimmed : null;
    // One key per reason-and-note: a repeat of the same request reuses it, a changed one gets its own.
    const sig = `${reason}|${sentNote ?? ''}`;
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { sig, key: idempotencyKey() };
    setPhase('sending');
    try {
      await cancelCheckoutOrder({ orderId: order.id, reason, note: sentNote, idempotencyKey: attempt.current.key });
      if (!live.current) return;
      onCancelled();
    } catch (e) {
      if (!live.current) return;
      const code = errorCodeOf(e);
      if (code === 'CANCELLATION_WINDOW_CLOSED' || code === 'ILLEGAL_TRANSITION' || errorStatusOf(e) === 409) {
        setPhase('choosing');
        onWindowClosed();
        return;
      }
      setPhase('failed');
    }
  };

  const helper = order.state === 'CREATED' ? CANCEL_COPY.helperUnpaid : CANCEL_COPY.helperHeld;

  if (accepted) {
    return (
      <Sheet open={open} title={`${order.restaurant.name} has accepted your order`} onClose={onClose} testID="Cancel-accepted">
        <View style={styles.sheet}>
          <View accessibilityRole="alert" style={styles.gap8}>
            <Text style={[body, { color: theme.color.text.primary }]}>{CANCEL_COPY.acceptedBody1}</Text>
            <Text style={[body, { color: theme.color.text.primary }]}>{CANCEL_COPY.acceptedBody2}</Text>
          </View>
          <View style={styles.gap12}>
            <Button variant="primary" size="lg" fullWidth onPress={onClose} testID="Cancel-backToOrder">
              {CANCEL_COPY.backToOrder}
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={onGetHelp} testID="Cancel-getHelp">
              {CANCEL_COPY.getHelp}
            </Button>
          </View>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} title={CANCEL_COPY.title} onClose={() => (sending ? undefined : onClose())} dismissible={!sending} testID="Cancel-sheet">
      <View style={styles.sheet}>
        {phase === 'failed' ? (
          <Banner variant="warning" title={CANCEL_COPY.failedTitle} description={CANCEL_COPY.failedBody} testID="Cancel-failed" />
        ) : null}
        {intro ? (
          <Text style={[body, { color: theme.color.text.primary }]} testID="Cancel-intro">
            {intro}
          </Text>
        ) : null}
        <Text style={[body, { color: theme.color.text.secondary }]}>{helper}</Text>
        <RadioGroup
          name="cancel-reason"
          label={CANCEL_COPY.reasonLabel}
          required
          value={reason}
          disabled={sending}
          errorText={showReasonError && !reason ? CANCEL_COPY.reasonError : undefined}
          onChange={(v) => {
            setReason(v as Reason);
            setShowReasonError(false);
          }}
          testID="Cancel-reasons"
        >
          {CANCEL_REASON_OPTIONS.map((r) => (
            <Radio key={r.value} value={r.value} label={r.label} description={r.description} testID={`Cancel-reason-${r.value}`} />
          ))}
        </RadioGroup>
        {reason === 'OTHER' ? (
          <Textarea
            label={CANCEL_COPY.noteLabel}
            required
            value={note}
            maxLength={NOTE_LIMIT}
            errorText={showNoteError && !noteOk ? CANCEL_COPY.noteError : null}
            readOnly={sending}
            onChange={(v) => {
              setNote(v);
              if (v.trim().length >= NOTE_MIN_LENGTH) setShowNoteError(false);
            }}
            testID="Cancel-note"
          />
        ) : null}
        <View style={styles.gap12}>
          <Button
            variant="danger"
            size="lg"
            fullWidth
            destructive
            loading={sending}
            onPress={() => void send()}
            testID="Cancel-confirm"
          >
            {CANCEL_COPY.cancel}
          </Button>
          <Button variant="ghost" size="md" fullWidth disabled={sending} onPress={onClose} testID="Cancel-keep">
            {CANCEL_COPY.keep}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

/**
 * "It's too late to cancel here": the 409 answer. Says when the restaurant accepted and, from the
 * payment record, that the card was charged and how much, so the moment money moved is explicit.
 */
export function CancelWindowClosed({ order, onGetHelp }: { order: OrderCustomerView; onGetHelp: () => void }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const { query, reload } = useQuery(() => getOrderPayment(order.id), [order.id]);
  const payment = query.kind === 'ready' ? query.data : null;
  const charged = payment && payment.amount_captured_cents > 0 ? payment : null;
  const accepted = order.accepted_at ? ` at ${formatTime(order.accepted_at)}, just before your request reached us` : '';

  return (
    <View style={styles.notice} testID="Cancel-windowClosed">
      <Banner
        variant="info"
        title={CANCEL_COPY.closedTitle}
        description={`${order.restaurant.name} accepted your order${accepted}.${charged ? ' Your card has now been charged.' : ''} If you still need to change something, get help.`}
        testID="Cancel-closedBanner"
      />
      {query.kind === 'loading' ? (
        <Card variant="outlined" radius={16}>
          <Skeleton variant="text" lines={1} />
        </Card>
      ) : charged ? (
        <Card variant="outlined" radius={16} testID="Cancel-charge">
          <View style={styles.row}>
            <Text style={[label, styles.flex1, { color: theme.color.text.primary }]}>{`Charged to ${cardName(charged) ?? 'your card'}`}</Text>
            <Price cents={charged.amount_captured_cents} size="md" />
          </View>
        </Card>
      ) : query.kind === 'error' ? (
        <Card variant="outlined" radius={16} testID="Cancel-chargeError">
          <View style={styles.gap8}>
            <Text style={[label, { color: theme.color.text.primary }]}>We couldn&apos;t load the charge</Text>
            <Button variant="tertiary" size="md" onPress={reload} testID="Cancel-chargeRetry">
              Try again
            </Button>
          </View>
        </Card>
      ) : null}
      <Button variant="tertiary" size="md" fullWidth onPress={onGetHelp} testID="Cancel-closedHelp">
        {CANCEL_COPY.getHelp}
      </Button>
      <View style={styles.row}>
        <Icon name="info" size={16} color={theme.color.text.secondary} />
        <Text style={[small, styles.flex1, { color: theme.color.text.secondary }]}>{CANCEL_COPY.closedFooter}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingBottom: 16 },
  notice: { gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
