/**
 * A past order beside the Past orders list (`?order={id}`; boards `Detail-finished`,
 * `Detail-declined`, `Detail-disputed`, `History-delivered`, `History-detail-cancelled-sheet`,
 * `History-detail-other-sheet`, `History-halal-upheld`, `History-halal-goodwill`).
 *
 * An in-page DetailPanel (never a modal), read-only: nothing here changes an order. Its heading
 * (the order code) takes focus on open; Close / Escape hand focus back to the row. The browser
 * never computes money: every amount is the server's, through `Price`. No phone and no full
 * address for an order that was never accepted.
 *
 * Reasons (why it was declined, who cancelled it, the outcome of a report or of a halal concern)
 * are not on the restaurant's order view, so the panel says what the state says and no more.
 */
import { negateCents, type Cents } from '@hg/api-client';
import { Badge, Button, DetailPanel, Icon, InlineNotice, Price, Skeleton } from '../ds';
import { useConsole } from '../data/console';
import { errorCode, errorStatus, type ServerResource } from '../data/useServerResource';
import { vehicleLabel, deliveryInstructions, formatAddress, isAccepted, lineExtra, type Order } from './model';
import { historyStatus, netCell, panelFootLine, panelNote } from './history';

export interface HistoryDetailProps {
  orderId: string;
  /** The panel's own read of `getRestaurantOrder`. */
  resource: ServerResource<Order>;
  onClose: () => void;
}

export function HistoryDetail({ orderId, resource, onClose }: HistoryDetailProps) {
  const { profile } = useConsole();
  const restaurantName = profile.data?.display_name ?? 'this restaurant';
  const notFound = resource.status === 'error' && (errorStatus(resource.error) === 404 || errorCode(resource.error) === 'NOT_FOUND');

  if (notFound) {
    return (
      <DetailPanel title="Order" label="Order details" closeLabel="Close order details" onClose={onClose} testId="history-detail">
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
        <DetailPanel title={title} label={label} closeLabel={closeLabel} onClose={onClose} testId="history-detail">
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <h3 className="text-[17px] font-bold">We couldn’t load this order</h3>
            <p className="text-[15px]">Check the connection. The list beside this panel stays as it was.</p>
            <Button variant="tertiary" size="lg" onPress={resource.reload}>
              Try again
            </Button>
          </div>
        </DetailPanel>
      );
    }
    return (
      <DetailPanel title={title} label={label} closeLabel={closeLabel} onClose={onClose} testId="history-detail">
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

  const status = historyStatus(order.state);
  const note = panelNote(order);
  const net = netCell(order);
  const accepted = isAccepted(order);
  const money = order.money;
  const instructions = deliveryInstructions(order);
  const rider = order.rider && order.state === 'COMPLETED' ? order.rider : null;

  return (
    <DetailPanel
      title={title}
      subtitle={<Badge size="lg" variant={status.variant} icon={status.icon} label={status.label} testId="history-badge" />}
      label={label}
      closeLabel={closeLabel}
      onClose={onClose}
      testId="history-detail"
    >
      <div className="flex flex-col gap-3.5" data-order-id={orderId}>
        {note ? (
          <InlineNotice
            tone={note.tone}
            role={note.tone === 'warning' ? 'status' : 'note'}
            icon={note.tone === 'warning' ? 'warning' : 'info'}
            title={note.title}
            body={note.body}
            titleSize={note.tone === 'warning' ? 17 : 15}
            testId="history-note"
          />
        ) : null}

        {order.special_instructions ? (
          <div role="note" aria-label="Customer note" className="rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2.5">
            <p className="text-[15px] font-bold text-feedback-warning-tint-text">Customer note</p>
            <p className="text-[17px] font-semibold">{order.special_instructions}</p>
          </div>
        ) : null}

        <section aria-labelledby="past-items-title">
          <h3 id="past-items-title" className="mb-1 text-[16px] font-semibold text-fg-secondary">
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
          </ul>
        </section>

        <section aria-label="Money" className="flex flex-col gap-1.5 border-t border-line-decorative pt-3 text-[15px]">
          <div className="flex justify-between">
            <span>Items subtotal</span>
            <Price cents={money.subtotal_cents} size="md" />
          </div>
          {money.discount_cents ? (
            <div className="flex justify-between">
              <span>Discount</span>
              <Price cents={negateCents(money.discount_cents as Cents)} size="md" sign="always" />
            </div>
          ) : null}
          {net.kind === 'amount' && money.commission_cents ? (
            <div className="flex justify-between text-fg-secondary">
              <span>HalalGoes commission</span>
              <Price cents={money.commission_cents} size="md" />
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 pt-1.5 text-[17px] font-bold">
            <span>Order net</span>
            {net.kind === 'not-charged' ? (
              <span className="flex items-baseline gap-2" data-testid="not-charged">
                <span aria-hidden="true">—</span>
                <span className="text-[15px] font-semibold text-fg-secondary">Not charged</span>
              </span>
            ) : (
              <span className="flex items-baseline gap-2">
                <Price cents={net.cents} size="lg" />
                {net.payoutOpen ? <span className="text-[15px] font-semibold text-fg-secondary">Payout open</span> : null}
              </span>
            )}
          </div>
        </section>

        <section aria-labelledby="past-customer-title" className="flex flex-col gap-1 text-[15px] text-fg-secondary">
          <h3 id="past-customer-title" className="mb-1 text-[16px] font-semibold text-fg-secondary">
            Customer and delivery
          </h3>
          <p>
            <strong className="font-semibold text-fg-primary">{order.customer.display_name}</strong>
            {accepted ? (
              <>
                {' · '}
                <span className="font-mono">{order.customer.phone_masked}</span>
              </>
            ) : null}
          </p>
          {accepted && order.delivery_address ? <p>{formatAddress(order.delivery_address)}</p> : order.delivery_area ? <p>{order.delivery_area}</p> : null}
          {instructions ? <p>Delivery instructions: {instructions}</p> : null}
        </section>

        {rider ? (
          <section aria-label="Rider" data-testid="history-rider" className="rounded-md border border-line-decorative bg-surface-subtle px-3 py-2.5">
            <p className="text-[15px] font-bold">{`Delivered by ${rider.display_name} · ${vehicleLabel(rider.vehicle_type)}`}</p>
            <p className="text-[15px]">Delivered</p>
          </section>
        ) : null}

        <p className="border-t border-line-decorative pt-2 text-[15px] text-fg-secondary">{panelFootLine(order)}</p>
      </div>
    </DetailPanel>
  );
}
