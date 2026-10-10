/**
 * SplitPanes specimens, after `admin/refunds/OrderDetail` (list, order, more detail),
 * `restaurant/onboarding/ReviewPanes` (two panes) and `admin/rider-onboarding/DetailReview`
 * (the folded queue strip). No live preview exists yet.
 */

import type { ReactNode } from 'react';

import { DetailPanel, SplitPanes } from './index.js';

/** Pairs with components/SplitPanes/preview.html once the design system publishes one. */
export const component = 'SplitPanes';

function Pane({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{ height: '100%', padding: 16, background: 'var(--hg-surface-raised)', boxSizing: 'border-box', overflow: 'auto' }}
    >
      <h2 style={{ margin: 0, fontSize: 'var(--hg-text-heading-sm-size)' }}>{title}</h2>
      {children}
    </section>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return <div style={{ width: 1100, height: 360, display: 'flex', background: 'var(--hg-surface-base)' }}>{children}</div>;
}

/** Two panes, the list foldable. */
export function TwoPanes() {
  return (
    <Stage>
      <SplitPanes
        panes={[
          { id: 'list', label: 'Orders', defaultSize: 36, minSize: 25, maxSize: 60, foldable: true, content: <Pane title="Orders" /> },
          {
            id: 'detail',
            label: 'Order',
            content: (
              <DetailPanel title="Order B3M9" onClose={() => undefined} focusOnOpen={false}>
                <p style={{ margin: 0 }}>Its edge is the resize handle.</p>
              </DetailPanel>
            ),
          },
        ]}
      />
    </Stage>
  );
}

/** Three panes: list, order, timeline. */
export function ThreePanes() {
  return (
    <Stage>
      <SplitPanes
        panes={[
          { id: 'list', label: 'Orders', defaultSize: 30, foldable: true, content: <Pane title="Orders" /> },
          { id: 'order', label: 'Order', defaultSize: 40, content: <Pane title="Order B3M9" /> },
          { id: 'timeline', label: 'Timeline', defaultSize: 30, content: <Pane title="Timeline" /> },
        ]}
      />
    </Stage>
  );
}

/** The queue folded to its 48px strip, with "Show Rider applications". */
export function Folded() {
  return (
    <Stage>
      <SplitPanes
        panes={[
          {
            id: 'queue',
            label: 'Rider applications',
            defaultSize: 30,
            foldable: true,
            defaultFolded: true,
            content: <Pane title="Rider applications" />,
          },
          { id: 'app', label: 'Application', content: <Pane title="Musa Ibrahim" /> },
        ]}
      />
    </Stage>
  );
}
