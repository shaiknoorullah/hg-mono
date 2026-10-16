/**
 * Menu reviews (`MenuReview`, `MenuReview-Reject`, `MenuReview-States`): pending menu versions,
 * oldest first, beside the version being read. `/menu-reviews/:versionId` opens a version.
 *
 * Only claim-bearing fields wait here (words, photo, dietary and allergen tags); price and
 * availability went live on save. The queue is for admins and super admins.
 *
 * Not built, with the reason: the restaurant's name on each version and the live version beside
 * the pending one are not in the contract (`MenuItemVersion` carries only `restaurant_id`; the
 * boards mark both Needs API), so the restaurant id is shown and there is no diff.
 */
import { useEffect, useState } from 'react';
import { useHref, useNavigate, useParams } from 'react-router-dom';

import { api } from '../data/api';
import { unwrap } from '../../lib/load';
import { useOnline } from '../auth/online';
import { usePagedList } from '../data/usePagedList';
import { formatShortDateTime } from '../data/format';
import { Banner, Button, DataGrid, EmptyState, ErrorState, InlineAlert, Skeleton, SplitPanes, type DataGridColumn } from '../ds';
import { REVIEWS } from './copy';
import { type Version } from './model';
import { VersionPanel } from './VersionPanel';

const PAGE_SIZE = 25;

async function fetchPage(_key: string, cursor: string | null) {
  const body = await unwrap(api.GET('/v1/admin/menu-reviews', { params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } }));
  return { rows: body.data, cursor: body.meta.next_cursor, hasMore: body.meta.has_more };
}

export default function MenuReviewsRoute() {
  const { versionId } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const base = useHref('/menu-reviews');
  const editBase = useHref('/restaurants');
  const list = usePagedList<Version>('queue', fetchPage);
  const { rows, setRows, load, loadingMore, loadMoreFailed, loadMore } = list;
  const page = { hasMore: list.hasMore };
  const [notice, setNotice] = useState<string | null>(null);
  const run = list.reload;

  const selected = versionId ? (rows.find((r) => r.id === versionId) ?? null) : null;
  const ready = load === 'ready';

  // A link to a version on a later page: keep reading pages until it is found or they run out.
  useEffect(() => {
    if (ready && versionId && !selected && page.hasMore && !loadingMore && !loadMoreFailed) void loadMore();
  }, [ready, versionId, selected, page.hasMore, loadingMore, loadMoreFailed, loadMore]);

  const columns: DataGridColumn<Version>[] = [
    {
      key: 'name',
      header: 'Item',
      render: (v) => (
        <span className="flex flex-col leading-tight">
          <span className="font-semibold text-fg-primary">{v.name}</span>
          <span className="text-body-sm text-fg-secondary">
            Version {v.version} · restaurant {v.restaurant_id ? <span className="font-mono">{v.restaurant_id.slice(0, 8)}</span> : 'not recorded'}
          </span>
        </span>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (v) => (v.submitted_at ? <time dateTime={v.submitted_at}>{formatShortDateTime(v.submitted_at)}</time> : <span className="text-fg-secondary">Not recorded</span>),
    },
  ];

  const listPane = (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="MenuReviewsListPane">
      {!online ? <Banner tone="warning" title="You’re offline" description="Decisions can’t be sent until you’re back online." announce="status" /> : null}
      <p className="m-0 max-w-[60ch] text-body-md text-fg-secondary">{REVIEWS.hint}</p>
      {notice ? (
        <InlineAlert tone="success-tint" title="Decision recorded">
          {notice}
        </InlineAlert>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line-decorative bg-surface-raised" aria-busy={load === 'loading'}>
        <DataGrid<Version>
          label={`${REVIEWS.listCaption}. ${ready ? REVIEWS.count(rows.length, page.hasMore) : ''}`.trim()}
          columns={columns}
          rows={rows}
          getRowId={(v) => v.id}
          rowLabel={(v) => `version ${v.version} of ${v.name}`}
          rowHref={(v) => `${base}/${v.id}`}
          onOpenRow={(v) => {
            setNotice(null);
            navigate(`/menu-reviews/${v.id}`);
          }}
          selectedId={versionId ?? null}
          loading={load === 'loading'}
          loadingSlot={<Skeleton variant="rows" count={6} label={REVIEWS.loading} />}
          errorSlot={load === 'error' ? <ErrorState title={REVIEWS.error.title} description={REVIEWS.error.body} onRetry={() => void run()} /> : undefined}
          emptySlot={<EmptyState icon="check" title={REVIEWS.empty.title} description={REVIEWS.empty.body} />}
          hasMore={page.hasMore}
          autoLoadMore={false}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onLoadMore={() => void loadMore()}
        />
      </div>
    </div>
  );

  let detail: React.ReactNode = null;
  if (versionId) {
    if (selected) {
      detail = (
        <VersionPanel
          key={selected.id}
          version={selected}
          editHref={selected.restaurant_id ? `${editBase}/${selected.restaurant_id}/menu/items/${selected.menu_item_id}` : null}
          onDecided={(v, decision) => {
            setRows((cur) => cur.filter((r) => r.id !== v.id));
            setNotice(decision === 'APPROVE' ? REVIEWS.approved(v.name, v.version) : REVIEWS.rejected(v.name, v.version));
            navigate('/menu-reviews');
          }}
          onSettle={() => {
            navigate('/menu-reviews');
            void run();
          }}
        />
      );
    } else if (load === 'loading' || (ready && page.hasMore)) {
      detail = <div className="p-4"><Skeleton variant="rows" count={4} label="Loading the version" /></div>;
    } else if (ready) {
      detail = (
        <div className="p-4">
          <EmptyState
            icon="info"
            title={REVIEWS.notWaiting.title}
            description={REVIEWS.notWaiting.body}
            action={<Button variant="tertiary" onPress={() => navigate('/menu-reviews')}>{REVIEWS.backToQueue}</Button>}
          />
        </div>
      );
    }
  }

  return (
    <section aria-label="Menu reviews" className="flex min-h-0 flex-1 flex-col">
      <SplitPanes
        panes={[
          { id: 'menu-list', label: 'Waiting for review', fill: !detail, defaultSize: 460, minSize: 320, maxSize: 640, content: listPane },
          ...(detail ? [{ id: 'menu-version', label: 'Version', fill: true, content: <div className="h-full overflow-auto border-s border-line-decorative">{detail}</div> }] : []),
        ]}
      />
    </section>
  );
}
