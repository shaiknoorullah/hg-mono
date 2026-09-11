import { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { isApiError, type Schema } from '@hg/api-client';
import { Button, Card, ErrorState, cx } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { PageLoading } from '../components/PageLoading';
import { StatusChip } from '../components/StatusChip';
import { IconPower, IconStore } from '../lib/icons';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const OPEN_STATE_LABEL: Record<Schema['RestaurantOpenState'], string> = {
  OPEN: 'Open',
  PAUSED: 'Paused',
  CLOSED_HOURS: 'Closed — outside trading hours',
  CLOSED_HOLIDAY: 'Closed — holiday override',
  CLOSED_TOGGLE: 'Closed — toggled off',
  CLOSED_OFFLINE: 'Offline — no recent heartbeat',
  CLOSED_SUSPENDED: 'Closed — account suspended',
};

/**
 * The accepting-orders toggle deliberately uses the brand accent (orange) motion, never the
 * halal seal's green (RULE H-1: solid green is reserved to `color.halal.*`) and never red
 * (RULE H-3: red reads as a religious ruling). "Live" pulses a soft glow; "paused" settles to
 * slate — an operational state, not a certification state.
 */
function AvailabilityCard() {
  const { status, data, error, reload } = useAsync(() => unwrapOrThrow(api.GET('/v1/restaurant/availability', {})), []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (status === 'loading') return <PageLoading label="Checking store status…" />;
  if (status === 'error' || !data) return <ErrorState description={error ?? undefined} onRetry={reload} />;

  const live = data.open_state === 'OPEN';

  async function toggle() {
    setBusy(true);
    setActionError(null);
    try {
      await unwrapOrThrow(
        api.PATCH('/v1/restaurant/availability', {
          body: { is_accepting_orders: !data!.is_accepting_orders },
        }),
      );
      reload();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : 'Could not change your store status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cx(
              'grid size-11 place-items-center rounded-full transition-colors',
              live ? 'bg-[var(--hg-state-selected-tint)] text-action-primary-bg hg-toggle-live' : 'bg-surface-subtle text-fg-tertiary',
            )}
          >
            <IconPower size={20} />
          </div>
          <div>
            <p className="text-label-lg font-extrabold text-fg-primary">{OPEN_STATE_LABEL[data.open_state]}</p>
            <p className="text-caption text-fg-secondary">{data.reason}</p>
          </div>
        </div>
        <Switch.Root
          checked={data.is_accepting_orders}
          disabled={busy}
          onCheckedChange={toggle}
          className={cx(
            'relative h-8 w-14 rounded-full transition-colors duration-300 ease-out outline-none disabled:opacity-50',
            data.is_accepting_orders ? 'bg-action-primary-bg' : 'bg-surface-subtle',
          )}
        >
          <Switch.Thumb className="block h-6 w-6 translate-x-1 rounded-full bg-white shadow-e2 transition-transform duration-300 ease-out data-[state=checked]:translate-x-[26px]" />
        </Switch.Root>
      </div>
      {(data.missed_order_count ?? 0) > 0 && (
        <div className="mt-4">
          <StatusChip tone="warning">{data.missed_order_count} missed offer(s) recently</StatusChip>
        </div>
      )}
      {actionError && (
        <p role="alert" className="mt-3 text-caption font-semibold text-feedback-danger-text">
          {actionError}
        </p>
      )}
    </Card>
  );
}

function WeeklyHours() {
  const { status, data, error, reload } = useAsync(() => unwrapOrThrow(api.GET('/v1/restaurant/hours', {})), []);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [local, setLocal] = useState<Schema['TradingInterval'][] | null>(null);

  if (status === 'loading') return <PageLoading label="Loading trading hours…" />;
  if (status === 'error' || !data) return <ErrorState description={error ?? undefined} onRetry={reload} />;

  // Captured into a fresh `const` so it stays narrowed to non-null inside the closures
  // below — TS's control-flow narrowing of `data` does not survive into nested functions.
  const hours = data;
  const intervals = local ?? hours.intervals;

  function updateDay(day: number, field: 'opens_at' | 'closes_at', value: string) {
    const next = [...intervals];
    const idx = next.findIndex((i) => i.day_of_week === day);
    if (idx >= 0) {
      next[idx] = { ...next[idx]!, [field]: value };
    } else {
      next.push({ day_of_week: day, opens_at: field === 'opens_at' ? value : '11:00', closes_at: field === 'closes_at' ? value : '21:00', crosses_midnight: false });
    }
    setLocal(next);
  }

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await unwrapOrThrow(api.PUT('/v1/restaurant/hours', { body: { intervals, overrides: hours.overrides } }));
      setLocal(null);
      reload();
    } catch (e) {
      setSaveError(isApiError(e) ? e.message : 'Could not save your hours.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-label-lg font-extrabold text-fg-primary">Weekly trading hours</h2>
          <p className="text-caption text-fg-secondary">Evaluated in {hours.timezone}. Orders outside these windows are refused automatically.</p>
        </div>
        {local && (
          <Button loading={busy} onPress={save}>
            Save hours
          </Button>
        )}
      </div>
      <div className="divide-y divide-line-decorative">
        {DAYS.map((label, day) => {
          const interval = intervals.find((i) => i.day_of_week === day);
          return (
            <div key={day} className="flex items-center justify-between gap-3 py-3">
              <span className="w-24 flex-none text-label-md font-bold text-fg-primary">{label}</span>
              {interval ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={interval.opens_at}
                    onChange={(e) => updateDay(day, 'opens_at', e.target.value)}
                    className="rounded-sm border border-line-interactive bg-control-bg px-2 py-1.5 text-body-sm text-fg-primary outline-none focus:border-line-brand"
                  />
                  <span className="text-fg-tertiary">–</span>
                  <input
                    type="time"
                    value={interval.closes_at}
                    onChange={(e) => updateDay(day, 'closes_at', e.target.value)}
                    className="rounded-sm border border-line-interactive bg-control-bg px-2 py-1.5 text-body-sm text-fg-primary outline-none focus:border-line-brand"
                  />
                  {interval.crosses_midnight && <StatusChip tone="accent">Overnight</StatusChip>}
                </div>
              ) : (
                <span className="text-caption text-fg-tertiary">Closed</span>
              )}
            </div>
          );
        })}
      </div>
      {hours.overrides.length > 0 && (
        <div className="mt-5 border-t border-line-decorative pt-4">
          <p className="mb-2 text-caption font-bold text-fg-secondary">Date overrides</p>
          <div className="space-y-2">
            {hours.overrides.map((o) => (
              <div key={o.date} className="flex items-center justify-between rounded-sm bg-feedback-warning-tint px-3 py-2 text-caption">
                <span className="font-bold text-feedback-warning-text">{o.date}</span>
                <span className="text-fg-secondary">{o.is_closed ? 'Closed' : `${o.opens_at}–${o.closes_at}`} {o.reason ? `· ${o.reason}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {saveError && (
        <p role="alert" className="mt-3 text-caption font-semibold text-feedback-danger-text">
          {saveError}
        </p>
      )}
    </Card>
  );
}

export function HoursPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-heading-md font-extrabold text-fg-primary">
          <IconStore size={20} /> Hours & availability
        </h1>
        <p className="text-body-sm text-fg-secondary">Toggle order acceptance instantly, or manage your standing weekly schedule.</p>
      </header>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        <AvailabilityCard />
        <WeeklyHours />
      </div>
    </div>
  );
}
