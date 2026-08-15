/**
 * Order history (C-26 adjacent): `GET /v1/orders`, newest first, with a one-tap reorder and a
 * link into rating once an order is `COMPLETED`.
 *
 * `OrderCard variant="customer"` is the same card the tracking resume banner would use; here it
 * takes an `OrderSummary`. Reorder re-adds every line via `POST /v1/cart/lines` (there is no
 * dedicated reorder endpoint in the contract) and, on success, pushes straight to Cart so the
 * customer can review before checkout rather than being silently charged again.
 */
import * as React from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppBar,
  Button,
  EmptyState,
  ErrorState,
  OrderCard,
  OrderCardSkeleton,
  Spinner,
  Tabs,
  Toast,
  useTheme,
} from '@hg/ui-native';

import { listOrders, reorder, type OrderSummary, type OrderStatusGroup } from '../api/orders';
import { useAsync, type Async } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';

type Filter = 'ALL' | OrderStatusGroup;

export function OrdersScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const { state, reload } = useAsync(
    () => listOrders(filter === 'ALL' ? undefined : { statusGroup: filter }),
    [filter],
  );

  const onReorder = React.useCallback(
    async (order: OrderSummary) => {
      setBusyId(order.id);
      try {
        const { failedLines } = await reorder(order.id);
        setToast(
          failedLines.length > 0
            ? `Added what's still available. ${failedLines.length} item(s) could not be re-added.`
            : `${order.restaurant.name} added to your cart.`,
        );
        nav.push({ name: 'cart' });
      } catch {
        setToast("Couldn't reorder — please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [nav],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Your orders" />
      <Tabs
        tabs={[
          { key: 'ALL', label: 'All' },
          { key: 'ACTIVE', label: 'Active' },
          { key: 'PAST', label: 'Past' },
        ]}
        value={filter}
        onChange={(key) => setFilter(key as Filter)}
        accessibilityLabel="Order filters"
      />
      <View style={{ flex: 1 }}>
        <Body
          state={state}
          onRetry={reload}
          onBrowse={() => nav.reset({ name: 'discovery' })}
          onOpen={(orderId) => nav.push({ name: 'tracking', orderId })}
          onReorder={onReorder}
          onRate={(orderId) => nav.push({ name: 'rateOrder', orderId })}
          busyId={busyId}
          bottomInset={insets.bottom}
        />
      </View>
      {toast ? <Toast variant="neutral" title={toast} onDismiss={() => setToast(null)} /> : null}
      <CustomerTabBar active="orders" />
    </View>
  );
}

function Body({
  state,
  onRetry,
  onBrowse,
  onOpen,
  onReorder,
  onRate,
  busyId,
  bottomInset,
}: {
  state: Async<{ orders: OrderSummary[]; meta: unknown }>;
  onRetry: () => void;
  onBrowse: () => void;
  onOpen: (orderId: string) => void;
  onReorder: (order: OrderSummary) => void;
  onRate: (orderId: string) => void;
  busyId: string | null;
  bottomInset: number;
}): React.ReactElement {
  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, padding: 16, gap: 16 }}>
        <Spinner label="Loading orders" />
        <OrderCardSkeleton />
        <OrderCardSkeleton />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <ErrorState errorCode={state.code} onRetry={onRetry} />
      </View>
    );
  }

  if (state.data.orders.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <EmptyState
          title="No orders yet"
          description="Your order history and one-tap reorders will show up here once you place your first order."
          primaryAction={{ label: 'Browse restaurants', onPress: onBrowse }}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={state.data.orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 16, gap: 16 }}
      renderItem={({ item }) => (
        <OrderCard
          variant="customer"
          order={item}
          onPress={() => onOpen(item.id)}
          actions={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => onReorder(item)}
                loading={busyId === item.id}
              >
                Reorder
              </Button>
              {item.state === 'COMPLETED' ? (
                <Button variant="tertiary" size="sm" onPress={() => onRate(item.id)}>
                  Rate order
                </Button>
              ) : null}
            </View>
          }
        />
      )}
    />
  );
}
