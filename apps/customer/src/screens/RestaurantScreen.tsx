/**
 * Restaurant detail + menu (C-12 / C-13).
 *
 * Two real reads, both served by the mock from fixtures:
 *   GET /v1/restaurants/{id}       → `RestaurantDetail` (card fields + certification panel)
 *   GET /v1/restaurants/{id}/menu  → `Menu` (categories, each with its `MenuItem[]`)
 *
 * The screen is deliberately built as one `Async` per read so the header can be up while the
 * menu is still loading, and either can fail independently — the certification panel and the
 * menu each carry their own empty/loading/error, per the mandatory-states rule.
 *
 * Adding an item POSTs to `/v1/cart/lines` and threads the recomputed cart's `item_count` into
 * the sticky "View cart" bar. Nothing about the price is sent or computed here (G-3); the binding
 * numbers only ever come from a quote, downstream at checkout.
 */
import * as React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isApiError, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  HalalCertificationPanel,
  MenuItemCard,
  MenuItemCardSkeleton,
  Spinner,
  Toast,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { api } from '../api/client';
import { addToCart, getCart } from '../api/cart';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';

type Detail = Schema['RestaurantDetail'];
type Menu = Schema['Menu'];

export function RestaurantScreen({ restaurantId }: { restaurantId: string }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();

  // "View certificate". The panel renders that action only when it is given a handler,
  // and this screen used to give it none — so the certificate was unreachable from
  // anywhere in the product, while the product's single claim is that it can be checked
  // (the halal certification spec asks customers to "view AND verify" —
  // docs/spec/02-customer.md "Halal certification display and verification"). The URL is
  // minted per request: presigned, 300 s, single use and audited server-side, never cached
  // here. It opens in the platform's viewer because @hg/ui-native has no DocumentViewer yet
  // (docs/design/02-components.md "DocumentViewer"); an in-app viewer is a library decision
  // for the redesign, not improvised here.
  //
  // "Report a halal concern" stays unwired on purpose: it routes to the grievance flow
  // (docs/spec/02-customer.md "Grievances and dispute escalation"), which has no endpoint in
  // the contract. A button that goes nowhere is worse than no button.
  const [certOpening, setCertOpening] = React.useState(false);
  const [certUnavailable, setCertUnavailable] = React.useState<'missing' | 'failed' | null>(null);
  const onViewCertificate = React.useCallback(async () => {
    if (certOpening) return;
    setCertOpening(true);
    setCertUnavailable(null);
    try {
      const res = await unwrap(
        api.POST('/v1/restaurants/{restaurantId}/certificate-url', {
          params: { path: { restaurantId } },
        }),
      );
      await Linking.openURL(res.data.url);
    } catch (e) {
      setCertUnavailable(isApiError(e) && e.status === 404 ? 'missing' : 'failed');
    } finally {
      setCertOpening(false);
    }
  }, [certOpening, restaurantId]);

  const detail = useAsync<Detail>(
    () =>
      unwrap(
        api.GET('/v1/restaurants/{restaurantId}', {
          params: { path: { restaurantId } },
        }),
      ).then((b) => b.data as unknown as Detail),
    [restaurantId],
  );

  const menu = useAsync<Menu>(
    () =>
      unwrap(
        api.GET('/v1/restaurants/{restaurantId}/menu', {
          params: { path: { restaurantId } },
        }),
      ).then((b) => b.data as unknown as Menu),
    [restaurantId],
  );

  const [itemCount, setItemCount] = React.useState<number | null>(null);
  const [busyItem, setBusyItem] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  // Reflect whatever is already in the cart into the sticky bar on entry.
  React.useEffect(() => {
    let cancelled = false;
    getCart()
      .then((cart) => {
        if (!cancelled) setItemCount(cart.item_count ?? cart.lines.length);
      })
      .catch(() => {
        /* an empty/absent cart just leaves the bar hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const onAdd = React.useCallback(async (menuItemId: string, name: string) => {
    setBusyItem(menuItemId);
    try {
      const cart = await addToCart(menuItemId, 1);
      setItemCount(cart.item_count ?? cart.lines.length);
      setToast(`Added ${name}`);
    } catch {
      setToast('Could not add that item. Try again.');
    } finally {
      setBusyItem(null);
    }
  }, []);

  const title = detail.state.kind === 'ready' ? detail.state.data.name : 'Restaurant';

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar
        title={title}
        back={{ onPress: nav.back, previousTitle: 'Discover' }}
        loading={detail.state.kind === 'loading'}
      />

      {detail.state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState errorCode={detail.state.code} onRetry={detail.reload} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 96 + insets.bottom, gap: 16 }}
        >
          <HalalCertificationPanel
            restaurantId={restaurantId}
            loading={detail.state.kind === 'loading'}
            certification={
              detail.state.kind === 'ready' ? detail.state.data.certification : undefined
            }
            onViewCertificate={onViewCertificate}
          />

          {certUnavailable ? (
            // Neutral, never warning: amber is the EXPIRING colour, and failing to open a
            // file says nothing about whether the restaurant is certified.
            <Banner
              variant="neutral"
              title="Couldn't open the certificate"
              description={
                certUnavailable === 'missing'
                  ? "This restaurant's certificate isn't available to view right now."
                  : 'Something went wrong opening it. Try again in a moment.'
              }
            />
          ) : null}

          {detail.state.kind === 'ready' && detail.state.data.description ? (
            <Banner
              variant="info"
              title={detail.state.data.name}
              description={detail.state.data.description}
            />
          ) : null}

          <MenuBody
            menu={menu.state}
            onRetry={menu.reload}
            onAdd={onAdd}
            busyItem={busyItem}
          />
        </ScrollView>
      )}

      {itemCount && itemCount > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: 16,
            paddingBottom: 16 + insets.bottom,
            backgroundColor: theme.color.surface.raised,
            borderTopWidth: 1,
            borderTopColor: theme.color.border.decorative,
          }}
        >
          <Button
            variant="primary"
            onPress={() => nav.push({ name: 'cart' })}
          >
            {`View cart · ${itemCount} item${itemCount === 1 ? '' : 's'}`}
          </Button>
        </View>
      ) : null}

      {toast ? (
        <Toast variant="info" title={toast} duration={2000} onDismiss={() => setToast(null)} />
      ) : null}
    </View>
  );
}

function MenuBody({
  menu,
  onRetry,
  onAdd,
  busyItem,
}: {
  menu: ReturnType<typeof useAsync<Menu>>['state'];
  onRetry: () => void;
  onAdd: (menuItemId: string, name: string) => void;
  busyItem: string | null;
}): React.ReactElement {
  if (menu.kind === 'loading') {
    return (
      <View style={{ gap: 12 }}>
        <Spinner label="Loading menu" />
        <MenuItemCardSkeleton />
        <MenuItemCardSkeleton />
        <MenuItemCardSkeleton />
      </View>
    );
  }

  if (menu.kind === 'error') {
    return <ErrorState errorCode={menu.code} onRetry={onRetry} />;
  }

  const categories = menu.data.categories ?? [];
  const totalItems = categories.reduce((n, c) => n + (c.items?.length ?? 0), 0);

  if (totalItems === 0) {
    return (
      <EmptyState
        title="Menu coming soon"
        description="This kitchen hasn't published any dishes yet. Check back shortly."
      />
    );
  }

  return (
    <View style={{ gap: 20 }}>
      {categories.map((category) => (
        <View key={category.id} style={{ gap: 12 }}>
          <CategoryHeading name={category.name} />
          {(category.items ?? []).map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              onAdd={() => onAdd(item.id, item.name)}
              loading={busyItem === item.id}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function CategoryHeading({ name }: { name: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  return (
    <View style={{ gap: 6 }}>
      <Text style={[heading, { color: theme.color.text.primary }]}>{name}</Text>
      <View style={{ height: 1, backgroundColor: theme.color.border.decorative }} />
    </View>
  );
}
