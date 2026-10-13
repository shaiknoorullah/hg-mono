/**
 * Decline in the shell panel (`?panel=decline&order=ID`; LO `Decline-*`, `Tablet-decline`),
 * never a dialog. First focus on "Keep order"; a reason is required and nothing is
 * preselected; "Something else" needs a note of 20+ characters that is sent as
 * `rejectOrder.note` (#604).
 *
 * The Idempotency-Key is made when the form opens and reused on every retry, which is what
 * makes "It won’t be declined twice" true. After a successful decline, ticked items are
 * marked out of stock; if that fails the decline still stands (Decline-availability-failed).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { idempotencyKey, type Schema } from '@hg/api-client';
import { Badge, Button, Countdown, DeclineForm, DetailPanel, Icon, InlineNotice, useToast, type DeclineValues } from '../ds';
import { serverNow } from '../data/serverClock';
import type { ShellPanelProps } from '../shell/slots';
import { OUTCOME_PANEL, REJECT_REASONS, WINDOW_SECONDS, clockLabel } from './copy';
import { isLive, useNewOrders } from './NewOrdersProvider';

type Phase = 'form' | 'sending' | 'failed';

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function DeclinePanelRoute(props: ShellPanelProps) {
  // One form (and one Idempotency-Key) per order.
  return <DeclinePanel key={props.params.get('order') ?? ''} {...props} />;
}

function DeclinePanel({ params }: ShellPanelProps) {
  const api = useNewOrders();
  const toast = useToast();
  const navigate = useNavigate();
  const id = params.get('order');
  const offer = api.get(id);
  const formId = useId();
  // Made when the form opens; every retry of this decline sends the same key.
  const [key] = useState(() => idempotencyKey());
  const [phase, setPhase] = useState<Phase>('form');
  const [tooLate, setTooLate] = useState(false);
  const openedAt = useRef(Date.now());
  const keepRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const close = () => api.closePanel(id);

  // First focus on Keep order, once the form is on screen.
  const formShown = Boolean(offer && isLive(offer));
  useEffect(() => {
    if (formShown) keepRef.current?.focus();
  }, [formShown]);

  if (!offer && api.status === 'loading') {
    return (
      <DetailPanel title="Decline order" label="Decline order" closeLabel="Close" onClose={close} focusOnOpen={false}>
        <div role="status" aria-label="Loading the order" />
      </DetailPanel>
    );
  }

  if (!offer) {
    return (
      <DetailPanel title="Decline order" label="Decline order" closeLabel="Close" onClose={close}>
        <div className="flex flex-col gap-4">
          <p className="text-[17px]">This order is no longer waiting for an answer.</p>
          <Button variant="secondary" size="lg" iconStart={<Icon name="back" size={20} />} onPress={close}>
            Back to new orders
          </Button>
        </div>
      </DetailPanel>
    );
  }

  const code = offer.code;
  const ended = !isLive(offer);

  if (ended) {
    const notice = tooLate
      ? {
          title: 'Too late to decline',
          body: 'The 3 minutes ran out before the decline was sent. The order timed out and the customer was not charged.',
        }
      : offer.outcome === 'timed-out' || offer.outcome === 'too-late' || !offer.outcome
        ? { title: 'Timed out while you were declining', body: 'The decline window closed on its own. The customer was not charged.' }
        : OUTCOME_PANEL[offer.outcome];
    const badge = offer.outcome === 'capture-failed' ? 'Cancelled' : offer.outcome?.startsWith('withdrawn') ? 'Withdrawn' : 'Timed out';
    return (
      <DetailPanel
        title={<span className="font-mono">{code}</span>}
        label={`Order ${code} details`}
        closeLabel={`Close order ${code} details`}
        onClose={close}
        focusOnOpen={false}
        subtitle={<Badge variant={offer.outcome === 'capture-failed' ? 'danger' : 'neutral'} size="lg" icon={badge === 'Timed out' ? 'clock' : undefined} label={badge} />}
        footer={
          <Button variant="secondary" size="lg" iconStart={<Icon name="back" size={20} />} onPress={close}>
            Back to new orders
          </Button>
        }
        testId="decline-panel"
      >
        <InlineNotice tone={offer.outcome === 'capture-failed' ? 'danger' : 'neutral'} icon="clock" role="alert" title={notice.title}>
          {notice.body}
        </InlineNotice>
      </DetailPanel>
    );
  }

  const sending = phase === 'sending';
  const label = sending ? 'Declining…' : phase === 'failed' ? 'Try decline again' : 'Decline order';
  const items = (offer.order?.lines ?? []).map((l) => ({
    key: String(l.line_no),
    menuItemId: l.menu_item_id,
    label: `${l.quantity} × ${l.name}${l.variant_name ? ` (${l.variant_name})` : ''}`,
    name: l.name,
  }));

  // A new order rang while this form was open (Decline-new-offer).
  const newer = api.offers.filter((o) => isLive(o) && o.id !== offer.id && o.addedAt > openedAt.current).sort((a, b) => b.addedAt - a.addedAt)[0];

  const submit = async (values: DeclineValues) => {
    setPhase('sending');
    const body: Schema['OrderRejectInput'] = { reason_code: values.reason as Schema['RestaurantRejectReasonCode'] };
    if (values.reason === 'OTHER' && values.note) body.note = values.note;
    if (values.reason === 'ITEM_UNAVAILABLE' && values.itemIds.length) body.unavailable_menu_item_ids = values.itemIds;
    const result = await api.reject(offer.id, body, key);
    if (result.ok) {
      api.closePanel(null);
      const toMark = values.markOutOfStock
        ? items.filter((i) => values.itemIds.includes(i.menuItemId)).filter((i, n, all) => all.findIndex((x) => x.menuItemId === i.menuItemId) === n)
        : [];
      const failed = toMark.length ? await api.markOutOfStock(toMark.map((i) => ({ menuItemId: i.menuItemId, label: i.name }))) : [];
      if (failed.length) {
        const one = failed.length === 1;
        // "Open Menu" brings the (first) item still on sale into view: `/menu?item=<id>`.
        // The Menu page (WP8) scrolls to and highlights `item`; until WP8 merges, the legacy
        // Menu screen ignores the parameter and opens at the top.
        const menuUrl = `/menu?item=${encodeURIComponent(failed[0]!.menuItemId)}`;
        toast.show({
          variant: 'warning',
          title: `Order declined. We couldn’t mark ${joinNames(failed.map((f) => f.label))} out of stock, so customers can still order ${one ? 'it' : 'them'}.`,
          description: `The customer was not charged. Mark ${one ? 'it' : 'them'} out of stock on the Menu page.`,
          action: { label: 'Open Menu', onAction: () => navigate(menuUrl) },
        });
      } else {
        toast.show({ variant: 'neutral', title: `${code} declined`, description: 'The customer was not charged. It’s in History.' });
      }
      return;
    }
    if (result.kind === 'too-late') {
      setTooLate(true);
      return;
    }
    if (result.kind === 'ended') {
      // Accepted or declined elsewhere closes the panel (its toast says so); an ended order
      // shows its ended view above.
      setPhase('form');
      return;
    }
    setPhase('failed');
  };

  return (
    <DetailPanel
      title={`Decline ${code}?`}
      label={`Order ${code} details`}
      closeLabel={`Close, keep order ${code}`}
      onClose={close}
      focusOnOpen={false}
      subtitle={
        <div className="mt-1 flex flex-col gap-2">
          <span>
            <Badge variant="brand" size="lg" icon="bell" label="New" />
          </span>
          <Countdown variant="bar" size="lg" expiresAt={offer.deadlineAt} now={serverNow} windowSeconds={WINDOW_SECONDS} label="left to answer" />
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-6">
          <Button ref={keepRef} variant="tertiary" size="lg" disabled={sending} onPress={close}>
            Keep order
          </Button>
          <Button
            variant="danger"
            size="lg"
            destructive
            type="submit"
            form={formId}
            loading={sending}
            accessibilityLabel={`${label}, order ${code}`}
          >
            {label}
          </Button>
        </div>
      }
      testId="decline-panel"
    >
      <DeclineForm
        formId={formId}
        reasons={REJECT_REASONS}
        noteReason="OTHER"
        itemReason="ITEM_UNAVAILABLE"
        items={items}
        disabled={sending}
        // A decline that went out under this form's key keeps its body: retrying with the same
        // key and a different reason would be IDEMPOTENCY_KEY_REUSE (409) on every try.
        locked={phase === 'failed'}
        onSubmit={(v) => void submit(v)}
        before={
          <>
            <p className="text-[15px] leading-[22px]">
              The customer is not charged and is told their order was declined. Pick a reason; the order keeps its timer while you choose.
            </p>
            {newer ? (
              <InlineNotice tone="brand" icon="bell" role="note" title={`New order ${newer.code} just arrived · ${clockLabel(Math.max(0, Math.ceil((newer.deadlineAt - serverNow()) / 1000)))} left`}>
                It’s ringing in the strip above. Finish here, or choose Keep order to go back to it.
              </InlineNotice>
            ) : null}
          </>
        }
        after={
          phase === 'failed' ? (
            <InlineNotice tone="danger" icon="error" role="alert" title="We couldn’t send the decline">
              The order is still waiting for you. Check the connection and try again. It won’t be declined twice.
            </InlineNotice>
          ) : null
        }
        testId="decline-form"
      />
    </DetailPanel>
  );
}
