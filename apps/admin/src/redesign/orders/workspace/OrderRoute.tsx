/**
 * The order workspace (`ORD/OrderDetail*`): list | order | More detail.
 *
 * Everything on it is the server's read of the order, as sent (`getOrderAdmin`), and it refreshes
 * quietly when the order's realtime channel signals. It is built for all 14 order states by
 * reading the state, never by branching on a hard-coded story: a deadline's note, the money, the
 * refunds, the ledger and a chargeback each appear when the order has them.
 *
 * - The delivery address is not drawn at all until it is revealed with a recorded reason.
 * - A page never re-arms or acts on a deadline; it only shows what the server did.
 * - Cancel and Reveal open in-page and replace More detail while open; Escape and Close return.
 * - Offline: the order stays readable; every action is off, and nothing is queued.
 *
 * - Issue refund opens the refund panel in the same place. It is a visible button once money has been
 *   captured and the order is delivered or beyond, and a "More actions" item before that.
 *
 * - The list pane folds to a 48 px strip (the button in its header) and comes back from the strip's Show
 *   button, so the order can take the width.
 *
 * - The live map opens in the same place, widened over the list; closing it brings More detail back.
 *   Reveal address from the map replaces it, as Cancel and Reveal do.
 *
 * Not on this page, with the reason in the pull request: resolving a dispute and opening an
 * incident (no API), click-to-call (no API).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { eventOfType, useRealtimeChannel } from '@hg/ui-web/live';
import { isApiError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { unwrap } from '../../../lib/load';
import { api } from '../../data/api';
import { getSession, staffRoleOf, subscribeSession } from '../../data/session';
import { useOnline } from '../../auth/online';
import { usePageBar, usePageTitle } from '../../app/pageTitle';
import { ORDER_STATE } from '../labels';
import { Banner, Button, EmptyState, ErrorState, InlineAlert, Menu, Skeleton, SplitPanes } from '../../ds';
import { useSyncExternalStore } from 'react';
import { asContract } from '../model';
import { REFUND_BUTTON_STATES } from '../../refunds/model';
import { RefundPanel } from '../../refunds/RefundPanel';
import { staffCanCancel } from './notes';
import { CancelPanel } from './CancelPanel';
import { ListPane, listFoldLabels, listSourceOf } from './ListPane';
import { RevealPanel } from './RevealPanel';
import { LiveMapPane } from './LiveMapPane';
import {
  ChargebackBlock,
  DeadlineBlock,
  DisputeNote,
  EventLog,
  ItemsAndMoney,
  LedgerBlock,
  OrderHeader,
  PaymentBlock,
  PeopleAndPlace,
  RefundRows,
  ResidualAlert,
  TimelineBlock,
  WhereThingsAre,
} from './Sections';

type Order = Schema['OrderAdminView'];
type Load = { kind: 'loading' } | { kind: 'ready'; order: Order } | { kind: 'not-found' } | { kind: 'error' };
type Panel = 'none' | 'cancel' | 'reveal' | 'refund' | 'map';
type Result = { refunded: boolean; at: string } | null;

export default function OrderRoute() {
  const { orderId = '' } = useParams();
  const [search] = useSearchParams();
  const from = listSourceOf(search.get('from'));
  const online = useOnline();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);
  const isSupport = role === 'SUPPORT_AGENT';

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [panel, setPanel] = useState<Panel>('none');
  const [result, setResult] = useState<Result>(null);
  // The list pane folds to a strip so the order can be read at full width
  // (`ORD/OrderDetailListCollapsed`), and folds on its own while the map is open. Either way the
  // person's own choice is what it returns to.
  const [listFolded, setListFolded] = useState(false);
  const ticket = useRef(0);
  const openedBy = useRef<HTMLElement | null>(null);

  const read = useCallback(
    async (quiet: boolean) => {
      const mine = ++ticket.current;
      if (!quiet) setLoad({ kind: 'loading' });
      try {
        const body = await unwrap(api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId } } }));
        if (mine !== ticket.current) return;
        setLoad({ kind: 'ready', order: asContract<Order>(body.data) });
      } catch (err) {
        if (mine !== ticket.current) return;
        if (isApiError(err) && err.status === 404) setLoad({ kind: 'not-found' });
        else if (!quiet) setLoad({ kind: 'error' });
        // A quiet refresh that fails keeps the good view on screen.
      }
    },
    [orderId],
  );

  useEffect(() => {
    setPanel('none');
    setResult(null);
    void read(false);
  }, [read]);

  // The server moves orders on its own; follow it without a skeleton.
  useRealtimeChannel(`order:${orderId}`, (signal) => {
    // The map pane takes every rider position itself; a position is not a reason to read the order.
    if (panel === 'map' && eventOfType(signal, 'rider.location')) return;
    if (panel === 'none' || panel === 'map') void read(true);
  });

  const order = load.kind === 'ready' ? load.order : null;
  // The boards' app bar: "Orders" with a way back, and which order and state beneath it.
  usePageTitle('Orders');
  usePageBar(order ? `Order ${order.code} · ${ORDER_STATE[order.state].label}` : undefined, { label: 'Back to Orders', to: '/orders' });
  const close = useCallback(() => {
    setPanel('none');
    openedBy.current?.focus?.();
  }, []);

  const actions = useMemo(
    () => [
      {
        key: 'refund',
        label: 'Issue refund…',
        disabled: !order || !online,
        ...(!online ? { disabledReason: 'You are offline.' } : {}),
        onSelect: () => setPanel('refund'),
      },
      {
        key: 'cancel',
        label: 'Cancel order…',
        destructive: true,
        disabled: !order || !staffCanCancel(order.state) || !online,
        ...(!online ? { disabledReason: 'You are offline.' } : !order || !staffCanCancel(order.state) ? { disabledReason: 'This order can’t be cancelled in its state.' } : {}),
        onSelect: () => setPanel('cancel'),
      },
    ],
    [order, online],
  );

  const orderPane = (() => {
    if (load.kind === 'loading') return <Skeleton variant="lines" count={8} label={`Loading order ${orderId.slice(0, 8)}`} />;
    if (load.kind === 'not-found') {
      return (
        <EmptyState
          icon="search"
          title="No order has this id"
          description="It may have been mistyped. Pick another order from the list."
        />
      );
    }
    if (load.kind === 'error') {
      return (
        <ErrorState
          title="This order didn't load"
          description="The server didn't answer in time. Nothing was changed. Try again, or pick another order from the list."
          onRetry={() => void read(false)}
        />
      );
    }
    const o = load.order;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OrderHeader order={o} />
          <div className="flex flex-wrap items-center gap-2">
            {REFUND_BUTTON_STATES.includes(o.state) ? (
              <Button
                variant="primary"
                disabled={!online}
                onPress={() => {
                  openedBy.current = document.activeElement as HTMLElement | null;
                  setPanel('refund');
                }}
              >
                Issue refund…
              </Button>
            ) : null}
            <Menu label="More actions" triggerText="More actions" items={actions} align="end" disabled={!online} />
          </div>
        </div>
        {result ? (
          <InlineAlert tone="info" blocking title={result.refunded ? 'Cancelled. Refund issued.' : 'Cancelled. Authorisation voided.'}>
            {result.refunded
              ? 'The refund was authorised in the same step and sent to the payment provider. The customer sees “Refund in progress” until the provider confirms.'
              : 'Nothing was charged and no refund is needed. The customer and the restaurant have been told.'}{' '}
            This page now shows the order the server returned.
          </InlineAlert>
        ) : null}
        <DeadlineBlock order={o} />
        <DisputeNote order={o} />
        <ResidualAlert order={o} />
        <ChargebackBlock order={o} />
        <RefundRows order={o} />
        <PaymentBlock order={o} />
        <ItemsAndMoney order={o} />
        <WhereThingsAre
          order={o}
          onOpenMap={() => {
            openedBy.current = document.activeElement as HTMLElement | null;
            setPanel('map');
          }}
        />
        <PeopleAndPlace
          order={o}
          onReveal={
            online && !o.pii_revealed
              ? () => {
                  openedBy.current = document.activeElement as HTMLElement | null;
                  setPanel('reveal');
                }
              : null
          }
        />
      </div>
    );
  })();

  const detailPane = (() => {
    if (order && panel === 'cancel') {
      return (
        <CancelPanel
          order={order}
          isSupport={isSupport}
          onClose={close}
          onReload={() => {
            setPanel('none');
            void read(false);
          }}
          onCancelled={(next, refunded) => {
            setLoad({ kind: 'ready', order: next });
            setResult({ refunded, at: new Date().toISOString() });
            setPanel('none');
          }}
        />
      );
    }
    if (order && panel === 'refund') {
      return (
        <RefundPanel
          order={order}
          role={role}
          onClose={close}
          onReload={() => void read(true)}
          onAnswered={() => void read(true)}
        />
      );
    }
    if (order && panel === 'map') {
      return (
        <LiveMapPane
          order={order}
          onRefresh={() => void read(true)}
          onClose={close}
          onReveal={
            online && !order.pii_revealed
              ? () => {
                  setPanel('reveal');
                }
              : null
          }
          returnFocusRef={openedBy}
        />
      );
    }
    if (order && panel === 'reveal') {
      return (
        <RevealPanel
          orderId={order.id}
          code={order.code}
          onClose={close}
          onRevealed={(next) => {
            setLoad({ kind: 'ready', order: next });
            setPanel('none');
          }}
        />
      );
    }
    if (!order) {
      return <p className="p-4 text-body-sm text-fg-secondary">Timeline, money events and the ledger appear here once an order is open.</p>;
    }
    return (
      <div className="flex flex-col gap-5 p-4">
        <h2 className="text-heading-sm text-fg-primary">More detail</h2>
        <TimelineBlock order={order} />
        <EventLog order={order} />
        <LedgerBlock order={order} />
      </div>
    );
  })();

  return (
    <section aria-label="Order" className="flex min-h-0 flex-1 flex-col">
      {!online ? (
        <div className="p-3 pb-0">
          <Banner
            tone="warning"
            title="You’re offline."
            description="Showing this order as of the last load. Actions are turned off until you reconnect, and nothing is queued."
            announce="status"
          />
        </div>
      ) : null}
      <SplitPanes
        panes={[
          {
            id: 'orders-list',
            label: 'List',
            showLabel: listFoldLabels(from).show,
            collapsible: true,
            collapsed: listFolded || panel === 'map',
            onCollapsedChange: setListFolded,
            defaultSize: 300,
            minSize: 220,
            content: <ListPane from={from} selectedId={orderId} onCollapse={() => setListFolded(true)} />,
          },
          { id: 'order', label: 'Order', fill: true, content: <div className="h-full overflow-auto p-4">{orderPane}</div> },
          panel === 'map'
            ? { id: 'order-map', label: 'Live map', defaultSize: 760, minSize: 520, maxSize: 960, content: <div className="h-full overflow-auto">{detailPane}</div> }
            : { id: 'order-detail', label: 'More detail', collapsible: true, defaultSize: 440, minSize: 320, content: <div className="h-full overflow-auto">{detailPane}</div> },
        ]}
      />
    </section>
  );
}
