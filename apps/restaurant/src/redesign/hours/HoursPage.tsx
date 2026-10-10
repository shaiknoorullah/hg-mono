/**
 * Hours and pause, `/hours` (WP9; spec wp9-hours; canvas MH `HoursView`, manifest §2.5).
 *
 *   Right now card (open state, pause, New orders switch)
 *   Weekly hours (view | editor with save bar)  |  Special dates (list | task panel)
 *
 * The page never scrolls; the panes do. The weekly editor saves the whole week at once
 * (`setRestaurantHours` replaces intervals AND special dates, so a save re-reads the hours
 * just before it writes, keeps the special dates the server has, and stops if the weekly
 * hours changed meanwhile: there is no version check in the contract). Special dates save
 * straight away on their own. Every check the server does not make (overlap, including past
 * midnight into the next day and Sunday into Monday, 3 a day, 21 in all) is made here.
 *
 * Editable while SUSPENDED (owner decision); read-only when DEACTIVATED and for STAFF.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HgApiError, isApiError } from '@hg/api-client';
import { ActionBar, Badge, Banner, Button, EmptyState, Icon, IconButton, Skeleton, Switch, TimeField, useToast, type ActionBarConfirm } from '../ds';
import { client } from '../data/client';
import { call } from '../data/call';
import { useConsole } from '../data/console';
import { useAvailability } from '../data/availability';
import { useServerResource } from '../data/useServerResource';
import { serverNow } from '../data/serverClock';
import { usePagePanelOpen } from '../shell/layout';
import { NAV } from '../shell/nav';
import { formatClock, formatClockRange, formatTime, isoDateIn, minutesIn, timezoneName, weekdayOf, clockMinutes, isClock } from '../format/time';
import {
  DAY_IDS,
  MAX_RANGES,
  MAX_RANGES_PER_DAY,
  UI_DAYS,
  changedDays,
  crossesMidnight,
  dayName,
  describeDay,
  emptyWeek,
  fixTitle,
  intervalsFromWeek,
  isTwentyFour,
  issuesFromServer,
  newKey,
  rangeCount,
  sameIntervals,
  validateWeek,
  weekCovers,
  weekFromIntervals,
  type HoursIssue,
  type Range,
  type RestaurantHours,
  type Week,
} from './model';
import { RightNow } from './RightNow';
import { SpecialDatePanel, SpecialDatesList } from './SpecialDates';

function loadHours(): Promise<RestaurantHours> {
  return call(client.GET('/v1/restaurant/hours', {})) as Promise<RestaurantHours>;
}

const EDIT_ROLES = new Set(['RESTAURANT_OWNER', 'RESTAURANT_MANAGER']);

type BarAsk = { kind: 'closes-now'; body: string } | { kind: 'leave'; to: string; label: string } | null;

export function HoursPage() {
  const { core, profile, config, timezone: profileTz } = useConsole();
  const availability = useAvailability();
  const hours = useServerResource(loadHours);
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tz = hours.data?.timezone ?? profileTz;
  const now = serverNow();
  const today = isoDateIn(now, tz);
  const todayDow = weekdayOf(today);

  const roles = core.data?.principal.roles ?? [];
  const isEditor = roles.some((r) => EDIT_ROLES.has(r.role));
  const deactivated = profile.data?.account_state === 'DEACTIVATED';
  const suspended = profile.data?.account_state === 'SUSPENDED';
  const canEdit = isEditor && !deactivated;

  // ── Weekly editor state ──
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState<Week>(emptyWeek);
  const [startIntervals, setStartIntervals] = useState<RestaurantHours['intervals']>([]);
  const [draft, setDraft] = useState<Week>(emptyWeek);
  const [undo, setUndo] = useState<Record<number, Range[]>>({});
  // Client checks re-run as you type once a save has found something; a server 422 shows
  // until the next change.
  const [attempt, setAttempt] = useState(0);
  const [serverIssueList, setServerIssueList] = useState<HoursIssue[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<RestaurantHours | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [ask, setAsk] = useState<BarAsk>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const weeklyHeadingRef = useRef<HTMLHeadingElement>(null);
  const specialHeadingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<string | null>(null);

  const liveIssues = useMemo(() => (attempt > 0 ? validateWeek(draft) : []), [attempt, draft]);
  const issues: HoursIssue[] | null = serverIssueList ?? (liveIssues.length > 0 ? liveIssues : null);
  const serverIssues = serverIssueList !== null;
  const dirtyDays = editing ? changedDays(start, draft) : 0;
  const dirty = dirtyDays > 0;
  const used = rangeCount(draft);

  // ── Special-date panel (?date=…) ──
  const dateParam = params.get('date');
  const removeParam = params.get('remove') === '1';
  const panelOpen = Boolean(dateParam && canEdit && hours.data);
  usePagePanelOpen(panelOpen);

  // main aria-busy while loading or saving (the shell owns <main>).
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return;
    main.setAttribute('aria-busy', String(hours.status === 'loading' || saving));
    return () => main.removeAttribute('aria-busy');
  }, [hours.status, saving]);

  useEffect(() => {
    if (attempt > 0 || serverIssueList) summaryRef.current?.focus();
  }, [attempt, serverIssueList]);

  const startEdit = (seed?: Week) => {
    const base = seed ?? weekFromIntervals(hours.data?.intervals ?? []);
    setStart(base.map((d) => d.map((r) => ({ ...r }))));
    setDraft(base.map((d) => d.map((r) => ({ ...r }))));
    setStartIntervals(hours.data?.intervals ?? []);
    setUndo({});
    setAttempt(0);
    setServerIssueList(null);
    setConflict(null);
    setAsk(null);
    setEditing(true);
  };

  const exitEdit = useCallback(() => {
    setEditing(false);
    setAttempt(0);
    setServerIssueList(null);
    setConflict(null);
    setAsk(null);
    setUndo({});
  }, []);

  // ── Leaving with unsaved changes asks in the save bar (HoursUnsaved). ──
  useEffect(() => {
    if (!editing || !dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank') return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      const label = NAV.find((n) => n.to === url.pathname)?.label ?? 'another page';
      setAsk({ kind: 'leave', to: url.pathname + url.search, label });
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [editing, dirty]);

  // ── Editing ──
  const setDay = (day: number, ranges: Range[]) => {
    setServerIssueList(null);
    setDraft((w) => w.map((d, i) => (i === day ? ranges : d)));
  };
  const setRange = (day: number, idx: number, patch: Partial<Range>) => {
    setServerIssueList(null);
    setDraft((w) => w.map((d, i) => (i === day ? d.map((r, j) => (j === idx ? { ...r, ...patch } : r)) : d)));
  };

  const toggleDay = (day: number, open: boolean) => {
    if (open) {
      const restore = undo[day];
      setDay(day, restore && restore.length ? restore : [{ key: newKey(), opens: '', closes: '' }]);
      setUndo((u) => {
        const next = { ...u };
        delete next[day];
        return next;
      });
    } else {
      setUndo((u) => ({ ...u, [day]: draft[day]! }));
      setDay(day, []);
    }
  };

  // ── Saving the week ──
  const save = async (opts: { skipConflict?: boolean; skipClosesNow?: boolean; then?: string } = {}) => {
    const found = validateWeek(draft);
    setServerIssueList(null);
    if (found.length > 0) {
      setAttempt((a) => a + 1);
      setAsk(null);
      return;
    }

    // Closing you now asks first (HoursClosesNow), only when you are open right now.
    if (!opts.skipClosesNow && availability.data?.open_state === 'OPEN' && !hours.data?.overrides.some((o) => o.date === today)) {
      const nowMin = minutesIn(now, tz);
      if (!weekCovers(draft, todayDow, nowMin)) {
        const ended = draft[todayDow]!
          .filter((r) => isClock(r.closes) && !crossesMidnight(r.opens, r.closes) && clockMinutes(r.closes) <= nowMin)
          .map((r) => r.closes)
          .sort((a, b) => clockMinutes(b) - clockMinutes(a))[0];
        const it = `It’s ${dayName(todayDow)} ${formatTime(now, tz)}`;
        const body = ended
          ? `${it} and your new hours end at ${formatClock(ended)} today. Saving closes you now. Orders in progress still complete.`
          : `${it} and your new hours have you closed now. Saving closes you now. Orders in progress still complete.`;
        setAsk({ kind: 'closes-now', body });
        return;
      }
    }

    setAsk(null);
    setSaving(true);
    const { intervals, origin } = intervalsFromWeek(draft);
    try {
      // Re-read just before writing: someone may have changed the hours meanwhile.
      const current = await loadHours();
      if (!opts.skipConflict && !sameIntervals(current.intervals, startIntervals)) {
        setConflict(current);
        setShowCurrent(false);
        return;
      }
      const next = (await call(client.PUT('/v1/restaurant/hours', { body: { intervals, overrides: current.overrides } }))) as RestaurantHours;
      hours.mutate(() => next);
      exitEdit();
      toast.show({ variant: 'success', title: 'Hours saved', description: 'Customers see your new hours now.' });
      void availability.refresh();
      if (opts.then) navigate(opts.then);
    } catch (err) {
      if (isApiError(err) && (err as HgApiError).code === 'VALIDATION_FAILED') {
        const mapped = issuesFromServer((err as HgApiError).details, origin);
        setServerIssueList(
          mapped.length
            ? mapped
            : [{ day: 1, range: 0, field: 'closes', message: '', summary: 'HalalGoes couldn’t accept your hours', target: 'mon' }],
        );
      } else {
        toast.show({
          variant: 'danger',
          title: 'Couldn’t save your hours',
          description: 'Your changes are still here. Check your connection and save again.',
          action: { label: 'Save again', onAction: () => void save(opts) },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Special dates ──
  const openPanel = (date: string, opener: string, remove = false) => {
    openerRef.current = opener;
    const next = new URLSearchParams(params);
    next.set('date', date);
    if (remove) next.set('remove', '1');
    else next.delete('remove');
    setParams(next);
  };
  const closePanel = (focusDate?: string) => {
    const next = new URLSearchParams(params);
    next.delete('date');
    next.delete('remove');
    setParams(next, { replace: true });
    setFocusAfter({ date: focusDate, opener: openerRef.current });
  };
  // Back on the list: focus the saved row, or whatever opened the panel (spec §5.2).
  const [focusAfter, setFocusAfter] = useState<{ date?: string; opener: string | null } | null>(null);
  useEffect(() => {
    if (!focusAfter || panelOpen) return;
    const row = focusAfter.date ? document.querySelector<HTMLElement>(`[data-date="${focusAfter.date}"]`) : null;
    const el = row ?? (focusAfter.opener ? document.getElementById(focusAfter.opener) : null) ?? document.getElementById('add-special-date');
    el?.focus();
    setFocusAfter(null);
  }, [focusAfter, panelOpen]);

  const todayOverride = hours.data?.overrides.find((o) => o.date === today) ?? null;
  const noHours = hours.status !== 'loading' && hours.data !== null && hours.data.intervals.length === 0;

  // ── Render ──
  if (hours.status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="hours-page">
        <p role="status" className="sr-only">
          Loading your hours…
        </p>
        <div aria-hidden="true" className="flex min-h-0 flex-1 gap-3" data-testid="hours-loading">
          <div className="flex flex-1 flex-col gap-2 rounded-lg border border-line-decorative bg-surface-raised p-4">
            <Skeleton variant="rect" width={200} height={28} />
            {UI_DAYS.map((d) => (
              <Skeleton key={d} variant="rect" height={36} />
            ))}
          </div>
          <div className="hidden w-[420px] flex-col gap-2 rounded-lg border border-line-decorative bg-surface-raised p-4 lg:flex">
            <Skeleton variant="rect" width={160} height={28} />
            <Skeleton variant="rect" height={56} />
            <Skeleton variant="rect" height={56} />
          </div>
        </div>
      </div>
    );
  }

  if (hours.status === 'error' || !hours.data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="hours-page">
        <div role="alert" className="flex w-full max-w-[600px] flex-col items-center gap-3 rounded-lg border border-line-interactive bg-surface-raised px-6 py-8 text-center">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-feedback-warning-tint text-[24px] font-bold text-feedback-warning-icon">
            !
          </span>
          <h2 className="text-[22px] font-semibold">We couldn’t load your hours</h2>
          <p className="text-[16px] text-fg-secondary">Your hours haven’t changed. Check your connection and try again.</p>
          <Button variant="primary" size="lg" onPress={() => hours.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const data = hours.data;
  const viewWeek = weekFromIntervals(data.intervals);
  const caption = `${timezoneName(tz)} (${tz}).`;

  const bar = editing ? renderBar() : null;

  function renderBar() {
    let confirm: ActionBarConfirm | null = null;
    if (ask?.kind === 'closes-now') {
      confirm = {
        title: 'Save and close now?',
        body: ask.body,
        onCancel: () => setAsk(null),
        actions: (
          <>
            <Button variant="tertiary" size="md" onPress={() => setAsk(null)}>
              Keep editing
            </Button>
            <Button variant="primary" size="md" onPress={() => void save({ skipClosesNow: true })}>
              Save and close now
            </Button>
          </>
        ),
      };
    } else if (ask?.kind === 'leave') {
      const to = ask.to;
      confirm = {
        title: 'Leave without saving?',
        body: `You’re going to ${ask.label}. Your changes to your hours will be lost; customers keep seeing your current hours.`,
        onCancel: () => setAsk(null),
        actions: (
          <>
            <Button variant="tertiary" size="md" onPress={() => setAsk(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              size="md"
              onPress={() => {
                exitEdit();
                navigate(to);
              }}
            >
              Discard changes
            </Button>
            <Button variant="primary" size="md" onPress={() => void save({ then: to })}>
              Save and go to {ask.label}
            </Button>
          </>
        ),
      };
    }
    const sub = `Saving replaces your weekly hours. Special dates save as you change them. ${used} of ${MAX_RANGES} time ranges used.`;
    return (
      <ActionBar
        testId="hours-save-bar"
        title={dirty ? `Unsaved changes · ${dirtyDays} day${dirtyDays === 1 ? '' : 's'} changed` : 'No changes yet'}
        description={sub}
        hint={dirty ? undefined : { id: 'save-why', text: 'Nothing to save yet' }}
        confirm={confirm}
        actions={
          dirty ? (
            <>
              <Button variant="tertiary" size="md" disabled={saving} onPress={exitEdit}>
                Discard changes
              </Button>
              <Button variant="primary" size="md" loading={saving} onPress={() => void save()}>
                {saving ? 'Saving…' : 'Save hours'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="tertiary" size="md" onPress={exitEdit}>
                Done
              </Button>
              <Button variant="primary" size="md" disabled aria-describedby="save-why">
                Save hours
              </Button>
            </>
          )
        }
      />
    );
  }

  const issuesFor = (day: number, range: number, field: 'opens' | 'closes') =>
    issues?.find((i) => i.day === day && i.range === range && i.field === field)?.message || undefined;

  const weeklyPane = noHours && !editing ? (
    <section aria-labelledby="hours-none-title" className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-line-decorative bg-surface-raised p-6" data-testid="hours-none">
      <h2 id="hours-none-title" className="sr-only">
        Weekly hours
      </h2>
      <EmptyState
        illustration={<Icon name="clock" size={40} className="text-fg-secondary" />}
        title="Add the times you take orders"
        description="Set your hours for each day of the week. Late nights past midnight are fine. You can add holidays and special dates afterwards."
        primaryAction={canEdit ? { label: 'Add your hours', onPress: () => startEdit(emptyWeek()) } : undefined}
        headingLevel={3}
      />
    </section>
  ) : editing ? (
    <section aria-labelledby="weekly-edit-title" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised" data-testid="weekly-editor">
      <div className="border-b border-line-decorative px-4 py-3">
        <h2 id="weekly-edit-title" ref={weeklyHeadingRef} tabIndex={-1} className="hg-focus text-[20px] font-semibold outline-none">
          Edit weekly hours
        </h2>
        <p className="text-[14px] text-fg-secondary">
          {caption} 12-hour clock, am and pm. A closing time earlier than the opening time runs past midnight. Up to 3 time ranges a day.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {issues && issues.length > 0 ? (
          <div ref={summaryRef} role="alert" tabIndex={-1} data-testid="hours-error-summary" className="hg-focus mt-3 rounded-md border border-feedback-danger-border bg-feedback-danger-tint p-3 outline-none">
            <p className="text-[16px] font-semibold text-feedback-danger-tint-text">{fixTitle(issues.length, 'save your hours')}</p>
            {serverIssues ? <p className="text-[15px]">We checked your hours. Fix the date below; nothing was saved.</p> : null}
            <ul className="mt-1 list-disc ps-5">
              {issues.map((i) => (
                <li key={`${i.day}-${i.range}-${i.field}-${i.summary}`}>
                  <a href={`#${i.target}`} className="hg-focus text-[15px] text-fg-link underline">
                    {i.summary}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {conflict ? (
          <div role="alert" data-testid="hours-conflict" className="mt-3 rounded-md border border-feedback-warning-border bg-feedback-warning-tint p-3">
            <p className="text-[16px] font-semibold">Your hours were changed while you were editing</p>
            <p className="text-[15px]">
              Saving replaces your weekly hours, so saving now would undo those changes. Look at the current hours first; your edits stay here.
            </p>
            {showCurrent ? (
              <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 text-[14px]">
                {UI_DAYS.map((d) => (
                  <div key={d} className="contents">
                    <dt className="font-semibold">{dayName(d)}</dt>
                    <dd className="tabular-nums">{describeDay(weekFromIntervals(conflict.intervals)[d]!)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="tertiary" size="md" aria-expanded={showCurrent} onPress={() => setShowCurrent((s) => !s)}>
                See current hours
              </Button>
              <Button variant="ghost" size="md" onPress={() => void save({ skipConflict: true })}>
                Save mine anyway
              </Button>
            </div>
          </div>
        ) : null}
        {UI_DAYS.map((day) => (
          <DayFieldset
            key={day}
            day={day}
            ranges={draft[day]!}
            undone={undo[day]}
            saving={saving}
            total={used}
            issueFor={issuesFor}
            onToggle={(open) => toggleDay(day, open)}
            onUndo={() => toggleDay(day, true)}
            onChange={(idx, patch) => setRange(day, idx, patch)}
            onRemove={(idx) => setDay(day, draft[day]!.filter((_, j) => j !== idx))}
            onAdd={() => setDay(day, [...draft[day]!, { key: newKey(), opens: '', closes: '' }])}
          />
        ))}
      </div>
      {bar}
    </section>
  ) : (
    <section aria-labelledby="weekly-title" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised" data-testid="weekly-hours">
      <div className="flex items-start gap-2 border-b border-line-decorative px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="weekly-title" ref={weeklyHeadingRef} tabIndex={-1} className="hg-focus text-[20px] font-semibold outline-none">
            Weekly hours
          </h2>
          <p className="text-[14px] text-fg-secondary">{caption}</p>
        </div>
        {canEdit ? (
          <Button variant="tertiary" size="md" onPress={() => startEdit()}>
            Edit hours
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[15px]">
          <caption className="sr-only">Weekly opening hours</caption>
          <thead>
            <tr className="h-10 bg-surface-subtle text-left text-[14px] text-fg-secondary">
              <th scope="col" className="w-[180px] px-4 font-semibold">
                Day
              </th>
              <th scope="col" className="px-4 font-semibold">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {UI_DAYS.map((day) => {
              const ranges = viewWeek[day]!;
              const isToday = day === todayDow;
              return (
                <tr key={day} className={`border-t border-line-decorative ${isToday ? 'bg-surface-subtle' : ''}`} data-day={DAY_IDS[day]}>
                  <th scope="row" className="px-4 py-2 text-left font-semibold">
                    <span className="flex flex-wrap items-center gap-2">
                      {dayName(day)}
                      {isToday ? <Badge label="Today" size="sm" variant="neutral" /> : null}
                    </span>
                  </th>
                  <td className="px-4 py-2">
                    {ranges.length === 0 ? (
                      <span className="text-fg-secondary">Closed</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                        {ranges.map((r) =>
                          isTwentyFour(r.opens, r.closes) ? (
                            <span key={r.key}>Open 24 hours from {formatClock(r.opens)}</span>
                          ) : (
                            <span key={r.key} className="inline-flex items-center gap-2">
                              {formatClockRange(r.opens, r.closes)}
                              {crossesMidnight(r.opens, r.closes) ? <Badge label="Past midnight" size="sm" icon="clock" variant="neutral" /> : null}
                            </span>
                          ),
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const special =
    panelOpen && dateParam ? (
      <SpecialDatePanel
        key={dateParam}
        target={dateParam}
        hours={data}
        today={today}
        editingWeek={editing}
        startRemoving={removeParam}
        onClose={() => closePanel()}
        onSaved={(next, info) => {
          hours.mutate(() => next);
          void availability.refresh();
          closePanel(info.removed ? undefined : info.date);
        }}
      />
    ) : (
      <SpecialDatesList hours={data} today={today} editing={editing} canEdit={canEdit} onOpen={openPanel} headingRef={specialHeadingRef} />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="hours-page">
      {suspended ? (
        <Banner
          variant="neutral"
          title="Your account is suspended. You can still update your hours."
          description="No new orders while it lasts. Your hours take effect for customers when HalalGoes reinstates your account. Orders already in progress still complete."
          action={config.data?.support_phone_e164 ? { label: 'Contact support', onPress: () => {}, href: `tel:${config.data.support_phone_e164}` } : undefined}
          testId="suspended-banner"
        />
      ) : null}
      {deactivated ? (
        <Banner variant="neutral" title="Your account is closed. Your hours can no longer be changed." testId="deactivated-banner" />
      ) : null}
      {hours.status === 'stale' ? (
        <Banner
          variant="warning"
          title="Your hours may be out of date"
          description="We couldn’t refresh them. Check your connection."
          action={{ label: 'Try again', onPress: () => void hours.refresh() }}
          testId="hours-stale"
        />
      ) : null}
      <RightNow
        availability={availability}
        restaurantId={core.data?.restaurantId ?? null}
        timezone={tz}
        noHours={noHours}
        todayOverride={todayOverride}
        supportPhone={config.data?.support_phone_e164 ?? null}
        onSeeHours={() => weeklyHeadingRef.current?.focus()}
        onSeeSpecialDates={() => {
          const row = document.querySelector<HTMLElement>(`[data-date="${today}"]`);
          (row ?? specialHeadingRef.current)?.focus();
        }}
      />
      <div className="flex min-h-0 flex-1 gap-3">
        {weeklyPane}
        {special}
      </div>
    </div>
  );
}

// ── One day in the editor (a section of this screen, not a reusable widget) ──────────────

interface DayFieldsetProps {
  day: number;
  ranges: Range[];
  undone?: Range[];
  saving: boolean;
  total: number;
  issueFor: (day: number, range: number, field: 'opens' | 'closes') => string | undefined;
  onToggle: (open: boolean) => void;
  onUndo: () => void;
  onChange: (idx: number, patch: Partial<Range>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}

function DayFieldset({ day, ranges, undone, saving, total, issueFor, onToggle, onUndo, onChange, onRemove, onAdd }: DayFieldsetProps) {
  const name = dayName(day);
  const legendId = useId();
  const fullDay = ranges.length >= MAX_RANGES_PER_DAY;
  const fullWeek = total >= MAX_RANGES;
  const addReason = fullDay ? 'Up to 3 time ranges a day' : fullWeek ? 'You’ve used all 21 time ranges' : null;
  const removed = undone?.filter((r) => isClock(r.opens) && isClock(r.closes)) ?? [];
  return (
    <fieldset id={DAY_IDS[day]} tabIndex={-1} aria-labelledby={legendId} className="grid grid-cols-1 gap-x-3 gap-y-1 border-t border-line-decorative py-3 outline-none first-of-type:border-t-0 xl:grid-cols-[200px_1fr]">
      <legend id={legendId} className="sr-only">
        {name}
      </legend>
      <div className="max-w-[240px]">
        <Switch label={name} checked={ranges.length > 0} stateLabel={{ on: 'Open', off: 'Closed' }} disabled={saving} onChange={onToggle} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {ranges.length === 0 ? (
          <div className="flex min-h-11 flex-wrap items-center gap-2">
            <p className="text-[15px] text-fg-secondary">
              {undone && undone.length > 0
                ? `Closed all day. ${undone.length} time range${undone.length === 1 ? '' : 's'} removed${removed.length ? ` (${removed.map((r) => formatClockRange(r.opens, r.closes)).join(', ')})` : ''}.`
                : 'Closed all day'}
            </p>
            {undone && undone.length > 0 ? (
              <Button variant="ghost" size="sm" accessibilityLabel={`Undo closing ${name}`} disabled={saving} onPress={onUndo}>
                Undo
              </Button>
            ) : null}
          </div>
        ) : (
          ranges.map((r, idx) => {
            const n = idx + 1;
            const suffix = ranges.length > 1 ? `, range ${n}` : '';
            const valid = isClock(r.opens) && isClock(r.closes);
            return (
              <div key={r.key} className="flex flex-wrap items-start gap-2" data-testid={`range-${DAY_IDS[day]}-${n}`}>
                <TimeField label={`Opens${suffix}`} value={r.opens} readOnly={saving} errorText={issueFor(day, idx, 'opens')} onChange={(v) => onChange(idx, { opens: v })} className="w-[130px]" />
                <TimeField label={`Closes${suffix}`} value={r.closes} readOnly={saving} errorText={issueFor(day, idx, 'closes')} onChange={(v) => onChange(idx, { closes: v })} className="w-[150px] xl:w-[240px]" />
                <div className="flex min-h-11 items-center gap-1 pt-6">
                  {valid && isTwentyFour(r.opens, r.closes) ? <Badge label="Open 24 hours" size="sm" icon="clock" variant="neutral" /> : null}
                  {valid && crossesMidnight(r.opens, r.closes) && !isTwentyFour(r.opens, r.closes) ? (
                    <Badge label="Past midnight" size="sm" icon="clock" variant="neutral" />
                  ) : null}
                  <IconButton
                    icon={<Icon name="close" size={18} />}
                    variant="plain"
                    disabled={saving}
                    accessibilityLabel={valid ? `Remove ${formatClock(r.opens)} to ${formatClock(r.closes)} on ${name}` : `Remove time range ${n} on ${name}`}
                    onPress={() => onRemove(idx)}
                  />
                </div>
              </div>
            );
          })
        )}
        {ranges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              iconStart={<Icon name="plus" size={18} />}
              disabled={Boolean(addReason) || saving}
              accessibilityLabel={addReason ? `Add hours on ${name}. Not available: ${addReason.charAt(0).toLowerCase()}${addReason.slice(1)}.` : undefined}
              onPress={onAdd}
            >
              Add hours on {name}
            </Button>
            {addReason ? <span className="text-[14px] text-fg-secondary">{addReason}</span> : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
