/**
 * A new order in the shell panel (`?panel=offer&order=ID`; LO `Detail-pending`,
 * `-accepting`, `-accept-failed`, `-offer-ended-sheet`, `Offer-stepper-bounds`).
 *
 * Opened by Enter on a tile or a click on its body; focus goes to the heading (the code);
 * Close and Escape return focus to the tile. No phone number before acceptance (owner
 * decision; the contract sends `phone_masked`, it is never rendered here). The footer
 * accepts with the prep stepper (1..120, steps of 5), in sync with the tile's label.
 */
import { useEffect, useRef } from 'react';
import { negateCents, type Schema } from '@hg/api-client';
import { Badge, Button, Countdown, DetailPanel, Icon, IconButton, InlineNotice, Price, Skeleton } from '../ds';
import { serverNow } from '../data/serverClock';
import type { ShellPanelProps } from '../shell/slots';
import { DELIVERY_INSTRUCTION_LABELS, OUTCOME_PANEL, OUTCOME_TILE, PREP_MAX, PREP_MIN, WINDOW_SECONDS, acceptName, prepStep } from './copy';
import { isLive, useNewOrders, type Offer } from './NewOrdersProvider';
import { acceptLabelOf } from './StripView';

type Line = Schema['OrderLine'];

function lineExtra(line: Line): string | null {
  const parts: string[] = [];
  if (line.variant_name) parts.push(line.variant_name);
  for (const a of line.addons ?? []) parts.push(`+ ${a.addon_quantity > 1 ? `${a.addon_quantity} × ` : ''}${a.addon_name}`);
  return parts.length ? parts.join(' · ') : null;
}

function MoneyRow({ label, children, strong, muted }: { label: string; children: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'text-[17px] font-bold' : 'text-[15px]'} ${muted ? 'text-fg-secondary' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function OrderBody({ offer, ended }: { offer: Offer; ended: boolean }) {
  const o = offer.order;
  if (!o) {
    return (
      <div role="status" aria-label="Loading the rest of this order" className="flex flex-col gap-3">
        <Skeleton variant="text" lines={3} />
        <span className="text-[15px] text-fg-secondary">Loading the rest of this order…</span>
      </div>
    );
  }
  const m = o.money;
  return (
    <div className="flex flex-col gap-5">
      {o.special_instructions?.trim() ? (
        <InlineNotice tone="warning" icon="warning" role="note" label="Customer note" title="Customer note">
          <span className="text-[17px] font-semibold">{o.special_instructions}</span>
        </InlineNotice>
      ) : null}

      <section aria-labelledby={`items-${o.id}`} className="flex flex-col gap-2">
        <h3 id={`items-${o.id}`} className="text-[17px] font-bold">
          Items
        </h3>
        <ul className="flex flex-col gap-2">
          {o.lines.map((line) => {
            const extra = lineExtra(line);
            return (
              <li key={line.line_no} className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[17px]">
                    <strong>{line.quantity} ×</strong> <span className="font-semibold">{line.name}</span>
                  </span>
                  {extra ? <span className="text-[15px] text-fg-secondary">{extra}</span> : null}
                  {line.special_request ? (
                    <span className="self-start rounded-sm bg-feedback-warning-tint px-1.5 text-[13px] font-semibold text-feedback-warning-tint-text">
                      Request: {line.special_request}
                    </span>
                  ) : null}
                </div>
                <Price cents={line.line_total_cents} size="md" />
              </li>
            );
          })}
        </ul>
      </section>

      <dl className="flex flex-col gap-1 border-t border-line-decorative pt-3">
        <MoneyRow label="Items subtotal">
          <Price cents={m.subtotal_cents} size="md" />
        </MoneyRow>
        {m.discount_cents ? (
          <MoneyRow label="Discount">
            <Price cents={negateCents(m.discount_cents)} size="md" sign="always" />
          </MoneyRow>
        ) : null}
        {ended ? (
          <MoneyRow label="You earn" strong>
            <span aria-hidden="true">—</span> <span className="text-[15px] font-normal text-fg-secondary">Not charged</span>
          </MoneyRow>
        ) : (
          <>
            <MoneyRow label="HalalGoes commission" muted>
              <Price cents={m.commission_cents} size="md" />
            </MoneyRow>
            <MoneyRow label="You earn" strong>
              <Price cents={m.restaurant_net_cents} size="lg" />
            </MoneyRow>
          </>
        )}
      </dl>

      <section aria-labelledby={`cust-${o.id}`} className="flex flex-col gap-1">
        <h3 id={`cust-${o.id}`} className="text-[17px] font-bold">
          Customer and delivery
        </h3>
        <strong className="text-[17px]">{o.customer.display_name}</strong>
        {o.delivery_area ? <span className="text-[15px]">{o.delivery_area}</span> : null}
        <span className="text-[15px]">Phone number and full address appear after you accept.</span>
        {o.delivery_instructions?.length ? (
          <span className="text-[15px]">
            Delivery instructions: {o.delivery_instructions.map((d) => DELIVERY_INSTRUCTION_LABELS[d] ?? d).join(' · ')}
          </span>
        ) : null}
      </section>
    </div>
  );
}

export function OfferPanel({ params }: ShellPanelProps) {
  const api = useNewOrders();
  const id = params.get('order');
  const offer = api.get(id);
  const close = () => api.closePanel(id);
  const acceptRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const wasLive = useRef(offer ? isLive(offer) : false);

  // The order ended while its panel is open: focus stays in the panel (on its notice).
  const ended = offer ? !isLive(offer) : false;
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ended && wasLive.current) noticeRef.current?.querySelector<HTMLElement>('button')?.focus();
    wasLive.current = !ended;
  }, [ended]);

  if (!offer) {
    return (
      <DetailPanel title="New order" label="New order details" closeLabel="Close new order details" onClose={close}>
        {api.status === 'loading' ? (
          <Skeleton variant="text" lines={3} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[17px]">This order is no longer waiting for an answer.</p>
            <Button variant="secondary" size="lg" iconStart={<Icon name="back" size={20} />} onPress={close}>
              Back to new orders
            </Button>
          </div>
        )}
      </DetailPanel>
    );
  }

  const conn = api.connection;
  const code = offer.code;
  const outcome = offer.outcome ? OUTCOME_TILE[offer.outcome] : null;
  const label = acceptLabelOf(offer, conn);
  const accepting = offer.phase === 'accepting';
  // An accept that went out under this order's Idempotency-Key keeps its body: a retry with
  // another prep time would be IDEMPOTENCY_KEY_REUSE (409). The time is locked once sent.
  const prepLocked = accepting || offer.phase === 'accept-failed';

  const footer = ended ? (
    <div ref={noticeRef} className="flex flex-wrap gap-3">
      <Button variant="secondary" size="lg" iconStart={<Icon name="back" size={20} />} onPress={close}>
        Back to new orders
      </Button>
      {offer.outcome === 'capture-failed' ? (
        <Button
          variant="tertiary"
          size="lg"
          accessibilityLabel={`Remove order ${code} from new orders`}
          onPress={() => {
            api.remove(offer.id);
            close();
          }}
        >
          Remove
        </Button>
      ) : null}
    </div>
  ) : (
    <div className="flex flex-col">
      {accepting ? (
        <InlineNotice tone="neutral" icon="refresh" role="status" className="mb-3">
          Confirming with HalalGoes. Don’t tap again.
        </InlineNotice>
      ) : offer.phase === 'accept-failed' ? (
        <InlineNotice tone="danger" icon="error" role="alert" title="We couldn’t confirm this order" className="mb-3">
          It is still waiting for you. Trying again won’t charge the customer twice.
        </InlineNotice>
      ) : offer.phase === 'unavailable' ? (
        <InlineNotice tone="danger" icon="error" role="alert" className="mb-3">
          {offer.failure ?? 'Your restaurant can’t take orders right now.'}
        </InlineNotice>
      ) : null}
      <div className="flex items-center gap-3">
        <div role="group" aria-label={`Prep time for order ${code}`} className="flex shrink-0 flex-col items-center gap-1">
          <span aria-hidden="true" className="text-[13px] font-semibold text-fg-secondary">
            Ready in
          </span>
          <div className="flex items-center gap-1">
            <IconButton
              icon={
                <span aria-hidden="true" className="text-[22px] font-bold leading-none">
                  −
                </span>
              }
              variant="tonal"
              accessibilityLabel={`Less prep time for order ${code}`}
              disabled={offer.prep <= PREP_MIN || prepLocked}
              onPress={() => api.setPrep(offer.id, prepStep(offer.prep, -1))}
            />
            <output aria-live="polite" aria-label={`Ready in ${offer.prep} minutes`} className="min-w-[54px] text-center text-[17px] font-bold tabular-nums">
              {offer.prep} min
            </output>
            <IconButton
              icon={<Icon name="plus" size={20} />}
              variant="tonal"
              accessibilityLabel={`More prep time for order ${code}`}
              disabled={offer.prep >= PREP_MAX || prepLocked}
              onPress={() => api.setPrep(offer.id, prepStep(offer.prep, 1))}
            />
          </div>
        </div>
        <Button
          ref={acceptRef}
          variant="primary"
          size="xl"
          fullWidth
          loading={accepting}
          disabled={offer.phase === 'unavailable' || (conn.restDown && offer.phase === 'live')}
          accessibilityLabel={acceptName(label, code, offer.prep)}
          onPress={() => api.accept(offer.id)}
          className="h-[72px]! min-w-0 flex-1 text-[19px]"
        >
          {label}
        </Button>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          variant="ghost"
          size="md"
          disabled={accepting}
          accessibilityLabel={`Decline order ${code}, choose a reason`}
          onPress={() => api.open(offer.id, 'decline')}
        >
          Decline…
        </Button>
      </div>
    </div>
  );

  return (
    <DetailPanel
      title={<span className="font-mono">{code}</span>}
      label={`Order ${code} details`}
      closeLabel={`Close order ${code} details`}
      onClose={close}
      subtitle={
        <div className="mt-1 flex flex-col gap-2">
          <span>
            {outcome ? (
              <Badge variant={outcome.tone === 'danger' ? 'danger' : 'neutral'} size="lg" icon={outcome.icon === 'clock' ? 'clock' : undefined} label={outcome.badge} />
            ) : (
              <Badge variant="brand" size="lg" icon="bell" label="New" />
            )}
          </span>
          {!ended ? <Countdown variant="bar" size="lg" expiresAt={offer.deadlineAt} now={serverNow} windowSeconds={WINDOW_SECONDS} label="left to answer" /> : null}
        </div>
      }
      footer={footer}
      testId="offer-panel"
    >
      {ended && offer.outcome ? (
        <InlineNotice
          tone={offer.outcome === 'capture-failed' ? 'danger' : 'neutral'}
          icon={offer.outcome === 'capture-failed' ? 'error' : offer.outcome.startsWith('withdrawn') ? 'info' : 'clock'}
          role="alert"
          title={OUTCOME_PANEL[offer.outcome].title}
          className="mb-4"
        >
          {OUTCOME_PANEL[offer.outcome].body}
        </InlineNotice>
      ) : null}
      <OrderBody offer={offer} ended={ended} />
    </DetailPanel>
  );
}
