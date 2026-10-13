/**
 * `EventLog` — the order's event history in the admin console (canvas
 * `admin/orders/OrderDetail`: "Proposed component: EventLog"). An ordered list, oldest first by
 * default: the 12-hour time (full date in a Tooltip and to screen readers), the source, then the
 * actor in bold and what happened. Every state is drawn: loading (skeleton lines), error
 * (ErrorState with Retry), empty (says why).
 */

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../lib/utils.js';
import { formatFullDateTime, parseWireDate } from '../ds/data-format.js';
import { formatTime12h } from '../ds/time.js';
import { EmptyState, ErrorState, Skeleton } from './index.js';

/** One event in the log. */
export interface EventLogEntry {
  id: string;
  /** RFC-3339 time of the event. */
  at: string;
  /** Where it came from: "System", "Staff", "Rider app". */
  source?: string;
  /** Who did it, in bold ("Aisha K."). */
  actor?: string;
  /** What happened ("accepted the order"). */
  text: ReactNode;
}

/** Props of `EventLog`. */
export interface EventLogProps {
  events: EventLogEntry[];
  /** Names the list (default "Event log"). */
  label?: string;
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  /** Copy when there are no events. */
  emptyText?: string;
  timeZone?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** A dense, ordered event history. */
export function EventLog({
  events,
  label = 'Event log',
  status = 'ready',
  errorMessage,
  onRetry,
  emptyText = 'Nothing has happened on this record yet. Events appear here as they happen.',
  timeZone,
  testId = 'EventLog',
  style,
}: EventLogProps) {
  if (status === 'loading') {
    return (
      <div data-testid={testId} style={style} aria-busy="true" className="flex flex-col gap-2 py-2">
        <span role="status" className="sr-only">
          Loading {label.toLowerCase()}
        </span>
        <Skeleton variant="text" lines={4} />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div data-testid={testId} style={style}>
        <ErrorState
          variant="inline"
          title={`The ${label.toLowerCase()} didn't load`}
          description={errorMessage ?? 'Nothing was changed. Try again.'}
          onRetry={onRetry}
        />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div data-testid={testId} style={style}>
        <EmptyState variant="inline" title="No events yet" description={emptyText} />
      </div>
    );
  }
  return (
    <ol aria-label={label} data-testid={testId} style={style} className="m-0 flex list-none flex-col p-0">
      {events.map((event) => {
        const date = parseWireDate(event.at);
        const time = date ? formatTime12h(date, { timeZone }) : null;
        const full = date ? formatFullDateTime(date, { timeZone }) : null;
        return (
          <li
            key={event.id}
            className={cn(
              'grid min-h-7 grid-cols-[5rem_4.5rem_minmax(0,1fr)] gap-2 border-0 border-t border-solid border-line-decorative py-1',
              'text-body-sm text-fg-primary',
            )}
          >
            {time && full ? (
              <time dateTime={event.at} title={full} className="tabular-nums text-fg-secondary">
                <span aria-hidden="true">{time}</span>
                <span className="sr-only">{full}</span>
              </time>
            ) : (
              <span className="text-fg-tertiary">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Time not available</span>
              </span>
            )}
            <span className="truncate text-fg-secondary">{event.source ?? ''}</span>
            <span className="min-w-0">
              {event.actor ? <strong className="font-semibold">{event.actor} </strong> : null}
              {event.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
