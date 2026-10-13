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
 *
 * A dish with a required variant group, or an add-on group with a minimum, cannot be added by id
 * alone: the server refuses a line that misses a required choice (#628, #629). Add on such a dish
 * opens a sheet that asks for exactly those choices, one variant per required group, and sends
 * them as `variant_ids` and `addons`. Every other dish is added at once, as before.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  HalalCertificationPanel,
  MenuItemCard,
  MenuItemCardSkeleton,
  Radio,
  RadioGroup,
  Sheet,
  Spinner,
  Toast,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { api } from '../api/client';
import { addToCart, getCart } from '../api/cart';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { OrderingPausedNotice, useOrderingPause } from '../ordering/orderingPause';
import {
  chooseVariant,
  initialChoice,
  missingChoice,
  needsChoice,
  requiredAddonGroups,
  requiredVariantGroups,
  toCartLineInput,
  toggleAddon,
  type LineChoice,
  type MenuItem,
} from '../ordering/lineChoice';

type Detail = Schema['RestaurantDetail'];
type Menu = Schema['Menu'];

export function RestaurantScreen({ restaurantId }: { restaurantId: string }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { paused: orderingPaused } = useOrderingPause();
  const nav = useNavigation();

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

  // The dish whose required choices the sheet is asking for, and what is chosen so far.
  const [choosing, setChoosing] = React.useState<{ item: MenuItem; choice: LineChoice } | null>(
    null,
  );

  const send = React.useCallback(async (item: MenuItem, choice: LineChoice) => {
    setBusyItem(item.id);
    try {
      const cart = await addToCart(toCartLineInput(item, choice));
      setItemCount(cart.item_count ?? cart.lines.length);
      setChoosing(null);
      setToast(`Added ${item.name}`);
    } catch {
      setToast('Could not add that item. Try again.');
    } finally {
      setBusyItem(null);
    }
  }, []);

  const onAdd = React.useCallback(
    (item: MenuItem) => {
      if (needsChoice(item)) {
        setChoosing({ item, choice: initialChoice(item) });
        return;
      }
      void send(item, initialChoice(item));
    },
    [send],
  );

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
          {orderingPaused ? <OrderingPausedNotice /> : null}

          <HalalCertificationPanel
            restaurantId={restaurantId}
            loading={detail.state.kind === 'loading'}
            certification={
              detail.state.kind === 'ready' ? detail.state.data.certification : undefined
            }
          />

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
            fullWidth
            onPress={() => nav.push({ name: 'cart' })}
          >
            {`View cart · ${itemCount} item${itemCount === 1 ? '' : 's'}`}
          </Button>
        </View>
      ) : null}

      {choosing ? (
        <ChoiceSheet
          item={choosing.item}
          choice={choosing.choice}
          onChange={(choice) => setChoosing({ item: choosing.item, choice })}
          onClose={() => setChoosing(null)}
          onConfirm={() => void send(choosing.item, choosing.choice)}
          busy={busyItem === choosing.item.id}
        />
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
  onAdd: (item: MenuItem) => void;
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
              onAdd={() => onAdd(item)}
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

/**
 * The required choices for one dish: a radio group per required variant group and a checkbox list
 * per add-on group with a minimum. Add stays disabled, with the reason beside it, until each is
 * made. Prices shown are the menu's own per-option amounts; nothing is summed here.
 */
function ChoiceSheet({
  item,
  choice,
  onChange,
  onClose,
  onConfirm,
  busy,
}: {
  item: MenuItem;
  choice: LineChoice;
  onChange: (choice: LineChoice) => void;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const missing = missingChoice(item, choice);
  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      description="Make your choices to add this to your cart."
      snapPoints={[0.75]}
      testID="choice-sheet"
      footer={
        <View style={{ gap: 8 }}>
          {missing ? (
            <Text style={[caption, { color: theme.color.text.secondary }]}>{missing}</Text>
          ) : null}
          <Button
            variant="primary"
            fullWidth
            disabled={missing !== null}
            loading={busy}
            onPress={onConfirm}
          >
            Add to cart
          </Button>
        </View>
      }
    >
      <View style={{ gap: 20 }}>
        {requiredVariantGroups(item).map((g) => (
          <RadioGroup
            key={g.id}
            name={g.id}
            label={g.name}
            required
            value={choice.variants[g.id] ?? null}
            onChange={(id) => onChange(chooseVariant(choice, g.id, id))}
          >
            {g.variants.map((v) => (
              <Radio
                key={v.id}
                value={v.id}
                label={v.name}
                {...(v.pricing_mode === 'DELTA' && v.delta_cents ? { priceDeltaCents: v.delta_cents } : {})}
                disabled={!v.is_available}
                {...(v.is_available ? {} : { disabledReason: 'Unavailable' })}
              />
            ))}
          </RadioGroup>
        ))}
        {requiredAddonGroups(item).map((g) => {
          const chosen = choice.addons[g.id] ?? [];
          return (
            <View key={g.id} style={{ gap: 8 }}>
              <Text style={[caption, { color: theme.color.text.secondary }]}>
                {g.min_select === g.max_select
                  ? `${g.name} · choose ${g.min_select}`
                  : `${g.name} · choose ${g.min_select} to ${g.max_select}`}
              </Text>
              {g.addons.map((a) => {
                const checked = chosen.includes(a.id);
                return (
                  <Checkbox
                    key={a.id}
                    label={a.name}
                    checked={checked}
                    onChange={() => onChange(toggleAddon(choice, g, a.id))}
                    {...(a.price_cents ? { priceDeltaCents: a.price_cents } : {})}
                    disabled={!a.is_available || (!checked && chosen.length >= g.max_select)}
                    {...(a.is_available ? {} : { disabledReason: 'Unavailable' })}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}
