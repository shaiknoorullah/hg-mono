/**
 * The Availability cell of one menu row (MH `MenuAvailability`, `MenuAvailabilitySwitch`,
 * spec §2). The switch moves only when HalalGoes confirms: no optimistic flip.
 *
 * Next closing time is a Needs API, so "Until closing" is offered but off, and turning an
 * item off marks it out of stock for 1 hour (the spec's recommended fallback, §2).
 */
import { Badge, Button, Menu, Switch } from '../ds';
import { formatTime } from '../format/time';
import { type LengthChoice, type MenuItem, ONE_HOUR_MS, itemName, untilText } from './model';

export type RowStatus =
  | { kind: 'saving' }
  | { kind: 'just-off' }
  | { kind: 'failed'; intent: 'off' | 'on' | 'length'; retry: () => void }
  | { kind: 'blocked-refused' }
  | { kind: 'locked-refused' };

/** Copy for "Until closing" while the server cannot say when closing is (Needs API: next closing). */
export const UNTIL_CLOSING_OFF_REASON = 'Your closing time isn’t available on this screen yet';

export interface AvailabilityCellProps {
  item: MenuItem;
  categoryName: string;
  categoryActive: boolean;
  access: 'edit' | 'locked' | 'view-only';
  /** The id of the lock note the disabled switch points at. */
  lockId: string;
  status: RowStatus | undefined;
  choice: LengthChoice | undefined;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSwitch: (on: boolean) => void;
  onLength: (choice: 'hour' | 'indefinite') => void;
  restockedAt: string | undefined;
  now: number;
  timeZone: string;
  supportHref: string;
}

export function AvailabilityCell({
  item,
  categoryName,
  categoryActive,
  access,
  status,
  choice,
  menuOpen,
  onMenuOpenChange,
  onSwitch,
  onLength,
  restockedAt,
  now,
  timeZone,
  supportHref,
}: AvailabilityCellProps) {
  const name = itemName(item);
  const state = item.availability_state;

  if (state === 'BLOCKED') {
    return (
      <div className="flex flex-col items-start gap-1 py-1">
        <Badge label="Blocked by HalalGoes" variant="neutral" size="sm" />
        <p className="text-[13px] text-fg-secondary">
          Ask support why.{' '}
          <a href={supportHref} aria-label={`Contact support about ${name}`} className="hg-focus text-fg-link underline">
            Contact support
          </a>
        </p>
        {status?.kind === 'blocked-refused' ? (
          <p role="alert" className="text-[13px] font-semibold text-feedback-danger-text">
            Your change wasn’t saved. HalalGoes had blocked it.
          </p>
        ) : null}
      </div>
    );
  }

  if (state === 'HIDDEN') {
    return (
      <div className="flex flex-col items-start gap-1 py-1">
        <Badge label="Hidden" variant="neutral" size="sm" />
        <p className="text-[13px] text-fg-secondary">
          {categoryActive ? 'Customers can’t see this item.' : `Its category, ${categoryName}, is inactive.`}
        </p>
      </div>
    );
  }

  const off = state === 'OUT_OF_STOCK';
  const until = item.out_of_stock_until ?? null;

  if (access === 'view-only') {
    return off ? (
      <div className="flex flex-col items-start gap-1 py-1">
        <Badge label="Out of stock" variant="neutral" size="sm" icon="clock" />
        <p className="text-[13px] text-fg-secondary">
          {until ? `Until ${untilText(item, choice, now, timeZone).replace(/^until /, '')}` : 'Until it’s marked available'}
        </p>
      </div>
    ) : (
      <Badge label="Available" appearance="outline" size="sm" icon="check" />
    );
  }

  const locked = access === 'locked';
  const saving = status?.kind === 'saving';
  const hourEnd = now + ONE_HOUR_MS;
  const hourLabel = `For 1 hour (until ${formatTime(hourEnd, timeZone)})`;
  const current = until ? untilText(item, choice, now, timeZone) : 'until you turn it back on';
  const tickedHour = Boolean(until) && choice?.kind === 'hour' && choice.until === until;

  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <div className="flex flex-wrap items-center gap-x-2">
        <Switch
          checked={!off}
          onChange={(on) => onSwitch(on)}
          label={<span className="sr-only">{name} available</span>}
          stateLabel={{ on: 'Available', off: 'Out of stock' }}
          loading={saving}
          disabled={locked}
          className="shrink-0"
        />
        {off ? <span className="whitespace-nowrap text-[13px] text-fg-secondary">{current}</span> : null}
        {off && !locked && !saving ? (
          <Menu
            label={`Change how long ${name} is out of stock`}
            variant="plain"
            align="end"
            open={menuOpen}
            onOpenChange={onMenuOpenChange}
            trigger={
              <span className="text-[14px] underline">
                Change<span className="sr-only"> how long {name} is out of stock</span>
              </span>
            }
            items={[
              ...(until ? [{ key: 'now', label: `Now: out of stock ${current}`, disabled: true }] : []),
              {
                key: 'closing',
                label: 'Until closing',
                disabled: true,
                disabledReason: UNTIL_CLOSING_OFF_REASON,
                separatorBefore: Boolean(until),
              },
              { key: 'hour', label: hourLabel, checked: tickedHour, onSelect: () => onLength('hour') },
              {
                key: 'indefinite',
                label: 'Until you turn it back on',
                description: 'If it’s still off after 14 days, it goes in your weekly reminder.',
                checked: !until,
                onSelect: () => onLength('indefinite'),
              },
            ]}
          />
        ) : null}
      </div>
      <p aria-live="polite" className="text-[13px] text-fg-secondary empty:hidden">
        {saving ? 'Saving. The switch moves when HalalGoes confirms.' : ''}
      </p>
      {status?.kind === 'just-off' && off ? (
        <p role="status" className="text-[13px] text-fg-primary">
          Out of stock now. Choose another length, or press Escape to keep this one.
        </p>
      ) : null}
      {status?.kind === 'failed' ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-feedback-danger-text">
          <span>
            {status.intent === 'on'
              ? 'Couldn’t mark it available. It’s still out of stock for customers.'
              : status.intent === 'off'
                ? 'Couldn’t mark it out of stock. It’s still available to customers.'
                : 'Couldn’t change how long it’s out of stock. Nothing changed.'}
          </span>
          <Button
            variant="tertiary"
            size="sm"
            accessibilityLabel={`Try again: ${name}`}
            onPress={status.retry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {status?.kind === 'locked-refused' ? (
        <p role="alert" className="text-[13px] font-semibold text-feedback-danger-text">
          Not saved: your account is suspended. {name} is still {off ? 'out of stock' : 'available'} to customers.
        </p>
      ) : null}
      {restockedAt && !off ? (
        <p className="text-[13px] text-fg-secondary">Back in stock at {formatTime(restockedAt, timeZone)} by itself</p>
      ) : null}
    </div>
  );
}
