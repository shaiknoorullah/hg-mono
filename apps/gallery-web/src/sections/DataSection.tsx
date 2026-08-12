/**
 * The data tier — the admin surface's working set.
 *
 * Two invariants hold across all of it and both are visible below: PII is masked by
 * default and there is no prop that turns masking off, and pagination is keyset, always,
 * because that is the only scheme the contract has.
 */
import { useMemo, useState } from 'react';
import { cents } from '@hg/api-client';
import {
  DataTable,
  DocumentViewer,
  FilterBar,
  ORDER_STATE_LABELS,
  PII_JUSTIFICATION_LABELS,
  PII_JUSTIFICATION_CODES,
  Pagination,
  PiiCell,
  Price,
  useCursorPagination,
  type DataTableColumn,
  type DataTableSort,
  type FilterValue,
  type PageMeta,
  type PiiRevealRequest,
} from '@hg/ui-web';

import {
  ComponentBlock,
  DefinitionList,
  Finding,
  Note,
  Row,
  Section,
  Specimen,
  SpecimenGrid,
  Stack,
} from '../gallery/kit';
import {
  RESTAURANT_QUEUE_DUPLICATES,
  cite,
  documentFixtures,
  orderFixtures,
  restaurantQueue,
} from '../lib/fixtures';
import { makePlaceholderCertificatePng } from '../lib/placeholderDocument';

type QueueRow = (typeof restaurantQueue)[number];

const PLACEHOLDER_PNG = makePlaceholderCertificatePng();

/**
 * The reveal handler the gallery supplies.
 *
 * On a real admin surface this calls the contract's reveal path, the server writes a
 * `pii_access_event` row and the **server** returns the unmasked value — the client never
 * has it before then. There is no server here, so this resolves with an obviously-fake
 * string after a delay. What is real is everything around it: the justification gate, the
 * case requirement, the audit copy and the time-boxed re-mask.
 */
function galleryReveal(request: PiiRevealRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (request.justificationCode === 'LEGAL_REQUEST' && !request.caseId) {
        reject(new Error('422 CASE_REQUIRED — a legal request must carry a case reference.'));
        return;
      }
      resolve('+1 416 555 0142 (stand-in — no server is running)');
    }, 500);
  });
}

const EMPTY_META: PageMeta = { has_more: false, next_cursor: null };

export function DataSection() {
  const [sort, setSort] = useState<DataTableSort | null>({ key: 'placed_at', direction: 'desc' });
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ state: 'RESTAURANT_PENDING' });
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('waiting');
  const [docState, setDocState] = useState<'loaded' | 'expired' | 'error' | 'unsupported' | 'idle' | 'pdf'>(
    'loaded',
  );

  const paging = useCursorPagination({ limit: 20 });

  /** Two pages, carved out of the distinct real orders, so `has_more` is not a fiction. */
  const pageSize = 2;
  const page = paging.cursor === null ? 0 : 1;
  const rows = useMemo(
    () => restaurantQueue.slice(page * pageSize, page * pageSize + pageSize),
    [page],
  );
  const meta: PageMeta = useMemo(
    () =>
      page === 0
        ? {
            has_more: true,
            next_cursor: 'eyJwbGFjZWRfYXQiOiIyMDI2LTA4LTEwVDE4OjEwOjExWiJ9',
            total: restaurantQueue.length,
          }
        : { has_more: false, next_cursor: null, total: restaurantQueue.length },
    [page],
  );

  const columns = useMemo<readonly DataTableColumn<QueueRow>[]>(
    () => [
      {
        key: 'code',
        header: 'Order',
        contentClass: 'id',
        sortKey: 'code',
        width: '9rem',
        cell: (row) => row.code,
        textValue: (row) => row.code,
      },
      {
        key: 'state',
        header: 'State',
        contentClass: 'enum',
        sortKey: 'state',
        width: '11rem',
        // The one shared vocabulary — a table column and a timeline cannot disagree.
        cell: (row) => ORDER_STATE_LABELS[row.state],
      },
      {
        // Not `customer_name`: DataTable's development-time heuristic flags any column
        // whose key looks like personal data and carries no `pii` declaration, and the
        // documented remedy is "declare it, or rename it if it is not PII". The server
        // sends an already-abbreviated display name ("Ayesha R."), not a full name.
        key: 'customer_display',
        header: 'Customer',
        width: '10rem',
        cell: (row) => row.customer?.display_name ?? '—',
      },
      {
        key: 'customer_phone',
        header: 'Phone',
        width: '18rem',
        // Declaring `pii` is what masks the column. There is no `masked: false`.
        pii: {
          field: 'customer_phone',
          noun: 'the customer’s phone number',
          requiresCase: true,
        },
        cell: (row, context) => context.revealedValue ?? row.customer?.phone_masked ?? '—',
      },
      {
        key: 'area',
        header: 'Area',
        width: '10rem',
        cell: (row) => row.delivery_area ?? '—',
      },
      {
        key: 'total',
        header: 'Total',
        contentClass: 'money',
        sortKey: 'total_cents',
        width: '8rem',
        cell: (row) => <Price cents={cents(row.money.total_cents)} size="sm" />,
      },
      {
        key: 'placed_at',
        header: 'Placed',
        contentClass: 'date',
        sortKey: 'placed_at',
        width: '12rem',
        cell: (row) => new Date(row.placed_at).toLocaleString('en-CA'),
      },
    ],
    [],
  );

  const documentProps = {
    title: 'Halal certificate HMA-ON-40182',
    onRequestAgain: () => undefined,
    auditNotice: true,
  };

  return (
    <Section
      id="data"
      title="Data — the admin working set"
      blurb="The load-bearing admin components. Read the Phone column first: it is masked, there is no prop that unmasks it, and the reveal control only exists because a handler was supplied."
      source="packages/ui-web/src/data/"
    >
      <Note>
        <strong>Masking is applied server-side</strong> (A-42 R1): a masked field is never
        present in the response in unmasked form. The client’s job is therefore not to mask —
        it is to never accidentally present an unmasked field, and to make revealing one an
        explicit, justified, audited act. Hence: no <code>masked</code> prop, no{' '}
        <code>revealByDefault</code>, a cell renderer that is handed{' '}
        <code>{'{ revealed: false }'}</code> on every render until a reveal completes, and no
        reveal control at all unless the host passes <code>onRevealPii</code>.
      </Note>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="DataTable"
        purpose="Rows, sorting, selection, row actions, keyset pagination and PII masking, with the header retained in every single state."
        declaredStates={[
          'rows',
          'row selected',
          'sorted',
          'loading (skeleton rows in the real geometry)',
          'loading-more (tail skeleton)',
          'empty',
          'empty-after-filter',
          'queue drained (positive)',
          'error',
          'PII masked / revealing / revealed / re-masked',
        ]}
        notes={
          <>
            Keyboard: click any cell and use the arrow keys — the whole grid is one tab stop,
            with <code>Home</code>/<code>End</code>, <code>Ctrl+Home</code>/<code>Ctrl+End</code>{' '}
            and type-ahead on the order code. Every sortable header carries{' '}
            <code>aria-sort</code>, and the table has a <code>&lt;caption&gt;</code>.
          </>
        }
      >
        <Specimen
          label="Live table — masked by default, with the reveal flow"
          wide
          fixture={cite(orderFixtures.restaurantQueueBusy)}
          caption="Press the eye in the Phone column. A dialog demands a justification from the closed A-42 vocabulary plus a case reference, and says in plain words that the access is written to the log against your account. Choose “Legal request” and leave the case blank to see the server’s 422 CASE_REQUIRED surfaced inline rather than as a silent failure. A completed reveal re-masks itself after 20 seconds — watch it flip back."
        >
          <Stack>
            <FilterBar
              filters={[
                {
                  key: 'state',
                  label: 'State',
                  kind: 'select',
                  options: [
                    { value: 'RESTAURANT_PENDING', label: 'Awaiting response' },
                    { value: 'PREPARING', label: 'Preparing' },
                    { value: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
                  ],
                },
                {
                  key: 'area',
                  label: 'Area',
                  kind: 'multiselect',
                  options: [
                    { value: 'Greektown', label: 'Greektown' },
                    { value: 'Riverdale', label: 'Riverdale' },
                    { value: 'Leslieville', label: 'Leslieville' },
                  ],
                },
                { key: 'placed_after', label: 'Placed after', kind: 'date' },
              ]}
              value={filters}
              onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
              onClear={() => setFilters({})}
              search={{
                value: search,
                onChange: setSearch,
                placeholder: 'Order code or customer',
                label: 'Search the queue',
              }}
              savedViews={[
                { key: 'waiting', label: 'Waiting on us' },
                { key: 'late', label: 'Late' },
                { key: 'all', label: 'All open' },
              ]}
              activeView={activeView}
              onViewChange={setActiveView}
              resultCount={rows.length}
              resultUnit="orders"
            />

            <DataTable
              caption="Restaurant order queue"
              columns={columns}
              rows={rows}
              getRowId={(row) => row.id}
              getRowLabel={(row) => `order ${row.code}`}
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                // A keyset cursor encodes the sort tuple, so a re-sort must reset it.
                paging.reset();
              }}
              selection={{
                selectedIds: selected,
                onChange: setSelected,
              }}
              rowActions={(row) => [
                { key: 'open', label: `Open ${row.code}`, onSelect: () => undefined },
                {
                  key: 'cancel',
                  label: 'Cancel order',
                  destructive: true,
                  onSelect: () => undefined,
                  disabled: row.state !== 'RESTAURANT_PENDING',
                  disabledReason: 'Only an order still awaiting a response can be cancelled here.',
                },
              ]}
              onRowActivate={() => undefined}
              onRevealPii={galleryReveal}
              revealTtlMs={20_000}
              onPiiRevealed={() => undefined}
              pagination={{
                meta,
                limit: paging.limit,
                onNext: () => paging.next(meta),
                onPrevious: paging.previous,
                canGoPrevious: paging.canGoPrevious,
                onLimitChange: paging.setLimit,
                mode: 'pages',
                unit: 'orders',
              }}
              entityPlural="orders"
              filtersActive={Object.keys(filters).length > 0}
              onClearFilters={() => setFilters({})}
              stickyFirstColumn
            />
          </Stack>
        </Specimen>

        <Finding title="What the reveal actually asks for">
          <DefinitionList
            rows={[
              [
                'Justification vocabulary',
                PII_JUSTIFICATION_CODES.map((code) => PII_JUSTIFICATION_LABELS[code]).join(' · '),
              ],
              ['Case reference', 'Required by default — a reveal without one is 422 CASE_REQUIRED'],
              ['Exposure', 'Time-boxed; the cell re-masks itself and the timer is cleared on unmount'],
              ['Audit', 'The server writes a pii_access_event row; the dialog says so before you confirm'],
            ]}
          />
        </Finding>

        <Finding title="The busy-queue fixture repeats the same orders">
          <p>
            <code>contracts/fixtures/orders/restaurant_order_queue_busy.json</code> has{' '}
            {RESTAURANT_QUEUE_DUPLICATES.entries} entries but only{' '}
            {RESTAURANT_QUEUE_DUPLICATES.distinct} distinct <code>id</code> values —{' '}
            <code>face3cd1…</code> appears twice and <code>c622bd1b…</code> three times, each
            with the same order code. Rendered as-is it collides React keys and makes row
            selection ambiguous, because <code>DataTable</code> keys selection on{' '}
            <code>getRowId</code>. The gallery de-duplicates by id, which is why the table below
            shows {RESTAURANT_QUEUE_DUPLICATES.distinct} orders rather than{' '}
            {RESTAURANT_QUEUE_DUPLICATES.entries}. The fixture generator is what needs the fix.
          </p>
        </Finding>

        <SpecimenGrid min="26rem">
          <Specimen
            label="Loading"
            forced
            caption="Five skeleton rows in the real column geometry. Never a centred spinner replacing the table — that loses the header and the user’s place."
          >
            <DataTable
              caption="Restaurant order queue, loading"
              columns={columns}
              rows={[]}
              getRowId={(row) => row.id}
              loading
            />
          </Specimen>

          <Specimen
            label="Loading more"
            forced
            caption="A skeleton row at the tail; the loaded rows stay exactly where they were."
          >
            <DataTable
              caption="Restaurant order queue, loading more"
              columns={columns.slice(0, 4)}
              rows={rows.slice(0, 2)}
              getRowId={(row) => row.id}
              loadingMore
              onRevealPii={galleryReveal}
            />
          </Specimen>

          <Specimen label="Empty" forced caption="No records at all, with the header retained.">
            <DataTable
              caption="Restaurant order queue, empty"
              columns={columns.slice(0, 4)}
              rows={[]}
              getRowId={(row) => row.id}
              entityPlural="orders"
            />
          </Specimen>

          <Specimen
            label="Empty after a filter"
            forced
            caption="Distinct copy and a Clear filters action. A filtered-to-nothing table is not the same event as an empty one and must not say “No records yet”."
          >
            <DataTable
              caption="Restaurant order queue, filtered to nothing"
              columns={columns.slice(0, 4)}
              rows={[]}
              getRowId={(row) => row.id}
              filtersActive
              onClearFilters={() => undefined}
              entityPlural="orders"
            />
          </Specimen>

          <Specimen
            label="Queue drained"
            forced
            caption="The positive empty state, with the last-processed time — an admin has to be able to tell “done” from “broken”."
          >
            <DataTable
              caption="Halal review queue, drained"
              columns={columns.slice(0, 4)}
              rows={[]}
              getRowId={(row) => row.id}
              drained={{ queueName: 'Halal review', lastProcessedAt: '2026-08-10T18:42:11.412Z' }}
            />
          </Specimen>

          <Specimen
            label="Error"
            forced
            fixture="contracts/fixtures/errors/error_internal_error.json"
            caption="ErrorState in the body, header retained, Retry offered, request id copyable — support cannot work from “something went wrong”."
          >
            <DataTable
              caption="Restaurant order queue, failed"
              columns={columns.slice(0, 4)}
              rows={[]}
              getRowId={(row) => row.id}
              error={{
                code: 'INTERNAL_ERROR',
                requestId: '7V51J9JDKE98T8TMN21KKMPQ21',
                message: 'Something went wrong on our side.',
                onRetry: () => undefined,
              }}
            />
          </Specimen>

          <Specimen
            label="No reveal handler"
            forced
            caption="The same PII column with onRevealPii omitted. There is no eye, no dialog and no code path in the component that could produce an unmasked value — the unmasked value only ever comes back from the server."
          >
            <DataTable
              caption="Restaurant order queue, read-only role"
              columns={columns}
              rows={rows.slice(0, 2)}
              getRowId={(row) => row.id}
            />
          </Specimen>

          <Specimen
            label="Density"
            caption="The table sets --hg-density-* on its own subtree, so a comfortable admin page can hold a compact table without either of them hard-coding a row height."
          >
            <Stack>
              <DataTable
                caption="Compact"
                captionVisible
                columns={columns.slice(0, 3)}
                rows={rows.slice(0, 2)}
                getRowId={(row) => row.id}
                density="compact"
              />
              <DataTable
                caption="Comfortable"
                captionVisible
                columns={columns.slice(0, 3)}
                rows={rows.slice(0, 2)}
                getRowId={(row) => row.id}
                density="comfortable"
              />
            </Stack>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="PiiCell"
        purpose="The masking primitive DataTable uses. Usable on its own for a detail pane, with exactly the same guarantees."
        declaredStates={['masked', 'confirming', 'revealed', 're-masked after the TTL', 'no handler → no control']}
      >
        <SpecimenGrid min="20rem">
          <Specimen label="Masked, with a handler">
            <PiiCell
              rowId={restaurantQueue[0]!.id}
              rowLabel={`order ${restaurantQueue[0]!.code}`}
              columnHeader="Phone"
              spec={{ field: 'customer_phone', noun: 'the customer’s phone number' }}
              render={(context) =>
                context.revealedValue ?? restaurantQueue[0]!.customer?.phone_masked ?? '—'
              }
              handler={galleryReveal}
              ttlMs={20_000}
            />
          </Specimen>
          <Specimen label="No handler → no reveal control" forced>
            <PiiCell
              rowId={restaurantQueue[0]!.id}
              rowLabel={`order ${restaurantQueue[0]!.code}`}
              columnHeader="Phone"
              spec={{ field: 'customer_phone' }}
              render={() => restaurantQueue[0]!.customer?.phone_masked ?? '—'}
            />
          </Specimen>
          <Specimen
            label="Case not required"
            forced
            caption="requiresCase={false} narrows the dialog to a justification only. The default is true, because asking up front is better than teaching agents that the server refuses at random."
          >
            <PiiCell
              rowId={restaurantQueue[1]!.id}
              rowLabel={`order ${restaurantQueue[1]!.code}`}
              columnHeader="Phone"
              spec={{
                field: 'customer_phone',
                requiresCase: false,
                justificationCodes: ['CONTACTING_CUSTOMER', 'DELIVERY_ISSUE'],
              }}
              render={(context) =>
                context.revealedValue ?? restaurantQueue[1]!.customer?.phone_masked ?? '—'
              }
              handler={galleryReveal}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Pagination"
        purpose="Keyset only. No page numbers, no jump-to-last, and no “of N” unless the server sent a total — a count the server declined to compute is not one the client may invent."
        declaredStates={['load-more', 'pages', 'first page', 'last page', 'loading', 'with a total', 'without a total']}
      >
        <SpecimenGrid min="24rem">
          <Specimen label="load-more — the admin default">
            <Pagination
              meta={{ has_more: true, next_cursor: 'opaque', total: 6 }}
              loadedCount={4}
              onNext={() => undefined}
              unit="orders"
            />
          </Specimen>
          <Specimen label="pages — with a cursor stack">
            <Pagination
              meta={{ has_more: true, next_cursor: 'opaque' }}
              loadedCount={4}
              mode="pages"
              canGoPrevious
              onPrevious={() => undefined}
              onNext={() => undefined}
              onLimitChange={() => undefined}
              limit={20}
              unit="orders"
            />
          </Specimen>
          <Specimen label="End of the collection" forced>
            <Pagination meta={EMPTY_META} loadedCount={6} onNext={() => undefined} unit="orders" />
          </Specimen>
          <Specimen label="Loading the next page" forced>
            <Pagination
              meta={{ has_more: true, next_cursor: 'opaque' }}
              loadedCount={4}
              loading
              onNext={() => undefined}
              unit="orders"
            />
          </Specimen>
          <Specimen label="First page still loading (meta null)" forced>
            <Pagination meta={null} loadedCount={0} onNext={() => undefined} unit="orders" />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="FilterBar"
        purpose="Server-side filtering with saved views. Fully controlled, so the filter set survives a retry."
        declaredStates={['no filters applied', 'filters applied', 'saved view active', 'busy', 'result count announced']}
      >
        <SpecimenGrid min="26rem">
          <Specimen label="Applied filters" caption="Applied filters are named individually so each can be removed on its own; the result count is announced politely after a change.">
            <FilterBar
              filters={[
                {
                  key: 'state',
                  label: 'State',
                  kind: 'select',
                  options: [
                    { value: 'PENDING', label: 'Pending' },
                    { value: 'APPROVED', label: 'Approved' },
                  ],
                },
                { key: 'body', label: 'Issuing body', kind: 'text', placeholder: 'HMA, ISNA…' },
              ]}
              value={{ state: 'PENDING', body: 'HMA' }}
              onChange={() => undefined}
              onClear={() => undefined}
              resultCount={7}
              resultUnit="certificates"
            />
          </Specimen>
          <Specimen label="Busy" forced caption="Loading is not disabled: the controls stay usable while the query is in flight.">
            <FilterBar
              filters={[{ key: 'state', label: 'State', kind: 'select', options: [{ value: 'PENDING', label: 'Pending' }] }]}
              value={{ state: 'PENDING' }}
              onChange={() => undefined}
              onClear={() => undefined}
              busy
              resultCount={null}
            />
          </Specimen>
          <Specimen label="Nothing applied">
            <FilterBar
              filters={[{ key: 'state', label: 'State', kind: 'select', options: [{ value: 'PENDING', label: 'Pending' }] }]}
              value={{}}
              onChange={() => undefined}
              onClear={() => undefined}
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="DocumentViewer"
        purpose="A KYC document behind a short-lived presigned URL. It fetches with cache: 'no-store' into a blob, revokes the object URL on expiry, and says out loud that the view is recorded."
        declaredStates={['idle', 'loading', 'loaded', 'expired', 'error', 'unsupported']}
        notes={
          <>
            <strong>403 after the TTL is the expected path</strong>, not an error, and gets the
            expired treatment: blanked, with a re-request button. Re-requesting mints a new
            presign and writes a <em>new</em> audit row, which is why it is a deliberate user
            action rather than a silent refresh. The image below is generated in this browser (
            <code>src/lib/placeholderDocument.ts</code>) because no object storage is running.
          </>
        }
      >
        <Specimen label="Pick a state" wide>
          <Row>
            {(['loaded', 'expired', 'error', 'unsupported', 'pdf', 'idle'] as const).map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={docState === state}
                onClick={() => setDocState(state)}
                className={[
                  'hg-focus min-h-11 rounded-sm border px-3 text-label-md',
                  docState === state
                    ? 'border-line-brand bg-control-selected-bg text-control-selected-fg'
                    : 'border-control-border bg-control-bg text-fg-primary',
                ].join(' ')}
              >
                {state}
              </button>
            ))}
          </Row>
        </Specimen>

        <Specimen
          label={`state = ${docState}`}
          wide
          fixture={cite(documentFixtures.presigned)}
          caption={DOC_CAPTIONS[docState]}
        >
          {docState === 'loaded' ? (
            <DocumentViewer
              {...documentProps}
              url={PLACEHOLDER_PNG}
              contentType="image/png"
              expiresAt={new Date(Date.now() + 300_000).toISOString()}
            />
          ) : null}
          {docState === 'expired' ? (
            <DocumentViewer
              {...documentProps}
              url={PLACEHOLDER_PNG}
              contentType="image/png"
              expiresAt={new Date(Date.now() - 60_000).toISOString()}
            />
          ) : null}
          {docState === 'error' ? (
            <DocumentViewer
              {...documentProps}
              url="https://cdn.halalgoes.ca/img/asset/fe601348.webp"
              contentType="image/webp"
              expiresAt={new Date(Date.now() + 300_000).toISOString()}
            />
          ) : null}
          {docState === 'unsupported' ? (
            <DocumentViewer
              {...documentProps}
              url="https://cdn.halalgoes.ca/archive/certificate-pack.zip"
              contentType="application/zip"
              allowDownload
              onDownload={() => undefined}
            />
          ) : null}
          {docState === 'pdf' ? (
            <DocumentViewer
              {...documentProps}
              url="https://cdn.halalgoes.ca/doc/hma-on-40182.pdf"
              contentType="application/pdf"
              expiresAt={new Date(Date.now() + 300_000).toISOString()}
            />
          ) : null}
          {docState === 'idle' ? (
            <DocumentViewer {...documentProps} url={null} contentType="image/png" requesting />
          ) : null}
        </Specimen>
      </ComponentBlock>
    </Section>
  );
}

const DOC_CAPTIONS: Record<string, string> = {
  loaded:
    'A live presign with five minutes left. The TTL indicator counts down, and the audit notice is not dismissible.',
  expired:
    'expiresAt is in the past. The bytes are dropped and the object URL revoked; a re-request is offered, which mints a new presign and a new audit row.',
  error:
    'A real fetch against the CDN, which is unreachable with no backend. That is a genuine error path, not a simulated one — note that it is presented as an error rather than as an expiry, because a network failure is not a TTL expiry.',
  unsupported:
    'A content type the viewer will not render in-page. It falls back to download-only rather than showing a broken frame.',
  pdf: 'PDFs are handed off rather than loaded into this page. The frame is real; the file behind it is not fetchable here.',
  idle: 'url is null while a presign is being minted, with requesting=true.',
};
