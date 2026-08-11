/**
 * `OrderCard` — component 18, `02-components.md` Tier 3. One order, four audiences.
 *
 * The variants take **different payload types**, not one payload with fields blanked out. That
 * is the point: P-07 keeps the projections separate on the wire precisely so a rider view can
 * never accidentally contain a basket total, and this component's prop union preserves that
 * guarantee up to the render. Passing an `OrderCustomerView` to `variant="rider"` is a compile
 * error.
 *
 * Concretely:
 *   - `restaurant` shows the customer as first name + last initial with a masked phone, and the
 *     delivery address **only after acceptance** (R-23 R1).
 *   - `rider` shows no prices and no order total, ever (D-19: the rider has no reason to know
 *     the basket value and it invites disputes). Earnings are a different number and are shown.
 *   - `urgent` and `late` add a **text badge**, never a border colour alone.
 *
 * `Countdown` and `StatusTimeline` belong to other tiers, so they arrive as slots. This keeps
 * the server-anchored countdown contract (`expiresAt` + `serverNow`, never a local constant)
 * where it belongs rather than reimplementing it here.
 */
import type { ReactNode } from 'react';
import { cents, type Schema } from '@hg/api-client';
import { HalalBadge } from '../certification/HalalBadge';
import { cx, DENSITY, FOCUS_RING } from '../certification/internal/token-style';
import { Price } from './Price';

export type OrderCustomerView = Schema['OrderCustomerView'];
export type OrderRestaurantView = Schema['OrderRestaurantView'];
export type OrderAdminView = Schema['OrderAdminView'];
export type RiderAssignment = Schema['Assignment'];

interface OrderCardCommonProps {
  onPress?: () => void;
  /** Explicit buttons; a card with actions is not itself pressable. */
  actions?: ReactNode;
  /** `Countdown` from the feedback tier. Server-anchored; this component never times anything. */
  countdown?: ReactNode;
  /** `StatusTimeline` from the feedback tier. */
  timeline?: ReactNode;
  /** Deadline is inside its last quarter. Adds a border **and** a word. */
  urgent?: boolean;
  /** `promised_ready_at` passed while still preparing (R-23 R6). */
  late?: boolean;
  /** Socket silent > 45 s. A stale queue must announce itself. */
  stale?: boolean;
  loading?: boolean;
  className?: string;
}

export type OrderCardProps =
  | (OrderCardCommonProps & { variant: 'customer'; order: OrderCustomerView })
  | (OrderCardCommonProps & { variant: 'restaurant'; order: OrderRestaurantView })
  | (OrderCardCommonProps & { variant: 'rider'; order: RiderAssignment })
  | (OrderCardCommonProps & { variant: 'admin'; order: OrderAdminView });

export function OrderCard(props: OrderCardProps): React.JSX.Element {
  const { urgent = false, late = false, stale = false, loading = false, className } = props;

  if (loading) {
    return (
      <div
        data-testid="OrderCard-skeleton"
        aria-busy="true"
        aria-label="Loading order"
        className={cx('flex flex-col gap-2 rounded-lg bg-surface-raised shadow-e1', className)}
        style={{ padding: DENSITY.cardPadding }}
      >
        <div aria-hidden="true" className="h-5 w-32 rounded-sm bg-skeleton-base" />
        <div aria-hidden="true" className="h-4 w-56 rounded-sm bg-skeleton-base" />
        <div aria-hidden="true" className="h-4 w-40 rounded-sm bg-skeleton-base" />
      </div>
    );
  }

  const shell = cx(
    'flex flex-col gap-2 rounded-lg bg-surface-raised shadow-e1',
    // Never colour-only: each of these also renders a word, below.
    urgent && 'border-2 border-feedback-danger-border',
    late && !urgent && 'border-s-4 border-feedback-warning-border',
    stale && 'opacity-90',
    className,
  );

  const badges = (
    <div className="flex flex-wrap items-center gap-2">
      {urgent ? <StatusWord tone="danger" testId="OrderCard-urgent" text="Urgent" /> : null}
      {late ? <StatusWord tone="warning" testId="OrderCard-late" text="Late" /> : null}
      {stale ? <StatusWord tone="neutral" testId="OrderCard-stale" text="Not updating" /> : null}
    </div>
  );

  return (
    <article
      data-testid="OrderCard"
      data-variant={props.variant}
      className={shell}
      style={{ padding: DENSITY.cardPadding }}
    >
      {badges}
      {renderBody(props)}
      {props.countdown ? <div data-testid="OrderCard-countdown">{props.countdown}</div> : null}
      {props.timeline ? <div data-testid="OrderCard-timeline">{props.timeline}</div> : null}
      {props.onPress ? (
        <button
          type="button"
          data-testid="OrderCard-open"
          className={cx('self-start text-label-lg text-fg-link min-h-11', FOCUS_RING)}
          onClick={props.onPress}
        >
          View order details
        </button>
      ) : null}
      {props.actions ? (
        // Adjacent targets are ≥8 apart; a destructive/constructive pair under a deadline is ≥24.
        <div className="mt-3 flex flex-wrap gap-6">{props.actions}</div>
      ) : null}
    </article>
  );
}

function renderBody(props: OrderCardProps): React.JSX.Element {
  switch (props.variant) {
    case 'customer':
      return <CustomerBody order={props.order} />;
    case 'restaurant':
      return <RestaurantBody order={props.order} />;
    case 'rider':
      return <RiderBody assignment={props.order} />;
    case 'admin':
      return <AdminBody order={props.order} />;
    default:
      // §0 rule 10 — an unknown variant degrades rather than crashing.
      return <p className="text-body-md text-fg-secondary">Unsupported order view — refresh.</p>;
  }
}

function CustomerBody({ order }: { order: OrderCustomerView }): React.JSX.Element {
  const summary = order.lines
    .slice(0, 3)
    .map((l) => `${l.quantity}× ${l.name}`)
    .join(', ');
  const more = Math.max(0, order.lines.length - 3);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-heading-md text-fg-primary">{order.restaurant.name}</h3>
        <HalalBadge state={order.restaurant.halal?.display_state} size="sm" restaurantId={order.restaurant.id} />
      </div>
      <p className="text-body-sm text-fg-secondary">
        {summary}
        {more > 0 ? ` +${more} more` : ''}
      </p>
      <p className="font-mono text-mono-md text-fg-tertiary">{order.code}</p>
      <Price cents={cents(order.money.total_cents)} size="lg" />
    </div>
  );
}

function RestaurantBody({ order }: { order: OrderRestaurantView }): React.JSX.Element {
  // R-23 R1: the delivery address exists on this payload only after acceptance. Before that the
  // server sends a delivery *area*, and there is nothing here to leak.
  const address = order.delivery_address;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-mono text-heading-md text-fg-primary">{order.code}</h3>

      <p className="text-body-md text-fg-primary">
        {order.customer.display_name} · {order.customer.phone_masked}
      </p>

      {order.special_instructions ? (
        // Verbatim and prominent — the highest-frequency source of order errors, and it never
        // truncates (R-23 R2).
        <p
          data-testid="OrderCard-special-instructions"
          className="rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3 text-body-md text-feedback-warning-tint-text"
        >
          {order.special_instructions}
        </p>
      ) : null}

      <ul className="flex list-none flex-col gap-1 p-0 text-body-md text-fg-primary">
        {order.lines.map((line) => (
          <li key={line.line_no} className="flex justify-between gap-3">
            <span>
              {line.quantity}× {line.name}
              {line.variant_name ? ` (${line.variant_name})` : ''}
            </span>
            <Price cents={cents(line.line_total_cents)} size="sm" />
          </li>
        ))}
      </ul>

      <p className="text-body-sm text-fg-secondary">
        Your payout: <Price cents={cents(order.money.restaurant_net_cents)} size="sm" />
      </p>

      <p className="text-body-sm text-fg-secondary">
        {address ? `${address.line1}${address.unit ? `, ${address.unit}` : ''}` : order.delivery_area ?? '—'}
      </p>
    </div>
  );
}

function RiderBody({ assignment }: { assignment: RiderAssignment }): React.JSX.Element {
  const itemCount = assignment.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-heading-md text-fg-primary">{assignment.pickup.restaurant_name}</h3>
      <p className="text-body-lg text-fg-primary">Pick up · {assignment.pickup.address}</p>
      <p className="text-body-lg text-fg-primary">
        Drop off · {assignment.dropoff.address}
        {assignment.dropoff.unit ? `, ${assignment.dropoff.unit}` : ''}
      </p>
      <p className="text-body-md text-fg-secondary">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </p>
      {assignment.dropoff.delivery_instructions?.length ? (
        <p className="text-body-md text-fg-secondary">
          {assignment.dropoff.delivery_instructions
            .map((i) => i.replaceAll('_', ' ').toLowerCase())
            .join(', ')}
        </p>
      ) : null}
      {/*
        D-19. The only money a rider sees is their own earnings. There is deliberately no branch
        here that could render an order total: `Assignment` does not carry one.
      */}
      {assignment.earnings ? (
        <p className="text-body-lg text-fg-primary">
          Earnings <Price cents={cents(assignment.earnings.estimated_total_cents)} size="lg" />
        </p>
      ) : null}
    </div>
  );
}

function AdminBody({ order }: { order: OrderAdminView }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-heading-md text-fg-primary">{order.restaurant.name}</h3>
        <HalalBadge
          state={order.restaurant.halal?.display_state}
          size="sm"
          surface="operational"
          restaurantId={order.restaurant.id}
        />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-mono-md text-fg-secondary">
        <dt>Order</dt>
        <dd>{order.id}</dd>
        <dt>Code</dt>
        <dd>{order.code}</dd>
        <dt>State</dt>
        <dd>{order.state}</dd>
        {order.dispatch_state ? (
          <>
            <dt>Dispatch</dt>
            <dd>{order.dispatch_state}</dd>
          </>
        ) : null}
      </dl>
      <Price cents={cents(order.money.total_cents)} size="md" showCode />
    </div>
  );
}

function StatusWord({
  tone,
  text,
  testId,
}: {
  tone: 'danger' | 'warning' | 'neutral';
  text: string;
  testId: string;
}): React.JSX.Element {
  const skin =
    tone === 'danger'
      ? 'border-feedback-danger-border bg-feedback-danger-tint text-feedback-danger-tint-text'
      : tone === 'warning'
        ? 'border-feedback-warning-border bg-feedback-warning-tint text-feedback-warning-tint-text'
        : 'border-line-decorative bg-surface-subtle text-fg-secondary';

  return (
    <span
      data-testid={testId}
      className={cx('inline-flex items-center rounded-xs border px-2 text-label-sm', skin)}
    >
      {text}
    </span>
  );
}
