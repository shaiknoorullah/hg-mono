/**
 * The order detail panel on Live orders (`?order={id}`; LO §4, boards `Detail-preparing`,
 * `-items-adjusted`, `-ready`, `-out`, `-loading`, `-error`, `-not-found`, `Ready-rider-here`,
 * `Ready-rider-here-code-error`, `Ready-no-rider`, `Support-contact-sheet`).
 *
 * An in-page DetailPanel (never a modal): the list and strip keep working beside it. Its
 * heading (the order code) takes focus on open; Close / Escape hand focus back to the row.
 * The browser never computes money: every amount is the server's, through `Price`. No phone
 * and no full address before the restaurant accepts.
 */
import type { ReactElement } from 'react';
import { negateCents, type Cents } from '@hg/api-client';
import { Badge, Button, DetailPanel, Icon, InlineNotice, PickupCode, Price, Skeleton } from '../ds';
import { useConsole } from '../data/console';
import { errorStatus, errorCode, type ServerResource } from '../data/useServerResource';
import { serverNow } from '../data/serverClock';
import { formatTime } from '../format/time';
import { formatPhone, telHref } from '../format/phone';
import {
  deliveryInstructions,
  formatAddress,
  isAccepted,
  isLate,
  lineExtra,
  panelBadge,
  pickupCodeOf,
  readyByText,
  vehicleLabel,
  type LiveFacts,
  type MarkPhase,
  type Order,
} from './model';

export interface OrderDetailProps {
  orderId: string;
  /** The panel's own read of `getRestaurantOrder`. */
  resource: ServerResource<Order>;
  facts: LiveFacts;
  mark: MarkPhase | null;
  onMarkReady: (order: Order) => void;
  onClose: () => void;
}

interface Support {
  display: string;
  href: string;
  hours: string | null;
}

const CANCEL_REASON: Record<string, string> = {
  CUSTOMER_CANCELLED: 'the customer cancelled through support',
  SUPPORT_CANCELLED: 'HalalGoes support cancelled it',
  RESTAURANT_CLOSED: 'the restaurant closed',
  ITEM_UNAVAILABLE: 'an item was unavailable',
  FRAUD_SUSPECTED: 'HalalGoes stopped it as a safety check',
};

/** "Daniel P." already ends the sentence: never "Daniel P..". */
function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function SupportLink({ support, code, children }: { support: Support; code: string; children?: string }) {
  return (
    <a href={support.href} aria-label={`Call support on ${support.display}, quote order ${code}`} className="hg-focus inline-flex min-h-11 items-center font-semibold text-fg-link underline">
      {children ?? `Call support on ${support.display}`}
    </a>
  );
}

export function OrderDetail({ orderId, resource, facts, mark, onMarkReady, onClose }: OrderDetailProps) {
  const { config, profile, timezone } = useConsole();
  const cfg = config.data;
  const support: Support | null =
    cfg?.support_enabled && cfg.support_phone_e164 ? { display: formatPhone(cfg.support_phone_e164), href: telHref(cfg.support_phone_e164), hours: cfg.support_hours ?? null } : null;
  const restaurantName = profile.data?.display_name ?? 'this restaurant';

  const notFound = resource.status === 'error' && (errorStatus(resource.error) === 404 || errorCode(resource.error) === 'NOT_FOUND');

  if (notFound) {
    return (
      <DetailPanel title="Order" label="Order details" closeLabel="Close order details" onClose={onClose} testId="order-detail">
        <div role="status" className="flex flex-col items-start gap-3 py-6">
          <h3 className="text-[17px] font-bold">We can’t show this order</h3>
          <p className="text-[15px]">It isn’t one of {restaurantName}’s orders, or the link is wrong. Nothing else is affected.</p>
          <Button variant="tertiary" size="lg" iconStart={<Icon name="close" size={18} />} onPress={onClose}>
            Close
          </Button>
        </div>
      </DetailPanel>
    );
  }

  const order = resource.data;
  const code = order?.code ?? '';
  const title = <span className="font-mono">{code || 'Order'}</span>;
  const label = code ? `Order ${code} details` : 'Order details';
  const closeLabel = code ? `Close order ${code} details` : 'Close order details';

  if (!order) {
    if (resource.status === 'error') {
      return (
        <DetailPanel title={title} label={label} closeLabel={closeLabel} onClose={onClose} testId="order-detail">
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <h3 className="text-[17px] font-bold">We couldn’t load this order</h3>
            <p className="text-[15px]">Check the connection. The list and new orders keep working while this panel retries.</p>
            <Button variant="tertiary" size="lg" onPress={resource.reload}>
              Try again
            </Button>
          </div>
        </DetailPanel>
      );
    }
    return (
      <DetailPanel title={title} label={label} closeLabel={closeLabel} onClose={onClose} testId="order-detail">
        <div role="status" className="sr-only">
          Loading order {code}…
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton variant="rect" height={40} />
          <Skeleton variant="rect" height={120} />
          <Skeleton variant="rect" height={90} />
        </div>
      </DetailPanel>
    );
  }

  const now = serverNow();
  const badge = panelBadge(order, facts, now);
  const cancelled = facts.cancelled;
  const preparing = order.state === 'PREPARING' && !cancelled;
  const ready = order.state === 'READY_FOR_PICKUP' && !cancelled;
  const out = order.state === 'PICKED_UP' || order.state === 'ARRIVED';
  const liveState = ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED'].includes(order.state) && !cancelled;
  const accepted = isAccepted(order);
  const rider = order.rider ?? null;
  const riderName = rider?.display_name ?? '';
  const riderHere = facts.riderPhase === 'here';
  const late = isLate(order, now);
  const money = order.money;
  const supportLine = (lead: string) =>
    support ? (
      <p className="text-[15px] text-fg-secondary">
        {lead} <SupportLink support={support} code={code} /> and quote {code}.
      </p>
    ) : null;

  const notices: ReactElement[] = [];
  if (cancelled) {
    const reason = cancelled.reasonCode;
    if (reason === 'PREP_OVERDUE') {
      notices.push(
        <InlineNotice key="c" tone="danger" role="alert" icon="error" title={`Stop preparing: HalalGoes cancelled ${code}`} body="It wasn’t ready after 3 extensions. The customer gets a full refund. What you’re paid for it follows HalalGoes policy and shows in History." />,
      );
    } else if (reason === 'NO_RIDER_FOUND' && cancelled.afterReady) {
      notices.push(
        <InlineNotice key="c" tone="danger" role="alert" icon="error" title={`HalalGoes cancelled ${code}: no rider could collect it.`} body="You’re paid in full. Keep the bag aside and don’t give it to a rider." />,
      );
    } else if (cancelled.afterReady) {
      notices.push(<InlineNotice key="c" tone="danger" role="alert" icon="error" title="Order cancelled after it was ready" body="Keep the bag aside; support will tell you what to do. Don’t give it to a rider." />);
    } else {
      const why = reason ? CANCEL_REASON[reason] : undefined;
      notices.push(
        <InlineNotice key="c" tone="danger" role="alert" icon="error" title="Stop preparing: order cancelled" body={`${why ? `Reason: ${why}. ` : ''}You don’t need to hand anything over.`} />,
      );
    }
  } else {
    if (preparing && mark === 'failed') {
      notices.push(
        <InlineNotice key="mf" tone="danger" role="alert" icon="error" title={`We couldn’t mark ${code} ready`} body="The rider hasn’t been told yet. Check the connection and try again. It won’t be sent twice." />,
      );
    }
    if (preparing && riderHere && rider) {
      notices.push(
        <InlineNotice key="rh" tone="brand" icon="profile" title={`${riderName} is here and waiting`} body="The food isn’t ready yet. Mark ready as soon as the bag is packed; the rider waits at the counter." />,
      );
    }
    if (preparing && facts.unassigned) {
      notices.push(<InlineNotice key="un" tone="warning" icon="profile" title="Rider unassigned: the rider cancelled" body="We’re finding another rider. Keep preparing; nothing changes for you." />);
    }
    if (facts.removedLines?.length) {
      notices.push(
        <InlineNotice
          key="adj"
          tone="info"
          icon="info"
          title="The order changed"
          body={
            <>
              Changed by HalalGoes support. Don’t prepare the removed item. You now earn <Price cents={money.restaurant_net_cents} size="sm" />.
            </>
          }
        />,
      );
    }
    if (ready && facts.noRider) {
      notices.push(
        <InlineNotice key="nr" tone="warning" icon="warning" title="We couldn’t find a rider yet" body="HalalGoes support has been told and is on it. Keep the bag on the pickup shelf. Nothing else to do unless support calls you.">
          {support ? (
            <>
              <p className="text-[15px]">
                <SupportLink support={support} code={code}>{`Call support on ${support.display} and quote ${code}`}</SupportLink>
              </p>
              {support.hours ? <p className="text-[15px] text-fg-secondary">Support hours: {support.hours}</p> : null}
            </>
          ) : null}
        </InlineNotice>,
      );
    }
    if (order.state === 'DISPUTED') {
      notices.push(
        <InlineNotice key="dp" tone="warning" icon="warning" title="Support is handling this delivery" body="HalalGoes support is handling a problem with this delivery. Nothing to do unless support calls you.">
          {support ? (
            <p className="text-[15px]">
              <SupportLink support={support} code={code}>{`Call support on ${support.display} and quote ${code}`}</SupportLink>
            </p>
          ) : null}
        </InlineNotice>,
      );
    }
  }

  // ── Rider box ──────────────────────────────────────────────────────────────────────────
  let riderBox: ReactElement | null = null;
  if (!cancelled && accepted) {
    const pickupCode = pickupCodeOf(order);
    let name: string;
    let sub: string;
    let was: string | null = null;
    if (!rider) {
      if (facts.unassigned) [name, sub] = ['Finding another rider', 'The first rider cancelled.'];
      else if (ready && facts.noRider) [name, sub] = ['No rider found yet', order.ready_at ? `Ready since ${formatTime(order.ready_at, timezone)}` : 'Ready'];
      else if (late) [name, sub] = ['No rider assigned yet', 'We are finding one.'];
      else [name, sub] = ['Finding a rider', 'Assigned riders appear here with their arrival time.'];
    } else {
      name = `${riderName} · ${vehicleLabel(rider.vehicle_type)}`;
      if (order.state === 'DISPUTED') sub = 'With support';
      else if (out) sub = 'Out for delivery';
      else if (riderHere && facts.riderHereSince) sub = `At your restaurant since ${formatTime(facts.riderHereSince, timezone)}`;
      else if (rider.eta_at) sub = `Arriving about ${formatTime(rider.eta_at, timezone)}`;
      else sub = 'On the way';
      if (!riderHere && !out && facts.etaWas && rider.eta_at && facts.etaWas !== rider.eta_at) {
        was = `Was ${formatTime(facts.etaWas, timezone)}${facts.etaUpdatedAt ? ` · updated ${formatTime(facts.etaUpdatedAt, timezone)}` : ''}`;
      }
    }
    // The pickup code shows only when READY_FOR_PICKUP and the rider is here (manifest WP4 DONE).
    const handOff = ready && riderHere && rider;
    riderBox = (
      <section aria-label="Rider" data-testid="rider-box" className={`rounded-md border px-3 py-2.5 ${handOff || (preparing && riderHere) ? 'border-line-brand bg-brand-50' : 'border-line-decorative bg-surface-subtle'}`}>
        <p className="text-[15px] font-bold">{name}</p>
        <p className="text-[15px] tabular-nums">{sub}</p>
        {was ? <p className="text-[13px] text-fg-secondary">{was}</p> : null}
        {handOff ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[17px] font-bold">
              Hand bag {code} to {endSentence(riderName)}
            </p>
            {pickupCode ? (
              <PickupCode
                code={pickupCode}
                testId="pickup-code"
                help={`Read this code to ${riderName} as you hand over the bag. He types it into his app, and the order moves to out for delivery.`}
              />
            ) : (
              <div role="alert" data-testid="pickup-code-error" className="rounded-md border border-feedback-warning-border bg-surface-raised px-3 py-2.5">
                <p className="text-[15px] font-semibold text-fg-secondary">Pickup code</p>
                <p className="text-[17px] font-bold">We couldn’t load the pickup code</p>
                <div className="my-1.5">
                  <Button variant="tertiary" size="md" onPress={() => void resource.refresh()}>
                    Try again
                  </Button>
                </div>
                <p className="text-[15px]">Still missing? Call support, they can read it to you.</p>
                {support ? (
                  <a href={support.href} className="hg-focus inline-flex min-h-11 items-center text-[15px] font-semibold text-fg-link underline">
                    Call support on {support.display}
                  </a>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  const footLine = cancelled
    ? 'Stays in the list until you remove it. Kept in History.'
    : order.state === 'DISPUTED'
      ? 'Leaves this list; it stays in History under Open issues › Disputed.'
      : out
        ? 'Read only. Nothing to do; it leaves this list when delivered.'
        : null;

  const footer = preparing ? (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="secondary"
        size="xl"
        fullWidth
        iconStart={<Icon name="check" size={22} />}
        loading={mark === 'sending'}
        accessibilityLabel={`Mark order ${code} ready`}
        onPress={() => onMarkReady(order)}
      >
        Mark ready
      </Button>
      {supportLine(late ? 'Running late, or can’t finish this order?' : 'Can’t finish this order?')}
      <p className="text-[13px] text-fg-secondary">There is no cancel button after you accept; support cancels if it has to.</p>
    </div>
  ) : undefined;

  const instructions = deliveryInstructions(order);

  return (
    <DetailPanel
      title={title}
      subtitle={<Badge size="lg" variant={badge.variant} icon={badge.icon} label={badge.label} testId="detail-badge" />}
      label={label}
      closeLabel={closeLabel}
      onClose={onClose}
      footer={footer}
      testId="order-detail"
    >
      <div className="flex flex-col gap-3.5" data-order-id={orderId}>
        {notices}

        {order.state === 'PREPARING' && !cancelled ? (
          <p className="flex items-center gap-2 text-[17px] font-bold tabular-nums">
            <Icon name="clock" size={20} className={late ? 'text-feedback-warning-icon' : 'text-fg-secondary'} />
            Ready by {readyByText(order, now, timezone)}
          </p>
        ) : null}

        {order.special_instructions ? (
          <div role="note" aria-label="Customer note" className="rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2.5">
            <p className="text-[15px] font-bold text-feedback-warning-tint-text">Customer note</p>
            <p className="text-[17px] font-semibold">{order.special_instructions}</p>
          </div>
        ) : null}

        {facts.notes?.length ? (
          <section aria-labelledby="notes-title" className="flex flex-col gap-2">
            <h3 id="notes-title" className="text-[16px] font-semibold text-fg-secondary">
              Notes on this order
            </h3>
            {facts.notes.map((n, i) => (
              <div key={i} role="note" className="rounded-md border border-feedback-info-border bg-feedback-info-tint px-3 py-2">
                <p className="text-[15px] font-bold">
                  {n.author_kind === 'RIDER' ? 'From the rider' : 'From HalalGoes support'} · {formatTime(n.at, timezone)}
                </p>
                <p className="text-[17px]">{n.text}</p>
              </div>
            ))}
          </section>
        ) : null}

        <section aria-labelledby="items-title">
          <h3 id="items-title" className="mb-1 text-[16px] font-semibold text-fg-secondary">
            Items
          </h3>
          <ul className="flex flex-col">
            {order.lines.map((line) => {
              const extra = lineExtra(line);
              return (
                <li key={line.line_no} className="flex gap-2 border-b border-line-decorative py-2 last:border-b-0">
                  <span className="min-w-9 font-bold tabular-nums">{line.quantity} ×</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{line.name}</p>
                    {extra ? <p className="text-[15px] text-fg-secondary">{extra}</p> : null}
                    {line.special_request ? (
                      <span className="mt-1 inline-block rounded border border-feedback-warning-border bg-feedback-warning-tint px-1.5 text-[13px] font-semibold text-feedback-warning-tint-text">
                        Request: {line.special_request}
                      </span>
                    ) : null}
                  </div>
                  <Price cents={line.line_total_cents} size="md" />
                </li>
              );
            })}
            {(facts.removedLines ?? []).map((r) => (
              <li key={`removed-${r.line_no}`} className="flex gap-2 border-b border-line-decorative py-2 text-fg-secondary last:border-b-0">
                <span className="min-w-9 font-bold tabular-nums line-through">{r.qty} ×</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold line-through">{r.name}</p>
                  <p className="text-[13px] font-semibold">Removed from the order</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Money" className="flex flex-col gap-1 border-t border-line-decorative pt-2 text-[15px]">
          <div className="flex justify-between">
            <span>Items subtotal</span>
            <Price cents={money.subtotal_cents} size="sm" />
          </div>
          {money.discount_cents ? (
            <div className="flex justify-between">
              <span>Discount</span>
              <Price cents={negateCents(money.discount_cents as Cents)} size="sm" sign="always" />
            </div>
          ) : null}
          <div className="flex justify-between text-fg-secondary">
            <span>HalalGoes commission</span>
            <Price cents={money.commission_cents} size="sm" />
          </div>
          <div className="mt-1 flex items-center justify-between text-[17px] font-bold">
            <span>You earn</span>
            <Price cents={money.restaurant_net_cents} size="lg" />
          </div>
        </section>

        <section aria-labelledby="customer-title" className="flex flex-col gap-1 text-[15px]">
          <h3 id="customer-title" className="text-[16px] font-semibold text-fg-secondary">
            Customer and delivery
          </h3>
          <p>
            <strong>{order.customer.display_name}</strong>
            {accepted ? (
              <>
                {' · '}
                <span className="font-mono">{order.customer.phone_masked}</span>
              </>
            ) : null}
          </p>
          {accepted && order.delivery_address ? <p>{formatAddress(order.delivery_address)}</p> : order.delivery_area ? <p>{order.delivery_area}</p> : null}
          {!accepted ? <p>Phone number and full address appear after you accept.</p> : null}
          {instructions ? <p>Delivery instructions: {instructions}</p> : null}
          {liveState ? (
            support ? (
              <>
                <p>
                  Need to reach the customer? <SupportLink support={support} code={code} /> and quote {code}.
                </p>
                <p className="text-fg-secondary">Calls go through HalalGoes; the customer’s full number is never shown.</p>
              </>
            ) : (
              <p className="text-fg-secondary">Contact with the customer goes through HalalGoes support, which is off right now.</p>
            )
          ) : null}
        </section>

        {riderBox}

        {footLine ? <p className="border-t border-line-decorative pt-2 text-[15px] text-fg-secondary">{footLine}</p> : null}
      </div>
    </DetailPanel>
  );
}
