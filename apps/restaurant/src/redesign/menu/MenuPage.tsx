/**
 * Menu (`/menu`; manifest §2.4, WP8; canvas MH, spec specs/wp8-menu.md).
 *
 *   banners · toolbar (search, Show, summary, Add category, Add item)
 *   panes: categories | items grid | [separator] | panel (details / add category / editor)
 *
 * The page never scrolls; the categories pane, the grid and each panel scroll on their own.
 * Panels are in-page (`?item=`, `?panel=category`, `?new=1`, `?edit=`), never modals. The
 * lock follows `account_state`: SUSPENDED/BANNED read-only (availability included), DELISTED
 * editable, DEACTIVATED view only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cents, formatCents, type Schema } from '@hg/api-client';
import { Badge, Button, Card, EmptyState, Icon, Input, ResizeHandle, Select, useToast } from '../ds';
import { useConsole } from '../data/console';
import { serverNow } from '../data/serverClock';
import { errorCode } from '../data/useServerResource';
import { usePagePanelOpen } from '../shell/layout';
import { AvailabilityCell, type RowStatus } from './AvailabilityCell';
import { CategoriesPane } from './CategoriesPane';
import { CategoryPanel } from './CategoryPanel';
import { ItemDetailsPanel } from './ItemDetailsPanel';
import { ItemEditor, type EditorSaved } from './ItemEditor';
import { ItemsGrid, type GridRow } from './ItemsGrid';
import { retryAfterSeconds, setItemAvailability, type AvailabilityBody } from './api';
import { menuBanners } from './banners';
import {
  FILTER_TITLE,
  MAX_CATEGORIES,
  ONE_HOUR_MS,
  SHOW_OPTIONS,
  type LengthChoice,
  type MenuItem,
  type ShowFilter,
  accessOf,
  allOutOfStock,
  categoryCountLabel,
  customersCantSee,
  itemCountLabel,
  itemName,
  orderableCount,
  searchMenu,
  totalItems,
} from './model';
import { changedElsewhere, useOwnMenu, useRestockedBySelf, withCategory, withItem } from './useOwnMenu';

type PanelKind = 'editor' | 'category' | 'details' | null;

function useIsDesktop(): boolean {
  const query = '(min-width: 1280px)';
  const [match, setMatch] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);
  return match;
}

function supportHrefOf(config: Schema['PublicConfig'] | null): string {
  return config?.support_phone_e164 ? `tel:${config.support_phone_e164}` : '/settings#support';
}

export function MenuPage() {
  const { profile, config, timezone } = useConsole();
  const menuRes = useOwnMenu();
  const { mutate, refresh, reload } = menuRes;
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const [refusedLock, setRefusedLock] = useState(false);
  const [liveChanged, setLiveChanged] = useState(false);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<ShowFilter>('all');
  const [catsPref, setCatsPref] = useState<'auto' | 'open' | 'closed'>('auto');
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [choices, setChoices] = useState<Record<string, LengthChoice>>({});
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [listPct, setListPct] = useState(42);
  const [now, setNow] = useState(() => serverNow());
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const menu = menuRes.data;
  const p = profile.data;
  const accountState = p?.account_state;
  const halal = p?.halal ?? null;
  const access = accessOf(accountState, refusedLock);
  const canEdit = access === 'edit';
  const supportHref = supportHrefOf(config.data);
  const restocked = useRestockedBySelf(menu);

  const loading = menuRes.status === 'loading' || (profile.status === 'loading' && !p);
  const loadError = menuRes.status === 'error';
  const firstRun = !loading && !loadError && menu !== null && menu.categories.length === 0;
  const atLimit = (menu?.categories.length ?? 0) >= MAX_CATEGORIES;

  // ── URL state ──────────────────────────────────────────────────────────────────────
  const editId = params.get('edit');
  const isNew = params.get('new') === '1';
  const itemParam = params.get('item');
  const categoryPanel = params.get('panel') === 'category';
  const panel: PanelKind = isNew || editId ? 'editor' : categoryPanel && canEdit && !atLimit ? 'category' : itemParam ? 'details' : null;
  usePagePanelOpen(panel !== null);
  useEffect(() => setCatsPref('auto'), [panel]);

  const searching = q.trim() !== '' || show !== 'all';
  const categories = menu?.categories ?? [];
  const selectedId = (() => {
    const wanted = params.get('category');
    if (wanted && categories.some((c) => c.id === wanted)) return wanted;
    return categories[0]?.id ?? null;
  })();
  const selected = categories.find((c) => c.id === selectedId) ?? null;

  const findItem = useCallback(
    (id: string | null): { item: MenuItem; category: (typeof categories)[number] } | null => {
      if (!id || !menu) return null;
      for (const c of menu.categories) {
        const item = c.items.find((i) => i.id === id);
        if (item) return { item, category: c };
      }
      return null;
    },
    [menu],
  );

  const setPanelParams = (next: Record<string, string | null>) => {
    const u = new URLSearchParams(params);
    for (const k of ['item', 'edit', 'new', 'panel']) u.delete(k);
    for (const [k, v] of Object.entries(next)) if (v !== null) u.set(k, v);
    setParams(u, { replace: false });
  };

  const closePanel = () => {
    setPanelParams({});
    const el = opener.current;
    window.setTimeout(() => {
      if (el && el.isConnected) el.focus();
    }, 0);
  };

  const openDetails = (row: GridRow, el: HTMLElement | null) => {
    if (params.get('item') === row.item.id) {
      closePanel();
      return;
    }
    opener.current = el;
    setPanelParams({ item: row.item.id });
  };
  const openEditor = (id: string | null, el: HTMLElement | null) => {
    opener.current = el;
    setPanelParams(id ? { edit: id } : { new: '1' });
  };
  const openCategoryPanel = (el: HTMLElement | null) => {
    opener.current = el;
    setPanelParams({ panel: 'category' });
  };

  const lockMenu = useCallback(() => {
    setRefusedLock(true);
    void profile.refresh();
  }, [profile]);

  // ── Availability (spec §2) ─────────────────────────────────────────────────────────
  const setStatus = (id: string, s: RowStatus | null) =>
    setStatuses((all) => {
      const next = { ...all };
      if (s) next[id] = s;
      else delete next[id];
      return next;
    });

  const runAvailability = async (row: GridRow, body: AvailabilityBody, intent: 'off' | 'on' | 'length', kind: LengthChoice['kind'] | null) => {
    const id = row.item.id;
    const name = itemName(row.item);
    setStatus(id, { kind: 'saving' });
    setMenuOpenFor(null);
    try {
      const saved = await setItemAvailability(id, body);
      if (changedElsewhere(row.item, saved)) setLiveChanged(true);
      mutate((m) => withItem(m, saved));
      if (kind === 'hour' && saved.out_of_stock_until) setChoices((c) => ({ ...c, [id]: { kind: 'hour', until: saved.out_of_stock_until! } }));
      if (kind === 'indefinite') setChoices((c) => ({ ...c, [id]: { kind: 'indefinite' } }));
      if (intent === 'off' && saved.availability_state === 'OUT_OF_STOCK') {
        setStatus(id, { kind: 'just-off' });
        setMenuOpenFor(id);
      } else {
        setStatus(id, null);
      }
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ITEM_BLOCKED_BY_ADMIN') {
        mutate((m) => withItem(m, { ...row.item, availability_state: 'BLOCKED' }));
        setStatus(id, { kind: 'blocked-refused' });
        toast.show({ variant: 'warning', title: `${name} is blocked by HalalGoes. Your change wasn’t saved.`, description: 'Contact support to find out why.' });
      } else if (code === 'MENU_LOCKED') {
        setStatus(id, { kind: 'locked-refused' });
        lockMenu();
      } else if (code === 'RATE_LIMITED') {
        setStatus(id, null);
        const s = retryAfterSeconds(error);
        const m = s ? Math.ceil(s / 60) : null;
        toast.show({
          variant: 'warning',
          title: 'Too many availability changes',
          description: m
            ? `You can make 120 changes an hour. Try again in ${m === 1 ? '1 minute' : `${m} minutes`}. Nothing else changed.`
            : 'You can make 120 changes an hour. Nothing else changed.',
        });
      } else if (code === 'NOT_FOUND') {
        setStatus(id, null);
        setLiveChanged(true);
      } else {
        const retry = () => void runAvailability(row, body, intent, kind);
        setStatus(id, { kind: 'failed', intent, retry });
        toast.show({
          variant: 'danger',
          title: intent === 'on' ? `Couldn’t mark ${name} available` : `Couldn’t mark ${name} out of stock`,
          description:
            intent === 'on'
              ? 'It is still out of stock for customers. Check your connection and try again.'
              : 'It is still available to customers. Check your connection and try again.',
          action: { label: 'Try again', onAction: retry },
        });
      }
    }
  };

  const hourBody = (): AvailabilityBody => ({ availability_state: 'OUT_OF_STOCK', out_of_stock_until: new Date(serverNow() + ONE_HOUR_MS).toISOString() });

  const onSwitch = (row: GridRow, on: boolean) => {
    if (!canEdit) return;
    if (on) void runAvailability(row, { availability_state: 'AVAILABLE', out_of_stock_until: null }, 'on', null);
    // Until closing needs the next closing time (Needs API): turning off is For 1 hour (spec §2 fallback).
    else void runAvailability(row, hourBody(), 'off', 'hour');
  };
  const onLength = (row: GridRow, c: 'hour' | 'indefinite') => {
    if (!canEdit) return;
    void runAvailability(row, c === 'hour' ? hourBody() : { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null }, 'length', c);
  };
  const onMenuOpen = (id: string | null) => {
    if (id === null && menuOpenFor && statuses[menuOpenFor]?.kind === 'just-off') setStatus(menuOpenFor, null);
    setMenuOpenFor(id);
  };

  // ── Grid content ───────────────────────────────────────────────────────────────────
  const results = useMemo(() => (menu && searching ? searchMenu(menu, q, show) : []), [menu, searching, q, show]);
  const rows: GridRow[] = searching
    ? results.flatMap((g) => g.items.map((item) => ({ item, category: g.category })))
    : (selected?.items ?? []).map((item) => ({ item, category: selected! }));
  const lockId = `${selected?.id ?? 'menu'}-lock`;

  let gridTitle = selected?.name ?? '';
  if (loading) gridTitle = 'Loading…';
  else if (searching && q.trim()) gridTitle = rows.length === 1 ? `1 item matches “${q.trim()}”` : `${rows.length} items match “${q.trim()}”`;
  else if (searching && show !== 'all') gridTitle = FILTER_TITLE[show].title;

  const selectedAllOut = selected ? allOutOfStock(selected.items) : false;
  const selectedNoLive = selected ? selected.items.length > 0 && !selected.items.some((i) => i.live_version) : false;
  const gridBadges =
    !searching && selected && !loading ? (
      <>
        {!selected.is_active ? <Badge label="Inactive category" variant="neutral" size="sm" /> : null}
        {selected.is_active && selectedNoLive ? <Badge label="Not on your menu yet" appearance="outline" size="sm" /> : null}
        {selectedAllOut ? <Badge label="All out of stock" variant="warning" size="sm" /> : null}
      </>
    ) : null;
  const gridExplanation =
    !searching && selected && !loading ? (
      <>
        {!selected.is_active ? (
          <p className="text-[14px] text-fg-secondary">
            Customers don’t see this category or anything in it. Only HalalGoes support can turn it back on today.{' '}
            <a href={supportHref} className="hg-focus text-fg-link underline">
              Contact support
            </a>
          </p>
        ) : selectedNoLive ? (
          <p className="text-[14px] text-fg-secondary">
            No item in {selected.name} is approved yet, so customers don’t see this category. It appears once a HalalGoes reviewer approves an item in it.
          </p>
        ) : null}
        {selectedAllOut ? (
          <p role="status" className="rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2 text-[14px]">
            <strong>Everything in {selected.name} is out of stock.</strong> Customers still see {selected.name} but can’t order from it. Turn each item back on with its
            switch.
          </p>
        ) : null}
        {access === 'locked' ? (
          <p id={lockId} className="text-[14px] text-fg-secondary">
            Availability is locked: read-only while your account is suspended.
          </p>
        ) : null}
      </>
    ) : access === 'locked' ? (
      <p id={lockId} className="text-[14px] text-fg-secondary">
        Availability is locked: read-only while your account is suspended.
      </p>
    ) : null;

  const clearSearch = () => {
    setQ('');
    setShow('all');
  };

  const filterNoun = show === 'all' ? 'items' : FILTER_TITLE[show].noun;
  const emptyState = searching ? (
    <EmptyState
      variant="table"
      headingLevel={3}
      title={q.trim() ? `No ${filterNoun} match “${q.trim()}”` : `No ${filterNoun}`}
      description="Check the spelling, or clear the search and filter to see every item."
      primaryAction={{ label: 'Clear search and filter', onPress: clearSearch }}
      secondaryAction={canEdit ? { label: 'Add item', onPress: () => openEditor(null, null) } : undefined}
    />
  ) : selected ? (
    <EmptyState
      variant="table"
      headingLevel={3}
      title={`No items in ${selected.name} yet`}
      description="Add an item to fill this category. It goes to a HalalGoes reviewer before customers see it."
      primaryAction={canEdit ? { label: `Add item to ${selected.name}`, onPress: () => openEditor(null, null) } : undefined}
    />
  ) : null;

  // ── Summary (spec §3) ──────────────────────────────────────────────────────────────
  let summary: string;
  if (loading) summary = 'Loading your menu…';
  else if (loadError || !menu) summary = 'Your menu didn’t load.';
  else if (firstRun) summary = 'Your menu is empty.';
  else if (access === 'view-only') summary = 'View only while deactivated.';
  else if (searching) {
    summary = rows.length ? `${itemCountLabel(rows.length)} in ${categoryCountLabel(results.length)}. Categories with no match are left out.` : 'No matches.';
  } else {
    const head = `Your menu: ${itemCountLabel(totalItems(menu))} in ${categoryCountLabel(menu.categories.length)}.`;
    summary = customersCantSee(accountState, halal?.display_state) ? `${head} Customers can’t see it right now.` : `${head} Customers can order ${orderableCount(menu)} of them now.`;
  }

  // main[aria-busy] while the first read is in flight.
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    if (loading) main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
    return () => main.removeAttribute('aria-busy');
  }, [loading]);

  // ── Banners ────────────────────────────────────────────────────────────────────────
  const everyOut = menu ? menu.categories.flatMap((c) => c.items).length > 0 && menu.categories.flatMap((c) => c.items).every((i) => i.availability_state === 'OUT_OF_STOCK') : false;
  const banners = menuBanners({
    accountState: refusedLock && accountState !== 'BANNED' ? 'SUSPENDED' : accountState,
    halal,
    supportHref,
    stale: menuRes.status === 'stale' ? { at: menuRes.loadedAt, onRetry: () => void refresh() } : null,
    liveChanges: liveChanged
      ? {
          onRefresh: () => {
            setLiveChanged(false);
            void refresh();
          },
        }
      : null,
    allOut: everyOut,
    timeZone: timezone,
    onShowNotApproved: () => setShow('rejected'),
  });

  // ── Panels ─────────────────────────────────────────────────────────────────────────
  const detailsRow = panel === 'details' ? findItem(itemParam) : null;
  const editorTarget = panel === 'editor' && editId ? findItem(editId) : null;
  const editorItem: MenuItem | null | undefined = panel === 'editor' && editId ? (editorTarget?.item ?? (menu ? null : undefined)) : undefined;
  const narrow = panel !== null || !isDesktop;
  const catsCollapsed = catsPref === 'closed' || (catsPref === 'auto' && panel !== null);
  const addItemVariant = firstRun || halal?.display_state === 'EXPIRED' || accountState === 'DELISTED' ? 'tertiary' : 'primary';

  const onSaved = (saved: EditorSaved) => {
    mutate((m) => withItem(m, saved.item));
    void refresh();
    const n = itemName(saved.item);
    if (saved.kind === 'created') {
      toast.show({
        variant: 'success',
        title: `${n} sent for review`,
        description: `Customers see it once a HalalGoes reviewer approves it. It’s in ${saved.categoryName}, marked Waiting for first review.`,
      });
    } else if (saved.kind === 'price') {
      toast.show({
        variant: 'success',
        title: 'Price saved',
        description: `${n} is now ${formatCents(cents(saved.item.price_cents))} for new orders. Orders already placed keep their price.`,
      });
    } else if (saved.kind === 'review') {
      toast.show({ variant: 'success', title: `${n} sent for review`, description: 'Customers see the approved version until a HalalGoes reviewer approves your change.' });
    } else {
      toast.show({ variant: 'success', title: 'Changes saved', description: `${n} is updated for new orders. Orders already placed keep their price.` });
    }
    closePanel();
  };

  const panelNode =
    panel === 'details' && detailsRow ? (
      <ItemDetailsPanel
        key={detailsRow.item.id}
        item={detailsRow.item}
        categoryName={detailsRow.category.name}
        canEdit={canEdit}
        timeZone={timezone}
        supportHref={supportHref}
        onClose={closePanel}
        onEdit={() => setPanelParams({ edit: detailsRow.item.id })}
        availability={
          <AvailabilityCell
            item={detailsRow.item}
            categoryName={detailsRow.category.name}
            categoryActive={detailsRow.category.is_active}
            access={access}
            lockId={lockId}
            status={statuses[detailsRow.item.id]}
            choice={choices[detailsRow.item.id]}
            menuOpen={false}
            onMenuOpenChange={() => {}}
            onSwitch={(on) => onSwitch(detailsRow, on)}
            onLength={(c) => onLength(detailsRow, c)}
            restockedAt={restocked.get(detailsRow.item.id)}
            now={now}
            timeZone={timezone}
            supportHref={supportHref}
          />
        }
      />
    ) : panel === 'category' ? (
      <CategoryPanel
        onClose={closePanel}
        onLocked={() => {
          lockMenu();
          closePanel();
        }}
        onCreated={(created) => {
          mutate((m) => withCategory(m, created));
          const u = new URLSearchParams(params);
          for (const k of ['item', 'edit', 'new', 'panel']) u.delete(k);
          u.set('category', created.id);
          setParams(u);
          clearSearch();
          toast.show({ variant: 'success', title: `${created.name} added`, description: 'Customers see it once it has an approved item. Add the first one now.' });
        }}
      />
    ) : panel === 'editor' ? (
      <ItemEditor
        key={editId ?? 'new'}
        itemId={editId}
        item={editorItem}
        menuStatus={menuRes.status}
        categories={categories}
        defaultCategoryId={selectedId}
        access={access}
        halal={halal?.display_state ?? null}
        timeZone={timezone}
        supportHref={supportHref}
        onClose={closePanel}
        onSaved={onSaved}
        onLocked={lockMenu}
        onReload={() => refresh()}
        onShowDetails={(id) => setPanelParams({ item: id })}
      />
    ) : null;

  const editingId = panel === 'editor' ? editId : null;

  // ── Render ─────────────────────────────────────────────────────────────────────────
  const centerCard = loadError ? (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto pt-6">
      <Card variant="outlined" radius="lg" padding="32px" className="w-full max-w-[600px]">
        <div role="alert" className="flex flex-col items-start gap-3">
          <h2 className="text-[22px] font-semibold">We couldn’t load your menu</h2>
          <p className="text-[16px] text-fg-secondary">Nothing on it has changed. Check your connection and try again.</p>
          <Button variant="primary" size="lg" onPress={reload}>
            Try again
          </Button>
        </div>
      </Card>
    </div>
  ) : firstRun ? (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto pt-6">
      <Card variant="outlined" radius="lg" padding="32px" className="w-full max-w-[600px]">
        <section role="region" aria-labelledby="first-run-h" className="flex flex-col items-start gap-3">
          <Icon name="menu" size={32} className="text-fg-secondary" />
          <h2 id="first-run-h" className="text-[22px] font-semibold">
            Start your menu
          </h2>
          <p className="text-[16px] text-fg-secondary">
            Customers can’t order from you until at least one item is approved. Create a category first, such as Mains or Drinks, then add items to it.
          </p>
          <ol className="list-decimal ps-5 text-[16px]">
            <li>Create a category.</li>
            <li>Add items with their price, allergens and a photo.</li>
            <li>A HalalGoes reviewer checks each item. Approved items go live on your menu.</li>
          </ol>
          {canEdit ? (
            <Button variant="primary" size="lg" iconStart={<Icon name="plus" size={20} />} onClick={(e) => openCategoryPanel(e.currentTarget)}>
              Create your first category
            </Button>
          ) : null}
        </section>
      </Card>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-hg-density="compact" data-testid="menu-page">
      {banners.length ? <div className="flex flex-col gap-2">{banners}</div> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div role="search" aria-label="Find items" className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <div className="w-[280px] max-w-full">
            <Input
              label="Search this menu"
              hideLabel
              placeholder="Search this menu"
              variant="search"
              prefix={<Icon name="search" size={18} />}
              value={q}
              onChange={(v) => setQ(v)}
              disabled={loading || loadError}
            />
          </div>
          <div className="w-[200px]">
            <Select label="Show" options={SHOW_OPTIONS} value={show} onChange={(v) => setShow(v as ShowFilter)} disabled={loading || loadError} />
          </div>
          {q ? (
            <Button variant="ghost" iconStart={<Icon name="close" size={18} />} onPress={() => setQ('')}>
              Clear search
            </Button>
          ) : null}
          <p role="status" className="min-w-[200px] flex-1 self-center text-[14px] text-fg-secondary">
            {summary}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-col items-end gap-1">
            {atLimit ? (
              <p className="text-end text-[13px] text-fg-secondary">
                You have 40 categories, the most allowed.{' '}
                <a href={supportHref} className="hg-focus text-fg-link underline">
                  Contact support
                </a>{' '}
                to remove one.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="tertiary"
                iconStart={<Icon name="plus" size={18} />}
                disabled={loading || loadError || atLimit}
                accessibilityLabel={atLimit ? 'Add category. Not available: you have 40 categories, the most allowed.' : undefined}
                onClick={(e) => openCategoryPanel(e.currentTarget)}
              >
                Add category
              </Button>
              <Button
                variant={addItemVariant}
                iconStart={<Icon name="plus" size={18} />}
                disabled={loading || loadError || firstRun}
                onClick={(e) => openEditor(null, e.currentTarget)}
              >
                Add item
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {centerCard ?? (
          <>
            <CategoriesPane
              categories={loading ? null : categories}
              countOf={(c) => (searching ? (results.find((g) => g.category.id === c.id)?.items.length ?? 0) : c.items.length)}
              selectedId={selectedId}
              searching={searching}
              collapsed={catsCollapsed}
              onCollapse={() => setCatsPref('closed')}
              onExpand={() => setCatsPref('open')}
              hrefFor={(id) => {
                const u = new URLSearchParams(params);
                u.set('category', id);
                return `?${u.toString()}`;
              }}
            />
            <div
              className="flex min-h-0 min-w-0 flex-col"
              style={panel === 'editor' ? { flexBasis: `${listPct}%`, flexGrow: 0, flexShrink: 0 } : { flex: '1 1 0%' }}
            >
              <ItemsGrid
                headingId={selected && !searching ? `cat-${selected.id}` : 'menu-results'}
                title={gridTitle}
                count={loading || searching ? null : (selected?.items.length ?? 0)}
                badges={gridBadges}
                explanation={gridExplanation}
                rows={rows}
                loading={loading}
                results={searching}
                narrow={narrow}
                access={access}
                lockId={lockId}
                detailsFor={panel === 'details' ? itemParam : null}
                editingId={editingId}
                statusOf={(id) => statuses[id]}
                choiceOf={(id) => choices[id]}
                menuOpenFor={menuOpenFor}
                setMenuOpenFor={onMenuOpen}
                onSwitch={onSwitch}
                onLength={onLength}
                onDetails={openDetails}
                onEdit={(row, el) => openEditor(row.item.id, el)}
                restocked={restocked}
                now={now}
                timeZone={timezone}
                supportHref={supportHref}
                emptyState={emptyState}
              />
            </div>
          </>
        )}
        {panel === 'editor' && !centerCard ? (
          <ResizeHandle
            label="Resize the items list and the editor"
            controls="item-editor"
            value={listPct}
            onChange={setListPct}
            valueText={(v) => `Items list ${v} percent of the width`}
          />
        ) : null}
        {panelNode}
      </div>
    </div>
  );
}
