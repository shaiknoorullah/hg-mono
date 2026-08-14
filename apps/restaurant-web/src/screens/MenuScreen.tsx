/**
 * Menu view — the restaurant's live customer-facing menu, read by the operator.
 *
 * Reads `getRestaurantMenu` (`GET /v1/restaurants/{restaurantId}/menu`, contract §C-13/R-14).
 * Categories are rendered in `sort_order`; out-of-stock items are shown and marked unavailable,
 * never hidden — the contract is explicit that hiding them misrepresents the menu.
 *
 * The layout is a compact operator register: a category rail on the left (a real table of
 * contents) and the selected category's items on the right, each an `@hg/ui-web` `MenuItemCard`
 * whose `item` is exactly the contract's `MenuItem` shape. Money renders only through `Price`
 * inside that card — never formatted by hand here.
 *
 * All three states: `Skeleton` rail + cards while loading, `ErrorState` keyed off the stable
 * `error.code` on failure, and `EmptyState` when a menu has no categories at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuItemData } from '@hg/ui-web';
import type { operations } from '@hg/api-client';
import {
  EmptyState,
  ErrorState,
  MenuItemCard,
  Skeleton,
  type ErrorStateCode,
} from '@hg/ui-web';

import { api } from '../lib/api';

type MenuResponse =
  operations['getRestaurantMenu']['responses']['200']['content']['application/json'];
type Menu = MenuResponse['data'];
type Category = Menu['categories'][number];

/** A demo restaurant id — the mock serves a full fixture menu for any well-formed id. */
const DEMO_RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

interface MenuError {
  code: ErrorStateCode | undefined;
  message: string | null;
  requestId: string | null;
}

interface MenuState {
  status: 'loading' | 'ready' | 'error';
  menu: Menu | null;
  error: MenuError | null;
}

const INITIAL: MenuState = { status: 'loading', menu: null, error: null };

function availabilityReason(item: MenuItemData): string | undefined {
  switch (item.availability_state) {
    case 'OUT_OF_STOCK':
      return 'Out of stock';
    case 'HIDDEN':
      return 'Hidden from customers';
    case 'BLOCKED':
      return 'Blocked by review';
    default:
      return undefined;
  }
}

export function MenuScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<MenuState>(INITIAL);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const { data, error, response } = await api.GET('/v1/restaurants/{restaurantId}/menu', {
        params: { path: { restaurantId: DEMO_RESTAURANT_ID } },
      });
      if (error || !data) {
        setState({
          status: 'error',
          menu: null,
          error: {
            code: error?.error?.code as ErrorStateCode | undefined,
            message: error?.error?.message ?? `HTTP ${response.status}`,
            requestId: error?.error?.request_id ?? null,
          },
        });
        return;
      }
      const menu = data.data as Menu;
      setState({ status: 'ready', menu, error: null });
      const first = [...menu.categories].sort((a, b) => a.sort_order - b.sort_order)[0];
      setActiveCategoryId(first?.id ?? null);
    } catch (cause) {
      setState({
        status: 'error',
        menu: null,
        error: {
          code: 'NETWORK_OFFLINE',
          message: cause instanceof Error ? cause.message : 'Network request failed',
          requestId: null,
        },
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo<readonly Category[]>(
    () =>
      state.menu ? [...state.menu.categories].sort((a, b) => a.sort_order - b.sort_order) : [],
    [state.menu],
  );

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === activeCategoryId) ?? categories[0] ?? null,
    [categories, activeCategoryId],
  );

  const back = () => navigate('/');

  if (state.status === 'loading') {
    return (
      <section className="rx-menu" aria-busy="true">
        <button type="button" className="rx-back" onClick={back}>
          ← Back to order queue
        </button>
        <div className="rx-menu-body">
          <aside className="rx-menu-rail">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height="2.25rem" />
            ))}
          </aside>
          <div className="rx-menu-items">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height="6rem" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="rx-menu">
        <button type="button" className="rx-back" onClick={back}>
          ← Back to order queue
        </button>
        <ErrorState
          variant="page"
          errorCode={state.error?.code}
          onRetry={() => void load()}
          technicalDetail={{
            requestId: state.error?.requestId,
            code: state.error?.code ?? null,
            message: state.error?.message,
          }}
        />
      </section>
    );
  }

  if (categories.length === 0) {
    return (
      <section className="rx-menu">
        <button type="button" className="rx-back" onClick={back}>
          ← Back to order queue
        </button>
        <EmptyState
          variant="page"
          title="No menu yet"
          description="This restaurant has no active menu categories. Add a category and items to start taking orders."
        />
      </section>
    );
  }

  return (
    <section className="rx-menu">
      <header className="rx-menu-head">
        <button type="button" className="rx-back" onClick={back}>
          ← Back to order queue
        </button>
        <h1 className="text-title-md text-fg-primary">Menu</h1>
        <p className="text-body-sm text-fg-secondary">
          The live customer-facing menu. Unavailable items stay listed.
        </p>
      </header>

      <div className="rx-menu-body">
        <nav className="rx-menu-rail" aria-label="Menu categories">
          {categories.map((category) => {
            const selected = category.id === activeCategory?.id;
            return (
              <button
                key={category.id}
                type="button"
                className={`rx-menu-cat${selected ? ' rx-menu-cat--active' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => setActiveCategoryId(category.id)}
              >
                <span className="rx-menu-cat-name">{category.name}</span>
                <span className="rx-menu-cat-count text-body-sm text-fg-secondary">
                  {category.items.length}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="rx-menu-items">
          {activeCategory ? (
            <>
              <h2 className="text-heading-sm text-fg-primary">{activeCategory.name}</h2>
              {activeCategory.description ? (
                <p className="text-body-sm text-fg-secondary">{activeCategory.description}</p>
              ) : null}
              {activeCategory.items.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="No items in this category"
                  description="Nothing has been added here yet."
                />
              ) : (
                <ul className="rx-menu-list">
                  {activeCategory.items.map((item) => {
                    const unavailable = item.availability_state !== 'AVAILABLE';
                    return (
                      <li key={item.id}>
                        <MenuItemCard
                          item={item as MenuItemData}
                          variant="row"
                          disabled={unavailable}
                          disabledReason={availabilityReason(item as MenuItemData)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
