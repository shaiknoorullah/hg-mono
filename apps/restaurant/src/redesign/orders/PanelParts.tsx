/**
 * Parts both order panels draw the same way: Live orders' `OrderDetail` and Past orders'
 * `HistoryDetail`. The placeholder panels (not found, could not load, loading) and the Items
 * list. One copy here so the two panels cannot drift apart.
 */
import type { ReactElement, ReactNode } from 'react';
import { Button, DetailPanel, Icon, Price, Skeleton } from '../ds';
import { errorCode, errorStatus, type ServerResource } from '../data/useServerResource';
import { lineExtra, type Order } from './model';

export interface PlaceholderProps {
  resource: ServerResource<Order>;
  restaurantName: string;
  testId: string;
  onClose: () => void;
  /** What to tell the person when the order could not be read. */
  loadFailedBody: string;
}

/** The panel while there is no order to draw (not found, load failed, loading); null once there is. */
export function panelPlaceholder({ resource, restaurantName, testId, onClose, loadFailedBody }: PlaceholderProps): ReactElement | null {
  const order = resource.data;
  if (order) return null;
  const notFound = resource.status === 'error' && (errorStatus(resource.error) === 404 || errorCode(resource.error) === 'NOT_FOUND');
  if (notFound) {
    return (
      <DetailPanel title="Order" label="Order details" closeLabel="Close order details" onClose={onClose} testId={testId}>
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
  if (resource.status === 'error') {
    return (
      <DetailPanel title="Order" label="Order details" closeLabel="Close order details" onClose={onClose} testId={testId}>
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <h3 className="text-[17px] font-bold">We couldn’t load this order</h3>
          <p className="text-[15px]">{loadFailedBody}</p>
          <Button variant="tertiary" size="lg" onPress={resource.reload}>
            Try again
          </Button>
        </div>
      </DetailPanel>
    );
  }
  return (
    <DetailPanel title="Order" label="Order details" closeLabel="Close order details" onClose={onClose} testId={testId}>
      <div role="status" className="sr-only">
        Loading order…
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton variant="rect" height={40} />
        <Skeleton variant="rect" height={120} />
        <Skeleton variant="rect" height={90} />
      </div>
    </DetailPanel>
  );
}

/** The panel's Items section; `after` adds rows below the order's own lines (removed items). */
export function ItemsSection({ lines, titleId, after }: { lines: Order['lines']; titleId: string; after?: ReactNode }) {
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-1 text-[16px] font-semibold text-fg-secondary">
        Items
      </h3>
      <ul className="flex flex-col">
        {lines.map((line) => {
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
        {after}
      </ul>
    </section>
  );
}
