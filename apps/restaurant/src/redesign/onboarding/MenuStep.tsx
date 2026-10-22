/**
 * First menu and opening hours, `/onboarding/menu` (canvas ON `Menu-*`, `Hours-Set`): two tasks
 * on one page. The menu is the console's own Menu screen shown in the page (so an item added
 * here is the same item the Menu page edits later); the opening hours are the weekly editor
 * below it, built on the same hours rules as the Hours page (up to 3 ranges a day, past
 * midnight allowed, overlaps refused). The server moves the step to DONE when a reviewer
 * approves the first item and the hours are set; this page never decides that.
 *
 * The contract has no `steps_completed.hours_set`, so "Opening hours: Done" is read from the
 * saved hours themselves.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, InlineAlert, KeyValueList, Skeleton, TimeField, IconButton, Icon } from '../ds';
import { client } from '../data/client';
import { attempt } from '../auth/api';
import { useServerResource } from '../data/useServerResource';
import { serverNow } from '../data/serverClock';
import { MenuPage } from '../menu/MenuPage';
import {
  DAY_IDS,
  MAX_RANGES_PER_DAY,
  UI_DAYS,
  dayName,
  describeDay,
  emptyWeek,
  fixTitle,
  intervalsFromWeek,
  issuesFromServer,
  newKey,
  validateWeek,
  weekFromIntervals,
  type HoursIssue,
  type RestaurantHours,
  type Week,
} from '../hours/model';
import { formatTime } from '../format/time';
import { useOnboarding } from './context';
import { BLOCKING_COPY } from './model';
import { MENU_STEP } from './copy';

async function loadHours(): Promise<RestaurantHours> {
  const res = await attempt(() => client.GET('/v1/restaurant/hours', {}));
  if (!res.ok) throw new Error('hours');
  return res.data as RestaurantHours;
}

export function MenuStep() {
  const ctx = useOnboarding();
  const navigate = useNavigate();
  const hours = useServerResource(loadHours);
  const hoursSet = !!hours.data && hours.data.intervals.length > 0;
  const published = ctx.status.steps_completed.menu_published;
  const code = hoursSet ? 'menu_in_review' : published ? 'hours_not_set' : 'menu_and_hours_pending';

  return (
    <div className="mx-auto flex w-full max-w-[1096px] flex-col gap-4 p-4 xl:p-6" data-testid="menu-step">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-heading-xl text-fg-primary">{MENU_STEP.title}</h1>
        <p className="m-0 max-w-[68ch] text-body-md text-fg-secondary">{MENU_STEP.intro}</p>
      </header>
      <InlineAlert tone="info" title="What's needed now" testId="needed-now">
        <span>{BLOCKING_COPY[hoursSet && !published ? 'menu_in_review' : code]}</span>
      </InlineAlert>
      <section aria-labelledby="mn-h" className="flex flex-col gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
        <h2 id="mn-h" className="m-0 text-heading-sm text-fg-primary">
          Your first menu
        </h2>
        <ul aria-label="What’s left" className="m-0 flex list-none flex-col p-0">
          <Task label="1. Add your first item" done={published} status={published ? 'Done. Your menu is live.' : 'Not done yet. An item goes live once a reviewer approves it.'} />
          <Task label="2. Opening hours" done={hoursSet} status={hoursSet ? 'Done.' : 'Not set yet.'} />
          <Task label="Menu published" done={published} status={published ? 'Yes. It happened when a reviewer approved your first item.' : 'Not yet. This happens by itself when a reviewer approves your first item.'} />
        </ul>
        <div className="flex min-h-[560px] flex-col rounded-[12px] border border-line-decorative bg-surface-sunken p-3" data-testid="embedded-menu">
          <MenuPage />
        </div>
      </section>
      <HoursBlock hours={hours} onSaved={() => void ctx.refreshAll()} />
      {ctx.status.current_step === 'DONE' || (published && hoursSet) ? (
        <div role="region" aria-label="Next step" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4">
          <div className="flex flex-col">
            <span className="text-label-lg text-fg-primary">{MENU_STEP.setTitle}</span>
            <span className="text-body-sm text-fg-secondary">{MENU_STEP.setBody}</span>
          </div>
          <Button
            variant="primary"
            size="lg"
            onPress={() => void ctx.refreshAll().then(() => navigate('/onboarding', { replace: true }))}
          >
            Continue
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Task({ label, done, status }: { label: string; done: boolean; status: string }) {
  return (
    <li className="flex items-start gap-3 border-t border-line-decorative py-2 first:border-t-0">
      <span className="mt-0.5 inline-flex w-5 justify-center text-fg-primary" aria-hidden="true">
        {done ? '✓' : '○'}
      </span>
      <span className="flex flex-col">
        <span className="text-label-lg text-fg-primary">{label}</span>
        <span className="text-body-sm text-fg-secondary">{status}</span>
      </span>
    </li>
  );
}

type Phase = 'view' | 'edit' | 'saving';

function HoursBlock({ hours, onSaved }: { hours: ReturnType<typeof useServerResource<RestaurantHours>>; onSaved: () => void }) {
  const [phase, setPhase] = useState<Phase>('view');
  const [week, setWeek] = useState<Week>(emptyWeek);
  const [issues, setIssues] = useState<HoursIssue[]>([]);
  const [net, setNet] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const origin = useRef<{ day: number; range: number }[]>([]);

  const begin = () => {
    setWeek(hours.data ? weekFromIntervals(hours.data.intervals) : emptyWeek());
    setIssues([]);
    setNet(false);
    setPhase('edit');
  };
  const setRange = (day: number, idx: number, patch: Partial<{ opens: string; closes: string }>) =>
    setWeek((w) => w.map((d, i) => (i === day ? d.map((r, j) => (j === idx ? { ...r, ...patch } : r)) : d)));
  const addRange = (day: number) =>
    setWeek((w) => w.map((d, i) => (i === day && d.length < MAX_RANGES_PER_DAY ? [...d, { key: newKey(), opens: '', closes: '' }] : d)));
  const removeRange = (day: number, idx: number) => setWeek((w) => w.map((d, i) => (i === day ? d.filter((_, j) => j !== idx) : d)));

  const save = async () => {
    const found = validateWeek(week);
    if (found.length > 0) {
      setIssues(found);
      return;
    }
    setIssues([]);
    setNet(false);
    setPhase('saving');
    const { intervals, origin: o } = intervalsFromWeek(week);
    origin.current = o;
    const res = await attempt(() => client.PUT('/v1/restaurant/hours', { body: { intervals, overrides: hours.data?.overrides ?? [] } }));
    if (res.ok) {
      hours.mutate(() => res.data as RestaurantHours);
      setSavedAt(formatTime(serverNow(), (res.data as RestaurantHours).timezone));
      setPhase('view');
      onSaved();
      return;
    }
    setPhase('edit');
    if (!res.network && res.status === 422) {
      const mapped = issuesFromServer(res.details as { field: string; message?: string }[], origin.current);
      setIssues(mapped.length ? mapped : [{ day: 1, range: 0, field: 'closes', message: '', summary: 'HalalGoes couldn’t accept your hours', target: 'mon' }]);
    } else setNet(true);
  };

  const issueFor = (day: number, range: number, field: 'opens' | 'closes') => issues.find((i) => i.day === day && i.range === range && i.field === field)?.message || undefined;

  return (
    <section id="hours" aria-labelledby="hours-h" className="flex flex-col gap-3 rounded-[12px] border border-line-decorative bg-surface-raised p-4" data-testid="hours-block">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hours-h" className="m-0 text-heading-sm text-fg-primary">
          2. Opening hours
        </h2>
        <Badge
          size="md"
          variant={phase === 'view' && hours.data && hours.data.intervals.length > 0 ? 'neutral' : 'info'}
          appearance={phase === 'view' && !(hours.data && hours.data.intervals.length > 0) ? 'outline' : 'tint'}
          label={hours.status === 'loading' ? 'Loading' : hours.status === 'error' ? 'Not loaded' : phase === 'saving' ? 'Saving' : phase === 'edit' ? 'Not saved' : hours.data && hours.data.intervals.length > 0 ? 'Set' : 'Not set'}
        />
      </div>
      {hours.status === 'loading' ? (
        <>
          <p role="status" className="m-0 text-body-md text-fg-secondary">
            {MENU_STEP.hoursLoading}
          </p>
          <Skeleton className="h-24 w-full" />
        </>
      ) : hours.status === 'error' ? (
        <ErrorState title={MENU_STEP.hoursLoadErrorTitle} description={MENU_STEP.hoursLoadErrorBody} onRetry={hours.reload} />
      ) : phase === 'view' ? (
        hours.data && hours.data.intervals.length > 0 ? (
          <>
            <KeyValueList
              testId="hours-summary"
              rows={UI_DAYS.map((d) => ({ key: String(d), label: dayName(d), value: describeDay(weekFromIntervals(hours.data!.intervals)[d]!) }))}
            />
            {savedAt ? <p role="status" className="m-0 text-body-sm text-fg-secondary">Saved at {savedAt}.</p> : null}
            <div>
              <Button variant="secondary" size="md" onPress={begin}>
                Change hours
              </Button>
            </div>
          </>
        ) : (
          <EmptyState title="No opening hours yet" description="Customers can only order while you’re open. Set the days and times you take orders. You can add holidays later in Hours." primaryAction={{ label: 'Set opening hours', onPress: begin }} />
        )
      ) : (
        <form
          noValidate
          className="flex flex-col gap-3"
          aria-label="Opening hours"
          onSubmit={(e) => {
            e.preventDefault();
            if (phase === 'edit') void save();
          }}
        >
          {issues.length > 0 ? (
            <InlineAlert
              tone="danger"
              blocking
              title={issues.length === 1 ? 'Your hours weren’t saved' : fixTitle(issues.length, 'save your hours')}
              testId="hours-errors"
              items={issues.map((i) => ({ targetId: `${DAY_IDS[i.day]}-${i.field === 'opens' ? 'open' : 'close'}-${i.range + 1}`, label: i.summary }))}
            />
          ) : null}
          {net ? (
            <InlineAlert tone="danger" blocking title="Your hours weren’t saved" testId="hours-net-error">
              <span>We couldn't reach HalalGoes, or something went wrong on our side. The times you entered are kept.</span>
            </InlineAlert>
          ) : null}
          <p className="m-0 text-body-sm text-fg-secondary">12-hour time with am or pm, for example 10:00 pm, or 12:30 am for half past midnight. Up to 3 times a day.</p>
          {UI_DAYS.map((day) => (
            <div key={day} role="group" aria-labelledby={`${DAY_IDS[day]}-lbl`} className="flex flex-col gap-2 border-t border-line-decorative pt-3 first:border-t-0 first:pt-0">
              <span id={`${DAY_IDS[day]}-lbl`} className="text-label-lg text-fg-primary">
                {dayName(day)}
              </span>
              {week[day]!.length === 0 ? <span className="text-body-sm text-fg-secondary">No times. Customers can’t order on {dayName(day)}s.</span> : null}
              {week[day]!.map((r, idx) => (
                <div key={r.key} className="flex flex-wrap items-start gap-2">
                  <TimeField id={`${DAY_IDS[day]}-open-${idx + 1}`} label={`${dayName(day)} ${idx === 0 ? 'opens' : 'reopens'}`} value={r.opens} readOnly={phase === 'saving'} {...(issueFor(day, idx, 'opens') ? { errorText: issueFor(day, idx, 'opens')! } : {})} onChange={(v) => setRange(day, idx, { opens: v })} className="w-[150px]" />
                  <TimeField id={`${DAY_IDS[day]}-close-${idx + 1}`} label={`${dayName(day)} closes`} value={r.closes} readOnly={phase === 'saving'} {...(issueFor(day, idx, 'closes') ? { errorText: issueFor(day, idx, 'closes')! } : {})} onChange={(v) => setRange(day, idx, { closes: v })} className="w-[170px]" />
                  <div className="pt-6">
                    <IconButton icon={<Icon name="close" size={18} />} variant="plain" accessibilityLabel={`Remove time range ${idx + 1} on ${dayName(day)}`} onPress={() => removeRange(day, idx)} />
                  </div>
                </div>
              ))}
              {week[day]!.length < MAX_RANGES_PER_DAY ? (
                <div>
                  <Button type="button" variant="tertiary" size="sm" onPress={() => addRange(day)}>
                    {week[day]!.length === 0 ? `Add times for ${dayName(day)}` : 'Add another time'}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg" loading={phase === 'saving'}>
              {net ? 'Try again' : 'Save hours'}
            </Button>
            <Button type="button" variant="ghost" size="md" onPress={() => setPhase('view')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
