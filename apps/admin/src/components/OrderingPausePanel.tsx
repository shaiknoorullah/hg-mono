/**
 * The platform-wide pause on new orders (#244, admin console #389), on the System page.
 *
 * Reads `getOrderingPause` and changes it with `setOrderingPause`. Both directions need a
 * reason (10–500 characters, `OrderingPauseInput`) and a confirmation that says what
 * changes, because a pause refuses every customer's new order at once. `ADMIN` and
 * `SUPER_ADMIN` may change it; `SUPPORT_AGENT` may only read it. The console does not know
 * the signed-in role up front, so the API is the judge: a `403` from `setOrderingPause`
 * turns the panel read-only, and the control stays hidden from then on.
 *
 * Never red: a pause is an operational state, not a failure, so it is the `warning` tint
 * and open is `neutral` — solid green is halal-only (AGENTS.md "Non-negotiable invariants").
 */
import { useCallback, useState } from 'react';
import type { Schema } from '@hg/api-client';
import { isApiError } from '@hg/api-client';
import { Banner, Button, Card, ConfirmDialog, EmptyState, ErrorState, Skeleton, useToast } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import { toAsyncError, unwrap, useLoad } from '../lib/load.js';
import { formatTimestamp } from '../lib/format.js';

type OrderingPause = Schema['OrderingPause'];

const REASON_MIN = 10;
const REASON_MAX = 500;

export function OrderingPausePanel() {
  const toast = useToast();
  const fetcher = useCallback(
    async (): Promise<OrderingPause> => (await unwrap(api.GET('/v1/admin/ordering-pause', {}))).data,
    [],
  );
  const { status, data, error, reload } = useLoad<OrderingPause>(fetcher);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [current, setCurrent] = useState<OrderingPause | null>(null);

  // The answer to the last change is the switch as it now stands, so it replaces the load.
  const pause = current ?? data;
  const nextPaused = !pause?.paused;

  const change = async ({ note }: { note?: string }) => {
    const reason = (note ?? '').trim();
    if (reason.length > REASON_MAX) {
      throw new Error(`The reason can be at most ${REASON_MAX} characters. It is ${reason.length}.`);
    }
    try {
      const updated = await unwrap(
        api.PUT('/v1/admin/ordering-pause', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { paused: nextPaused, reason },
        }),
      );
      setCurrent(updated.data);
      toast.show({
        variant: nextPaused ? 'warning' : 'info',
        title: nextPaused ? 'New orders are paused' : 'New orders are open again',
      });
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setReadOnly(true);
        setConfirmOpen(false);
        toast.show({ variant: 'warning', title: 'Your role can read this but not change it' });
        return;
      }
      throw new Error(toAsyncError(err).message);
    }
  };

  return (
    <section aria-labelledby="ordering-pause-heading" className="adm-stack" data-testid="ordering-pause">
      <h2 id="ordering-pause-heading" className="text-title-sm text-fg-primary">
        New orders
      </h2>
      <p className="text-body-sm text-fg-secondary">
        Pausing stops every customer from placing a new order. Orders already placed carry on.
        Admins and super admins can change this; support agents can only read it.
      </p>

      {status === 'loading' && !pause ? (
        <div aria-busy="true" aria-label="Loading the ordering pause">
          <Skeleton height={96} />
        </div>
      ) : null}

      {status === 'error' && !pause ? (
        <ErrorState
          variant="inline"
          errorCode={error.code}
          description="Could not load whether new orders are paused. Nothing has changed; try again."
          onRetry={reload}
        />
      ) : null}

      {pause ? (
        <Card>
          <div className="adm-stack">
            {pause.paused ? (
              <Banner
                variant="warning"
                title="New orders are paused"
                description={`Since ${formatTimestamp(pause.paused_since)}. Customers cannot check out until ordering resumes.`}
                testId="ordering-pause-state"
              />
            ) : (
              <Banner
                variant="neutral"
                title="New orders are open"
                description="Customers can check out as normal."
                testId="ordering-pause-state"
              />
            )}

            {pause.changed_at ? (
              <dl className="adm-kv-grid">
                <div className="adm-kv">
                  <dt className="text-label-sm text-fg-secondary">Latest reason</dt>
                  <dd className="text-body-md text-fg-primary">{pause.reason ?? '—'}</dd>
                </div>
                <div className="adm-kv">
                  <dt className="text-label-sm text-fg-secondary">Changed</dt>
                  <dd className="text-body-md text-fg-primary">{formatTimestamp(pause.changed_at)}</dd>
                </div>
                <div className="adm-kv">
                  <dt className="text-label-sm text-fg-secondary">Changed by (staff ID)</dt>
                  <dd className="text-body-sm text-fg-secondary">{pause.changed_by ?? '—'}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState
                variant="inline"
                title="No changes yet"
                description="Nobody has paused or resumed new orders on this platform. Each change is recorded here and in the audit log."
                testId="ordering-pause-never-changed"
              />
            )}

            {readOnly ? (
              <p className="text-body-sm text-fg-secondary" data-testid="ordering-pause-read-only">
                Read-only: your role can see this but not change it. Ask an admin to pause or resume.
              </p>
            ) : (
              <div className="adm-form-actions">
                <Button
                  variant={pause.paused ? 'primary' : 'secondary'}
                  onPress={() => setConfirmOpen(true)}
                >
                  {pause.paused ? 'Resume new orders' : 'Pause new orders'}
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={nextPaused ? 'Pause new orders for everyone?' : 'Resume new orders?'}
        description={
          nextPaused
            ? 'Every customer will be refused at checkout until someone resumes ordering. Orders already placed carry on. The reason is recorded in the audit log.'
            : 'Customers will be able to place new orders again straight away. The reason is recorded in the audit log.'
        }
        confirmLabel={nextPaused ? 'Pause new orders' : 'Resume new orders'}
        destructive={nextPaused}
        noteLabel="Reason"
        noteMinLength={REASON_MIN}
        noteRequired
        onConfirm={change}
        testId="ordering-pause-confirm"
      />
    </section>
  );
}
