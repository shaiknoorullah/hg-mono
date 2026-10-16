/**
 * Checkout's sheets and its cancel dialog (boards `CC/Checkout-address-sheet`, `-address-empty`,
 * `-handover-sheet`, `-pay-sheet`, `-finish-profile`, `-declined-cancel`, `-cancel-states`).
 *
 * Each is owned by the checkout screen, not a route. They hold their own draft and hand the screen
 * a finished choice; none of them reads or sends an amount.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isApiError } from '@hg/api-client';

import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  Icon,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Sheet,
  Textarea,
  useTheme,
  useTypeStyle,
} from '../ds';
import { addressName } from '../restaurant/restaurant';
import type { Address } from '../ordering/cart';
import { getProfile, updateProfile } from '../account/accountApi';
import type { CancellationReason, PaymentMethod } from './checkoutApi';
import {
  CANCEL_REASONS,
  HANDOVERS,
  NOTE_LIMIT,
  NOTE_MIN,
  cancelReady,
  cardExpired,
  cardExpiry,
  cardName,
  type Handover,
} from './model';

/** "Unit 402 · Buzz 402 · Toronto ON M1R 4E7" (the line under the address name). */
export function addressDetail(a: Address): string {
  return [a.unit ? `Unit ${a.unit}` : null, a.buzzer ? `Buzz ${a.buzzer}` : null, `${a.city} ${a.province} ${a.postal_code}`]
    .filter(Boolean)
    .join(' · ');
}

/** "Home · 14 Ellesmere Rd", or just the street when the address has no label. */
export function addressTitle(a: Address): string {
  return a.label?.trim() ? `${a.label.trim()} · ${a.line1}` : (addressName(a) ?? a.line1);
}

/* --------------------------------------------------------------- address */

export function AddressSheet({
  addresses,
  selectedId,
  onPick,
  onAdd,
  onClose,
}: {
  addresses: readonly Address[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const none = addresses.length === 0;
  return (
    <Sheet open onClose={onClose} title="Deliver to" snapPoints={[none ? 0.6 : 0.75]} testID="Checkout-addressSheet">
      <View style={styles.sheet}>
        {none ? (
          <EmptyState
            variant="inline"
            headingLevel={2}
            illustration={<Icon name="map" size={32} color={theme.color.text.secondary} />}
            title="You haven't saved an address yet."
            primaryAction={{ label: 'Add an address', onPress: onAdd, testID: 'Checkout-addAddress' }}
            testID="Checkout-addressEmpty"
          />
        ) : (
          <>
            <RadioGroup
              name="checkout-address"
              label="Saved addresses"
              value={selectedId}
              onChange={(id) => {
                onPick(id);
                onClose();
              }}
              testID="Checkout-addressList"
            >
              {addresses.map((a) => (
                <Radio
                  key={a.id}
                  value={a.id}
                  label={addressTitle(a)}
                  description={`${addressDetail(a)}${a.is_default ? ' · Default' : ''}`}
                  testID={`Checkout-address-${a.id}`}
                />
              ))}
            </RadioGroup>
            <Text style={[small, { color: theme.color.text.secondary }]}>Changing the address prices the order again.</Text>
            <Button variant="tertiary" size="lg" fullWidth iconStart={<Icon name="plus" size={20} color={theme.color.text.primary} />} onPress={onAdd} testID="Checkout-addAddress">
              Add a new address
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}

/* -------------------------------------------------------------- handover */

export function HandoverSheet({
  value,
  onDone,
  onClose,
}: {
  value: Handover;
  onDone: (next: Handover) => void;
  onClose: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const [draft, setDraft] = React.useState<Handover>(value);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Handover"
      snapPoints={[0.88]}
      keyboardAvoiding
      footer={
        <View style={styles.footer}>
          <Button variant="primary" size="lg" fullWidth onPress={() => onDone(draft)} testID="Checkout-handoverDone">
            Done
          </Button>
        </View>
      }
      testID="Checkout-handoverSheet"
    >
      <View style={styles.sheet}>
        <RadioGroup
          name="checkout-handover"
          label="How should the rider hand it over?"
          value={draft.choice}
          onChange={(choice) => setDraft({ ...draft, choice: choice as Handover['choice'] })}
          testID="Checkout-handoverList"
        >
          {HANDOVERS.map((h) => (
            <Radio key={h.value} value={h.value} label={h.label} description={h.description} testID={`Checkout-handover-${h.value}`} />
          ))}
        </RadioGroup>
        <Text style={[label, { color: theme.color.text.primary }]}>Also (optional)</Text>
        <Checkbox label="Don't ring the bell" checked={draft.noRing} onChange={(noRing) => setDraft({ ...draft, noRing })} testID="Checkout-noRing" />
        <Checkbox label="Don't call me" checked={draft.noCall} onChange={(noCall) => setDraft({ ...draft, noCall })} testID="Checkout-noCall" />
        <Textarea
          label="Notes for the rider (optional)"
          value={draft.note}
          maxLength={NOTE_LIMIT}
          onChange={(note) => setDraft({ ...draft, note })}
          testID="Checkout-riderNote"
        />
      </View>
    </Sheet>
  );
}

/* ----------------------------------------------------------- pay with */

/** `null` is "a new card or a wallet in Stripe's own sheet" (no `payment_method_id` is sent). */
export type PayChoice = string | null;
const NEW = '__new__';

export function PaySheet({
  cards,
  now,
  value,
  onDone,
  onClose,
}: {
  cards: readonly PaymentMethod[];
  now: number;
  value: PayChoice;
  onDone: (next: PayChoice) => void;
  onClose: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const [draft, setDraft] = React.useState<string>(value ?? NEW);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Pay with"
      snapPoints={[0.8]}
      footer={
        <View style={styles.footer}>
          <Button variant="primary" size="lg" fullWidth onPress={() => onDone(draft === NEW ? null : draft)} testID="Checkout-payDone">
            {draft === NEW ? 'Pay with a new card or wallet' : `Pay with ${cardName(cards.find((c) => c.id === draft) ?? { brand: '', last4: '' })}`}
          </Button>
        </View>
      }
      testID="Checkout-paySheet"
    >
      <View style={styles.sheet}>
        <RadioGroup name="checkout-pay" label="Ways to pay" value={draft} onChange={setDraft} testID="Checkout-payList">
          {cards.map((c) => {
            const expired = cardExpired(c, now);
            return (
              <Radio
                key={c.id}
                value={c.id}
                label={cardName(c)}
                description={`${expired ? 'Expired' : 'Expires'} ${cardExpiry(c)}`}
                disabled={expired}
                disabledReason={expired ? 'This card has expired.' : undefined}
                testID={`Checkout-card-${c.id}`}
              />
            );
          })}
          <Radio
            value={NEW}
            label="New card or wallet"
            description="Stripe's secure sheet opens when you place the order. Apple Pay and Google Pay appear there when your device has them."
            testID="Checkout-card-new"
          />
        </RadioGroup>
        <Text style={[small, { color: theme.color.text.secondary }]}>HalalGoes never sees your card number.</Text>
      </View>
    </Sheet>
  );
}

/* -------------------------------------------------------- finish profile */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FinishProfileSheet({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }): React.ReactElement {
  const small = useTypeStyle('body.sm');
  const theme = useTheme();
  const [loading, setLoading] = React.useState(true);
  const [first, setFirst] = React.useState('');
  const [last, setLast] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [errors, setErrors] = React.useState<{ first?: string; last?: string; email?: string }>({});
  /** Only the fields the profile is missing are asked for (`PROFILE_INCOMPLETE` names none). */
  const [missing, setMissing] = React.useState({ first: true, last: true, email: true });

  React.useEffect(() => {
    let live = true;
    getProfile()
      .then((p) => {
        if (!live) return;
        setFirst(p.first_name ?? '');
        setLast(p.last_name ?? '');
        setEmail(p.email ?? '');
        setMissing({ first: !p.first_name?.trim(), last: !p.last_name?.trim(), email: !p.email?.trim() });
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const save = async (): Promise<void> => {
    const next: typeof errors = {};
    if (missing.first && !first.trim()) next.first = 'Enter your first name.';
    if (missing.last && !last.trim()) next.last = 'Enter your last name.';
    if (missing.email && !EMAIL_SHAPE.test(email.trim())) next.email = 'Enter an email like name@example.ca.';
    setErrors(next);
    setFailed(false);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      await updateProfile({
        ...(missing.first ? { first_name: first.trim() } : {}),
        ...(missing.last ? { last_name: last.trim() } : {}),
        ...(missing.email ? { email: email.trim() } : {}),
      });
      onSaved();
    } catch (e) {
      const details = isApiError(e) ? e.details : undefined;
      if (isApiError(e) && e.code === 'VALIDATION_FAILED' && Array.isArray(details)) {
        const fixed: typeof errors = {};
        for (const d of details) {
          if (d.field === 'email') fixed.email = 'Enter an email like name@example.ca.';
          else if (d.field === 'first_name') fixed.first = 'Enter your first name.';
          else if (d.field === 'last_name') fixed.last = 'Enter your last name.';
        }
        setErrors(fixed);
        if (Object.keys(fixed).length === 0) setFailed(true);
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Finish your profile"
      snapPoints={[0.86]}
      dismissible={!saving}
      keyboardAvoiding
      footer={
        <View style={styles.footer}>
          <Button variant="primary" size="lg" fullWidth loading={saving} disabled={loading} onPress={() => void save()} testID="Checkout-profileSave">
            {saving ? 'Saving…' : 'Save and continue'}
          </Button>
        </View>
      }
      testID="Checkout-profileSheet"
    >
      <View style={styles.sheet}>
        <Text style={[small, { color: theme.color.text.secondary }]}>
          We need your name and email to place the order. Your cart and price stay as they are.
        </Text>
        {failed ? <Banner variant="warning" title="We couldn't save your details. Try again." testID="Checkout-profileFailed" /> : null}
        {missing.first ? (
          <Input label="First name" required autoComplete="given-name" maxLength={50} value={first} onChange={setFirst} readOnly={saving} errorText={errors.first} testID="Checkout-profileFirst" />
        ) : null}
        {missing.last ? (
          <Input label="Last name" required autoComplete="family-name" maxLength={50} value={last} onChange={setLast} readOnly={saving} errorText={errors.last} testID="Checkout-profileLast" />
        ) : null}
        {missing.email ? (
          <Input
            label="Email"
            required
            variant="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={setEmail}
            readOnly={saving}
            helperText="For receipts. We send a link to confirm it."
            errorText={errors.email}
            testID="Checkout-profileEmail"
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- cancel */

export interface CancelDraft {
  reason: CancellationReason | null;
  note: string;
}

/**
 * "Cancel this order?" for an order that exists but isn't paid. Nothing is pre-selected; "Something
 * else" asks for a note of 5 to 200 characters. A failed cancel keeps the reason.
 */
export function CancelDialog({
  busy,
  failed,
  heldUntil,
  onCancel,
  onKeep,
}: {
  busy: boolean;
  failed: boolean;
  /** "7:01 pm", the order's deadline, for "try again before …". */
  heldUntil: string | null;
  onCancel: (draft: { reason: CancellationReason; note: string | null }) => void;
  onKeep: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const [reason, setReason] = React.useState<CancellationReason | null>(null);
  const [note, setNote] = React.useState('');
  const ready = cancelReady(reason, note);
  const tooShort = reason === 'OTHER' && note.trim().length > 0 && note.trim().length < NOTE_MIN;
  return (
    <Modal
      open
      onClose={onKeep}
      variant="dialog"
      destructive
      dismissible={!busy}
      title="Cancel this order?"
      description="Nothing was charged and nothing is held on your card."
      actions={[
        { label: 'Keep my order', onPress: onKeep, testID: 'Checkout-keepOrder' },
        {
          label: failed ? 'Try cancelling again' : 'Cancel order',
          destructive: true,
          testID: 'Checkout-confirmCancel',
          onPress: () => {
            if (reason && ready && !busy) onCancel({ reason, note: reason === 'OTHER' ? note.trim() : null });
          },
        },
      ]}
      testID="Checkout-cancelDialog"
    >
      <View style={styles.sheet}>
        {failed ? (
          <Banner
            variant="warning"
            title="We couldn't cancel the order"
            description={`Nothing has been charged. Your reason is kept${heldUntil ? `; try again before ${heldUntil}` : ''}.`}
            testID="Checkout-cancelFailed"
          />
        ) : null}
        <RadioGroup name="checkout-cancel-reason" label="Why are you cancelling?" required value={reason} onChange={(v) => setReason(v as CancellationReason)} disabled={busy} testID="Checkout-cancelReasons">
          {CANCEL_REASONS.map((r) => (
            <Radio key={r.value} value={r.value} label={r.label} testID={`Checkout-reason-${r.value}`} />
          ))}
        </RadioGroup>
        {reason === 'OTHER' ? (
          <Textarea
            label="Tell us what happened"
            required
            value={note}
            maxLength={NOTE_LIMIT}
            helperText={`${NOTE_MIN} to ${NOTE_LIMIT} characters.`}
            errorText={tooShort ? `Tell us a little more: at least ${NOTE_MIN} characters.` : undefined}
            readOnly={busy}
            onChange={setNote}
            testID="Checkout-cancelNote"
          />
        ) : null}
        {!reason ? <Text style={[small, { color: theme.color.text.secondary }]}>Choose a reason to cancel.</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingBottom: 16 },
  footer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
});
