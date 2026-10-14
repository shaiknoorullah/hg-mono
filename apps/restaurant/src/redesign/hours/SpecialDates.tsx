/**
 * Special dates (spec wp9-hours §5): the list pane and the task panel that replaces it
 * (`?date=YYYY-MM-DD` to edit, `?date=new` to add). A special date saves straight away, on its
 * own, and never waits for "Save hours": its PUT carries the weekly hours **as last loaded
 * from the server** (not the unsaved edits) plus the whole special-date list with this one
 * change, because `setRestaurantHours` replaces both. "Last loaded" means read again just
 * before the PUT: another device may have changed the weekly hours or the special dates
 * since this page loaded, and sending the page's own copy would silently undo that.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { HgApiError, isApiError } from '@hg/api-client';
import { Badge, Button, DateField, DetailPanel, IconButton, Icon, Input, RadioGroup, TimeField, useToast } from '../ds';
import { client } from '../data/client';
import { call } from '../data/call';
import { addDays, formatCalendarDate, formatClock, formatDayDate, isClock, weekdayOf } from '../format/time';
import {
  MAX_SPECIAL_DATES,
  closedAfterLateNote,
  crossesMidnight,
  describeDay,
  describeOverride,
  fixTitle,
  isTwentyFour,
  lastAllowedDate,
  overrideNightNote,
  sortOverrides,
  weekFromIntervals,
  type HoursOverride,
  type RestaurantHours,
} from './model';

const VIEW_NOTE = 'Holidays and one-off hours replace your weekly hours on that date.';
const EDIT_NOTE = 'Special dates save straight away, separately from your weekly hours.';
const LIMIT_NOTE = 'You have 90 special dates, the most allowed. Remove one to add another.';

function loadHours(): Promise<RestaurantHours> {
  return call(client.GET('/v1/restaurant/hours', {})) as Promise<RestaurantHours>;
}

// ── List pane ────────────────────────────────────────────────────────────────────────────

export interface SpecialDatesListProps {
  hours: RestaurantHours;
  today: string;
  editing: boolean;
  canEdit: boolean;
  /** Open the panel: 'new' or a date; `remove` opens it straight on the remove question. */
  onOpen: (date: string, opener: string, remove?: boolean) => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export function SpecialDatesList({ hours, today, editing, canEdit, onOpen, headingRef }: SpecialDatesListProps) {
  const headingId = useId();
  const [showPast, setShowPast] = useState(false);
  const week = useMemo(() => weekFromIntervals(hours.intervals), [hours.intervals]);
  const all = sortOverrides(hours.overrides);
  const upcoming = all.filter((o) => o.date >= today);
  const past = all.filter((o) => o.date < today).reverse();
  const atLimit = all.length >= MAX_SPECIAL_DATES;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="special-dates"
      className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised lg:w-[420px]"
    >
      <div className="flex items-center gap-2 border-b border-line-decorative px-4 py-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="hg-focus flex-1 text-[20px] font-semibold outline-none">
          Special dates
        </h2>
        {canEdit ? (
          <Button
            id="add-special-date"
            variant="tertiary"
            size="md"
            iconStart={<Icon name="plus" size={18} />}
            disabled={atLimit}
            accessibilityLabel={atLimit ? 'Add date. Not available: you have 90 special dates, the most allowed.' : 'Add a special date'}
            onPress={() => onOpen('new', 'add-special-date')}
          >
            Add date
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[14px] text-fg-secondary">{editing ? EDIT_NOTE : VIEW_NOTE}</p>
        {atLimit && canEdit ? (
          <p className="mt-2 text-[14px] text-fg-primary">{LIMIT_NOTE}</p>
        ) : null}
        {upcoming.length === 0 ? (
          <div className="mt-4" data-testid="special-dates-empty">
            <h3 className="text-[16px] font-semibold">No special dates</h3>
            <p className="text-[15px] text-fg-secondary">
              Your weekly hours apply every day. Use Add date for a holiday, a closure or a day with different hours.
            </p>
          </div>
        ) : (
          <ul className="mt-2 flex flex-col">
            {upcoming.map((o, i) => {
              const isToday = o.date === today;
              const night = overrideNightNote(o);
              const late = closedAfterLateNote(o, week);
              const editId = `edit-ov-${o.date}`;
              return (
                <li key={o.date} id={`ov-${i}`} data-date={o.date} tabIndex={-1} className="hg-focus flex min-h-11 items-start gap-2 border-t border-line-decorative py-2 outline-none first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
                      {formatDayDate(o.date)}
                      {isToday ? ' (today)' : ''}
                      {isToday ? <Badge label="In effect now" size="sm" variant="neutral" /> : null}
                    </p>
                    <p className="text-[15px] tabular-nums">{describeOverride(o)}</p>
                    {o.reason ? <p className="text-[15px] text-fg-secondary">{o.reason}</p> : null}
                    {night ? <p className="text-[14px] text-fg-secondary">{night}</p> : null}
                    {late ? <p className="text-[14px] text-fg-secondary">{late}</p> : null}
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        id={editId}
                        variant="ghost"
                        size="md"
                        accessibilityLabel={`Edit special date ${formatDayDate(o.date)}`}
                        onPress={() => onOpen(o.date, editId)}
                      >
                        Edit
                      </Button>
                      {editing ? (
                        <IconButton
                          icon={<Icon name="close" size={18} />}
                          accessibilityLabel={`Remove special date ${formatDayDate(o.date)}`}
                          variant="plain"
                          onPress={() => onOpen(o.date, editId, true)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {past.length > 0 ? (
          <div className="mt-3">
            <Button
              variant="ghost"
              size="md"
              aria-expanded={showPast}
              aria-controls="past-dates"
              iconStart={<span aria-hidden="true">{showPast ? '▾' : '▸'}</span>}
              onPress={() => setShowPast((s) => !s)}
            >
              {showPast ? `Hide past dates (${past.length})` : `Show past dates (${past.length})`}
            </Button>
            {showPast ? (
              <ul id="past-dates" className="mt-1 flex flex-col">
                {past.map((o) => (
                  <li key={o.date} className="border-t border-line-decorative py-2 first:border-t-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {formatDayDate(o.date)} <Badge label="Past" size="sm" variant="neutral" />
                    </p>
                    <p className="text-[14px] text-fg-secondary">{[describeOverride(o), o.reason].filter(Boolean).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {editing ? (
        <p className="border-t border-line-decorative px-4 py-2 text-[14px] tabular-nums text-fg-secondary">
          {all.length} of {MAX_SPECIAL_DATES} special dates
        </p>
      ) : null}
    </section>
  );
}

// ── Task panel ───────────────────────────────────────────────────────────────────────────

export interface SpecialDatePanelProps {
  /** 'new' or the date being edited (a date not on the list opens Add with it filled in). */
  target: string;
  hours: RestaurantHours;
  today: string;
  /** The weekly editor is open (Add says so; it changes the button and description). */
  editingWeek: boolean;
  /** Open straight on the remove question. */
  startRemoving?: boolean;
  onClose: () => void;
  /** The server's hours after a save or a remove. */
  onSaved: (next: RestaurantHours, info: { date: string; removed: boolean }) => void;
}

type Errors = Partial<Record<'date' | 'opens' | 'closes', string>>;

export function SpecialDatePanel({ target, hours, today, editingWeek, startRemoving, onClose, onSaved }: SpecialDatePanelProps) {
  const toast = useToast();
  const existing = target === 'new' ? undefined : hours.overrides.find((o) => o.date === target);
  const isEdit = Boolean(existing);
  const max = lastAllowedDate(today);
  const [date, setDate] = useState(existing?.date ?? (target === 'new' ? '' : target));
  const [kind, setKind] = useState<'closed' | 'special'>(existing && !existing.is_closed ? 'special' : 'closed');
  const [opens, setOpens] = useState(existing?.opens_at ?? '');
  const [closes, setCloses] = useState(existing?.closes_at ?? '');
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [serverRefused, setServerRefused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(Boolean(startRemoving && existing));
  const errorRef = useRef<HTMLParagraphElement>(null);
  const keepRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const confirmId = useId();
  const week = useMemo(() => weekFromIntervals(hours.intervals), [hours.intervals]);
  const errorCount = Object.values(errors).filter(Boolean).length;

  // The error title takes focus after a save that found something (not while typing).
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries > 0) errorRef.current?.focus();
  }, [tries]);
  useEffect(() => {
    if (removing) keepRef.current?.focus();
  }, [removing]);

  const inEffect = existing?.date === today;
  const weeklyOn = (iso: string) => describeDay(week[weekdayOf(iso)]!);

  /** Checks against a special-date list: the one loaded, then the one read just before the PUT. */
  const validate = (list: readonly HoursOverride[]): Errors => {
    const e: Errors = {};
    // The contract allows 90 (RestaurantHoursInput maxItems) and the server does not check:
    // the disabled Add date is not enough, since `?date=new` or `?date=<a new date>` opens Add.
    const others = list.filter((o) => o.date !== existing?.date);
    if (others.length >= MAX_SPECIAL_DATES) e.date = LIMIT_NOTE;
    else if (!date) e.date = 'Choose a date.';
    else if (date > max) e.date = `This date is more than a year ahead. Choose a date up to ${formatCalendarDate(max)}.`;
    else if (date < today && date !== existing?.date) e.date = 'Choose today or a later date.';
    else if (date !== existing?.date && list.some((o) => o.date === date)) {
      e.date = `You already have a special date on ${formatDayDate(date)}. Edit that one instead.`;
    }
    if (kind === 'special') {
      if (opens === '') e.opens = 'Enter an opening time.';
      else if (!isClock(opens)) e.opens = 'Enter a time like 11:00 am.';
      if (closes === '') e.closes = 'Enter a closing time.';
      else if (!isClock(closes)) e.closes = 'Enter a time like 11:00 am.';
    }
    return e;
  };

  const put = (intervals: RestaurantHours['intervals'], overrides: HoursOverride[]) =>
    call(
      client.PUT('/v1/restaurant/hours', {
        body: {
          intervals: intervals.map((iv) => ({
            day_of_week: iv.day_of_week,
            opens_at: iv.opens_at,
            closes_at: iv.closes_at,
            crosses_midnight: iv.crosses_midnight ?? crossesMidnight(iv.opens_at, iv.closes_at),
          })),
          overrides,
        },
      }),
    ) as Promise<RestaurantHours>;

  const save = async () => {
    const e = validate(hours.overrides);
    setServerRefused(false);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setTries((t) => t + 1);
      return;
    }
    const entry: HoursOverride = {
      date,
      is_closed: kind === 'closed',
      opens_at: kind === 'closed' ? null : opens,
      closes_at: kind === 'closed' ? null : closes,
      reason: reason.trim() ? reason.trim() : null,
    };
    let at = -1;
    setSaving(true);
    setFailed(false);
    try {
      // Merge this one change into the special dates as they are now, and send the weekly
      // hours the server has now.
      const current = await loadHours();
      const fresh = validate(current.overrides);
      if (Object.keys(fresh).length > 0) {
        setErrors(fresh);
        setTries((t) => t + 1);
        return;
      }
      const others = current.overrides.filter((o) => o.date !== existing?.date);
      const overrides = sortOverrides([...others, entry]);
      at = overrides.indexOf(entry);
      const next = await put(current.intervals, overrides);
      onSaved(next, { date, removed: false });
    } catch (err) {
      if (isApiError(err) && (err as HgApiError).code === 'VALIDATION_FAILED') {
        const mapped: Errors = {};
        for (const d of (err as HgApiError).details ?? []) {
          const m = /^overrides\[(\d+)\]\.?(\w+)?/.exec(d.field);
          if (!m || Number(m[1]) !== at) continue;
          if (m[2] === 'date') mapped.date = `This date is more than a year ahead. Choose a date up to ${formatCalendarDate(max)}.`;
          else if (m[2] === 'opens_at') mapped.opens = 'Enter a time like 11:00 am.';
          else mapped.closes = 'Enter a time like 11:00 am.';
        }
        if (Object.keys(mapped).length === 0) mapped.date = 'HalalGoes couldn’t accept this date. Check it and save again.';
        setServerRefused(true);
        setErrors(mapped);
        setTries((t) => t + 1);
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setSaving(true);
    setFailed(false);
    try {
      const current = await loadHours();
      const next = await put(
        current.intervals,
        current.overrides.filter((o) => o.date !== existing.date),
      );
      toast.show({
        variant: 'success',
        title: 'Special date removed',
        description: existing.date === today ? `Your weekly hours apply today: ${weeklyOn(today)}.` : undefined,
      });
      onSaved(next, { date: existing.date, removed: true });
    } catch {
      setFailed(true);
      setRemoving(false);
    } finally {
      setSaving(false);
    }
  };

  const description = isEdit
    ? inEffect
      ? 'This replaces your weekly hours on that date only. It saves straight away.'
      : 'This replaces your weekly hours on that date only. Changes save straight away, separately from your weekly hours.'
    : editingWeek
      ? 'This replaces your weekly hours on that date only. It saves straight away, separately from your weekly hours.'
      : 'This replaces your weekly hours on that date only. It saves straight away; you don’t need to edit your weekly hours.';

  const primaryLabel = failed || serverRefused ? 'Save date' : isEdit ? 'Save changes' : editingWeek ? 'Add date' : 'Save date';
  const timeNote =
    kind === 'special' && isClock(opens) && isClock(closes)
      ? isTwentyFour(opens, closes)
        ? 'Open 24 hours on this date. The same opening and closing time means a full day, as in your weekly hours.'
        : crossesMidnight(opens, closes) && date
          ? `Past midnight: closes at ${formatClock(closes)} on ${formatDayDate(addDays(date, 1))}.`
          : null
      : null;

  const footer = removing && existing ? (
    <div role="alertdialog" aria-labelledby={`${confirmId}-t`} aria-describedby={`${confirmId}-b`} onKeyDown={(e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setRemoving(false);
      }
    }}>
      <h3 id={`${confirmId}-t`} className="text-[17px] font-bold">
        {existing.reason ? `Remove ${existing.reason}, ${formatDayDate(existing.date)}?` : `Remove ${formatDayDate(existing.date)}?`}
      </h3>
      <p id={`${confirmId}-b`} className="text-[15px]">
        Your weekly hours apply on that date instead: {weeklyOn(existing.date)}. It’s removed as soon as you confirm, even if you don’t save your weekly hours.
      </p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button ref={keepRef} variant="tertiary" size="md" onPress={() => setRemoving(false)}>
          Keep it
        </Button>
        <Button variant="danger" size="md" loading={saving} onPress={() => void remove()}>
          Remove now
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {isEdit ? (
        <Button variant="ghost" size="md" destructive disabled={saving} onPress={() => setRemoving(true)}>
          Remove date
        </Button>
      ) : null}
      <span className="flex-1" />
      <Button variant="tertiary" size="md" disabled={saving} onPress={onClose}>
        Cancel
      </Button>
      <Button variant="primary" size="md" loading={saving} onPress={() => void save()}>
        {saving ? 'Saving…' : primaryLabel}
      </Button>
    </div>
  );

  return (
    <div id="special-date-panel" className="flex min-h-0 w-full shrink-0 lg:w-[440px] [&>aside]:w-full">
      <DetailPanel
        title={isEdit ? 'Edit special date' : 'Add a special date'}
        subtitle="Special dates"
        label="Special date"
        closeLabel="Close and go back to special dates"
        onClose={onClose}
        footer={footer}
        width="pane"
        testId="special-date-panel"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[15px]">{description}</p>
          {errorCount > 0 ? (
            <p ref={errorRef} role="alert" tabIndex={-1} className="hg-focus font-semibold text-feedback-danger-text outline-none">
              {serverRefused ? `HalalGoes couldn’t save this date. Fix ${errorCount} thing${errorCount === 1 ? '' : 's'}.` : fixTitle(errorCount, isEdit ? 'save this date' : 'add this date')}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="font-semibold text-feedback-danger-text">
              Couldn’t save this date. Check your connection and try again.
            </p>
          ) : null}
          <DateField
            id="sd-date"
            label="Date"
            value={date}
            min={existing && existing.date < today ? existing.date : today}
            max={max}
            required
            helperText="Today, or up to one year ahead."
            errorText={errors.date}
            readOnly={saving}
            onChange={(v) => {
              setDate(v);
              setErrors((e) => ({ ...e, date: undefined }));
            }}
          />
          <RadioGroup
            label="On this date"
            value={kind}
            onChange={(v: string) => setKind(v === 'special' ? 'special' : 'closed')}
            disabled={saving}
            options={[
              { value: 'closed', label: 'Closed all day' },
              { value: 'special', label: 'Special hours', description: 'Replaces your usual hours for this date' },
            ]}
          />
          {kind === 'special' ? (
            <fieldset className="flex flex-wrap items-start gap-3">
              <legend className="sr-only">Hours on this date</legend>
              <TimeField id="sd-opens" label="Opens" value={opens} onChange={(v) => {
                setOpens(v);
                setErrors((e) => ({ ...e, opens: undefined }));
              }} errorText={errors.opens} readOnly={saving} required className="w-[170px]" />
              <TimeField id="sd-closes" label="Closes" value={closes} onChange={(v) => {
                setCloses(v);
                setErrors((e) => ({ ...e, closes: undefined }));
              }} errorText={errors.closes} readOnly={saving} required className="w-[200px]" />
            </fieldset>
          ) : null}
          {timeNote ? (
            <p className="flex items-start gap-2 text-[14px] text-fg-secondary">
              <Icon name="clock" size={16} />
              {timeNote}
            </p>
          ) : null}
          {inEffect ? (
            <p className="text-[14px] text-fg-secondary">
              This date is in effect now. If you remove it, your weekly hours apply today ({weeklyOn(today)}), so you open straight away.
            </p>
          ) : null}
          <Input label="Reason (optional)" value={reason} onChange={(v: string) => setReason(v)} helperText="Shown on your Hours screen." readOnly={saving} maxLength={120} />
        </div>
      </DetailPanel>
    </div>
  );
}
