/**
 * Specimens for `DeclineForm`, named after the Live Orders canvas boards `Decline-no-reason`,
 * `Decline-other`, `Decline-item-unavailable`, `Decline-sending` and `Decline-failed` (the live
 * design system has no preview page for it). Each sits in a 460px panel column.
 */

import type { ReactNode } from 'react';

import { DeclineForm, type DeclineItem } from './DeclineForm.js';

/** Grouped under one heading in the preview. */
export const component = 'DeclineForm';

const ITEMS: DeclineItem[] = [
  { key: 'l1', menuItemId: 'grill', label: '1 × Mixed charcoal grill (Large)' },
  { key: 'l2', menuItemId: 'wrap', label: '2 × Chicken shawarma wrap' },
];

const Panel = ({ children }: { children: ReactNode }) => <div style={{ width: 428 }}>{children}</div>;
const send = () => undefined;

/** `Decline-no-reason`: nothing preselected; Keep order has first focus. */
export function DeclineNoReason() {
  return (
    <Panel>
      <DeclineForm orderCode="A7K2" items={ITEMS} onSubmit={send} autoFocus={false} />
    </Panel>
  );
}

/** `Decline-other`: the note is required, at least 20 characters. */
export function DeclineOther() {
  return (
    <Panel>
      <DeclineForm orderCode="A7K2" items={ITEMS} onSubmit={send} autoFocus={false} initialValues={{ reason: 'OTHER', note: 'Grill is down' }} />
    </Panel>
  );
}

/** `Decline-item-unavailable`: tick the lines, and mark them out of stock until closing. */
export function DeclineItemUnavailable() {
  return (
    <Panel>
      <DeclineForm
        orderCode="A7K2"
        items={ITEMS}
        onSubmit={send}
        autoFocus={false}
        initialValues={{ reason: 'ITEM_UNAVAILABLE', itemKeys: ['l1'] }}
      />
    </Panel>
  );
}

/** `Decline-sending`: the decline is in flight. */
export function DeclineSending() {
  return (
    <Panel>
      <DeclineForm orderCode="A7K2" onSubmit={send} submitting autoFocus={false} initialValues={{ reason: 'KITCHEN_AT_CAPACITY' }} />
    </Panel>
  );
}

/** `Decline-failed`: it was not sent; the retry goes out with the same body. */
export function DeclineFailed() {
  return (
    <Panel>
      <DeclineForm orderCode="A7K2" onSubmit={send} failed locked autoFocus={false} initialValues={{ reason: 'KITCHEN_AT_CAPACITY' }} />
    </Panel>
  );
}
