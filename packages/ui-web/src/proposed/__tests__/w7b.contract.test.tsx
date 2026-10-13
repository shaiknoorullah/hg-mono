/**
 * W7b restaurant hours and onboarding composites — the contract, table-driven
 * (plan/design-system.md §5.1), plus the behaviour the hours rules depend on.
 *
 * One registry of {component, state, element, role, name}: each row renders and is checked for
 * the role and accessible name the boards specify, `aria-disabled` / `aria-busy` where the state
 * has one, and the measured 44px target class. Then the editor's invariant-bearing behaviour:
 * the error summary takes focus only after a failed save, a Closed day keeps its ranges for Undo
 * and saves none, the 3-range limit, dirty tracking for the save bar, 12-hour display, and the
 * checklist's statuses (aria-current, words with icons, slate for a halal step).
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  SetupChecklist,
  SpecialDatesList,
  WeeklyHoursEditor,
  weeklyHoursFromContract,
  type HoursOverride,
  type SetupChecklistStep,
  type TradingInterval,
  type WeeklyHours,
} from '../index';

/** `restaurant_hours_standard`: Mon–Thu 11–22, Fri–Sat 11–01 (past midnight), Sun 12–21. */
const STANDARD: TradingInterval[] = [
  { day_of_week: 0, opens_at: '12:00', closes_at: '21:00', crosses_midnight: false },
  ...[1, 2, 3, 4].map((d) => ({ day_of_week: d, opens_at: '11:00', closes_at: '22:00', crosses_midnight: false })),
  { day_of_week: 5, opens_at: '11:00', closes_at: '01:00', crosses_midnight: true },
  { day_of_week: 6, opens_at: '11:00', closes_at: '01:00', crosses_midnight: true },
];
const WEEK = weeklyHoursFromContract(STANDARD);
const THREE_ON_FRIDAY: WeeklyHours = {
  ...WEEK,
  fri: { closed: false, ranges: [{ open: '07:00', close: '10:30' }, { open: '11:00', close: '15:00' }, { open: '17:00', close: '02:00' }] },
};
const OVERLAP: WeeklyHours = { ...WEEK, fri: { closed: false, ranges: [{ open: '11:00', close: '15:00' }, { open: '14:00', close: '02:00' }] } };

const OVERRIDES: HoursOverride[] = [
  { date: '2026-10-12', is_closed: false, opens_at: '12:00', closes_at: '20:00', reason: 'Thanksgiving' },
  { date: '2026-10-24', is_closed: true, opens_at: null, closes_at: null, reason: 'Staff training' },
  { date: '2026-12-31', is_closed: false, opens_at: '18:00', closes_at: '01:00', reason: 'New Year’s Eve' },
  { date: '2026-09-07', is_closed: true, opens_at: null, closes_at: null, reason: 'Labour Day' },
];
const NINETY: HoursOverride[] = Array.from({ length: 90 }, (_, i) => ({
  date: `2027-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
  is_closed: true,
  opens_at: null,
  closes_at: null,
  reason: null,
}));

const STEPS: SetupChecklistStep[] = [
  { id: 'profile', label: 'Business profile', status: 'done', href: '/onboarding/profile' },
  { id: 'docs', label: 'Documents added', status: 'done' },
  { id: 'sent', label: 'Sent for review', status: 'done' },
  { id: 'approved', label: 'Documents approved', status: 'done' },
  { id: 'payout', label: 'Payout account', status: 'current' },
  { id: 'hours', label: 'Opening hours', status: 'upcoming' },
  { id: 'menu', label: 'Menu published', status: 'blocked' },
];

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  role: string;
  name: string | RegExp;
  check?: (el: HTMLElement) => void;
}

const target44 = (el: HTMLElement) => expect(el.className).toMatch(/min-h-11|size-11/);
const disabled = (el: HTMLElement) => expect(el).toHaveAttribute('aria-disabled', 'true');

const REGISTRY: Row[] = [
  {
    component: 'WeeklyHoursEditor',
    state: 'edit: a day is a Switch with Open / Closed words',
    element: () => <WeeklyHoursEditor value={WEEK} onValueChange={() => undefined} />,
    role: 'switch',
    name: /Friday/,
    check: (el) => expect(el).toBeChecked(),
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'edit: remove a range (44px, named with the 12-hour range)',
    element: () => <WeeklyHoursEditor value={WEEK} onValueChange={() => undefined} />,
    role: 'button',
    name: 'Remove 11:00 am to 1:00 am on Friday',
    check: target44,
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'dayclosed: Add is unavailable at 3 ranges and says why',
    element: () => <WeeklyHoursEditor value={THREE_ON_FRIDAY} onValueChange={() => undefined} />,
    role: 'button',
    name: 'Add hours on Friday. Not available: up to 3 time ranges a day.',
    check: (el) => {
      disabled(el);
      target44(el);
    },
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'clean: Save is unavailable (focusable), Done replaces Discard',
    element: () => <WeeklyHoursEditor value={WEEK} savedValue={WEEK} onSave={() => undefined} onDiscard={() => undefined} />,
    role: 'button',
    name: 'Save hours',
    check: disabled,
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'saving: the section and Save are busy',
    element: () => (
      <WeeklyHoursEditor value={OVERLAP} savedValue={WEEK} saving onSave={() => undefined} onDiscard={() => undefined} />
    ),
    role: 'region',
    name: 'Edit weekly hours',
    check: (el) => {
      expect(el).toHaveAttribute('aria-busy', 'true');
      expect(within(el).getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');
    },
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'onboarding: Closed is a Checkbox',
    element: () => <WeeklyHoursEditor value={WEEK} closedControl="checkbox" onValueChange={() => undefined} />,
    role: 'checkbox',
    name: 'Closed',
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'read-only: the static schedule table',
    element: () => <WeeklyHoursEditor value={WEEK} readOnly today="fri" />,
    role: 'table',
    name: 'Weekly opening hours',
    check: (el) => {
      expect(el).toHaveTextContent('11:00 am – 1:00 am');
      expect(el).toHaveTextContent('Past midnight');
      expect(within(el).queryByRole('switch')).toBeNull();
    },
  },
  {
    component: 'WeeklyHoursEditor',
    state: 'server error mapped to the day: the summary links to it',
    element: () => <WeeklyHoursEditor value={WEEK} errors={{ fri: 'Closing time is not valid.' }} onValueChange={() => undefined} />,
    role: 'link',
    name: 'Friday: Closing time is not valid.',
  },
  {
    component: 'SpecialDatesList',
    state: 'list: Edit names the date (44px)',
    element: () => <SpecialDatesList overrides={OVERRIDES} today="2026-10-10" onAdd={() => undefined} onEdit={() => undefined} />,
    role: 'button',
    name: 'Edit special date Monday 12 October 2026',
    check: target44,
  },
  {
    component: 'SpecialDatesList',
    state: 'editing: Remove per row',
    element: () => <SpecialDatesList overrides={OVERRIDES} today="2026-10-10" editing onRemove={() => undefined} />,
    role: 'button',
    name: 'Remove special date Saturday 24 October 2026',
    check: target44,
  },
  {
    component: 'SpecialDatesList',
    state: 'limits: Add date unavailable at 90',
    element: () => <SpecialDatesList overrides={NINETY} today="2026-10-10" onAdd={() => undefined} />,
    role: 'button',
    name: 'Add date. Not available: you have 90 special dates, the most allowed.',
    check: disabled,
  },
  {
    component: 'SpecialDatesList',
    state: 'loading: busy region',
    element: () => <SpecialDatesList overrides={undefined} today="2026-10-10" loading />,
    role: 'region',
    name: 'Special dates',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  {
    component: 'SpecialDatesList',
    state: 'error: Try again',
    element: () => <SpecialDatesList overrides={undefined} today="2026-10-10" error="Check your connection." onRetry={() => undefined} />,
    role: 'button',
    name: 'Try again',
  },
  {
    component: 'SetupChecklist',
    state: 'expanded: a complementary landmark',
    element: () => <SetupChecklist steps={STEPS} currentLabel="Payout setup" percent={57} />,
    role: 'complementary',
    name: 'Your setup',
  },
  {
    component: 'SetupChecklist',
    state: 'progress from the server',
    element: () => <SetupChecklist steps={STEPS} percent={57} />,
    role: 'progressbar',
    name: 'Setup progress',
    check: (el) => expect(el).toHaveAttribute('aria-valuenow', '57'),
  },
  {
    component: 'SetupChecklist',
    state: 'a done step with an href is a link (44px)',
    element: () => <SetupChecklist steps={STEPS} />,
    role: 'link',
    name: /^Business profile ?: Done$/,
    check: (el) => {
      expect(el).toHaveAttribute('href', '/onboarding/profile');
      target44(el);
    },
  },
  {
    component: 'SetupChecklist',
    state: 'collapsible: the toggle says what it does',
    element: () => <SetupChecklist steps={STEPS} onCollapsedChange={() => undefined} />,
    role: 'button',
    name: 'Collapse the setup checklist',
    check: (el) => {
      expect(el).toHaveAttribute('aria-expanded', 'true');
      target44(el);
    },
  },
  {
    component: 'SetupChecklist',
    state: 'loading: busy',
    element: () => <SetupChecklist steps={[]} loading />,
    role: 'complementary',
    name: 'Your setup',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
];

describe('W7b contract registry', () => {
  it.each(REGISTRY.map((r) => [`${r.component} — ${r.state}`, r] as const))('%s', (_label, row) => {
    render(row.element());
    const el = screen.getAllByRole(row.role, { name: row.name })[0]!;
    expect(el).toBeInTheDocument();
    row.check?.(el);
  });
});

function Harness({ initial, onSave }: { initial: WeeklyHours; onSave?: (iv: TradingInterval[]) => void }) {
  const [value, setValue] = useState(initial);
  return <WeeklyHoursEditor value={value} savedValue={WEEK} onValueChange={setValue} onSave={onSave} onDiscard={() => setValue(WEEK)} />;
}

describe('WeeklyHoursEditor behaviour', () => {
  it('a failed save shows the summary, focuses it, links to the range and marks the field; nothing is sent', () => {
    const onSave = vi.fn();
    render(<Harness initial={OVERLAP} onSave={onSave} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(onSave).not.toHaveBeenCalled();
    const summary = screen.getByTestId('WeeklyHoursEditor-summary');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('Fix 1 thing to save your hours');
    const link = within(summary).getByRole('link', { name: 'Friday: two time ranges overlap' });
    const target = document.getElementById(link.getAttribute('href')!.slice(1))!;
    expect(target).toHaveAccessibleName('Friday, time range 2');
    expect(target).toHaveTextContent('Overlaps 11:00 am – 3:00 pm. Change one of them.');
  });

  it('a valid save sends the contract’s intervals with crosses_midnight, the changed day counted', () => {
    const onSave = vi.fn();
    const next: WeeklyHours = { ...WEEK, mon: { closed: false, ranges: [{ open: '11:00', close: '23:00' }] } };
    render(<Harness initial={next} onSave={onSave} />);
    expect(screen.getByText('Unsaved changes · 1 day changed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    const [intervals] = onSave.mock.calls[0]!;
    expect(intervals).toContainEqual({ day_of_week: 1, opens_at: '11:00', closes_at: '23:00', crosses_midnight: false });
    expect(intervals).toContainEqual({ day_of_week: 5, opens_at: '11:00', closes_at: '01:00', crosses_midnight: true });
    expect(intervals).toHaveLength(7);
  });

  it('closing a day keeps its range for Undo and sends no interval for it; Undo brings it back', () => {
    const onSave = vi.fn();
    render(<Harness initial={WEEK} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: /Saturday/ }));
    expect(screen.getByText('Closed all day. 1 time range removed (11:00 am – 1:00 am).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    const [intervals] = onSave.mock.calls[0]! as [TradingInterval[]];
    expect(intervals.some((i) => i.day_of_week === 6)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo closing Saturday' }));
    expect(screen.getByText('No changes yet')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Saturday/ })).toBeChecked();
  });

  it('adds up to 3 ranges a day, then Add is unavailable and pressing it adds nothing', () => {
    render(<Harness initial={WEEK} />);
    const add = () => screen.getByRole('button', { name: /^Add hours on Monday/ });
    fireEvent.click(add());
    fireEvent.click(add());
    expect(screen.getAllByRole('group', { name: /^Monday, time range \d/ })).toHaveLength(3);
    expect(add()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(add());
    expect(screen.getAllByRole('group', { name: /^Monday, time range \d/ })).toHaveLength(3);
    expect(screen.getByText('Up to 3 time ranges a day')).toBeInTheDocument();
  });

  it('reads every time back in 12-hour form and labels the past-midnight and 24-hour ranges', () => {
    const allDay: WeeklyHours = { ...WEEK, wed: { closed: false, ranges: [{ open: '09:00', close: '09:00' }] } };
    render(<WeeklyHoursEditor value={allDay} readOnly />);
    const table = screen.getByRole('table', { name: 'Weekly opening hours' });
    expect(table).toHaveTextContent('Open 24 hours from 9:00 am');
    expect(table).toHaveTextContent('12:00 pm – 9:00 pm');
    expect(table.textContent).not.toMatch(/\b(1[3-9]|2[0-3]):\d\d\b/);
    expect(within(table).getAllByText('Past midnight')).toHaveLength(2);
    expect(within(table).getByText('Open 24 hours')).toBeInTheDocument();
  });
});

describe('SpecialDatesList', () => {
  it('lists upcoming dates in order, in words, with past dates kept behind a disclosure', () => {
    render(<SpecialDatesList overrides={OVERRIDES} today="2026-10-12" onEdit={() => undefined} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Monday 12 October 2026 (today)');
    expect(items[0]).toContain('In effect now');
    expect(items[1]).toContain('Closed all day');
    expect(items[2]).toContain('6:00 pm – 1:00 am (past midnight)');
    expect(screen.getByRole('button', { name: /Past dates \(1\)/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('empty: says the weekly hours apply every day', () => {
    render(<SpecialDatesList overrides={[]} today="2026-10-12" />);
    expect(screen.getByText('No special dates')).toBeInTheDocument();
  });
});

describe('SetupChecklist', () => {
  it('each step says its status in words with an icon; the row being worked on is aria-current, filled', () => {
    render(<SetupChecklist steps={STEPS} currentLabel="Payout setup" />);
    const rows = screen.getAllByRole('listitem');
    const current = rows.find((r) => r.getAttribute('aria-current') === 'step')!;
    expect(current).toHaveTextContent('Payout accountIn progress');
    expect(current.className).toMatch(/bg-surface-sunken/);
    expect(current.className).not.toMatch(/border-(l|s)\b/);
    expect(rows.find((r) => r.textContent?.startsWith('Opening hours'))).toHaveTextContent('Not yet');
    expect(rows.find((r) => r.textContent?.startsWith('Menu published'))).toHaveTextContent('Not open yet');
    expect(screen.getByText('57% complete')).toBeInTheDocument();
  });

  it('a halal step that needs attention is slate, never the amber warning or danger', () => {
    const steps: SetupChecklistStep[] = [
      { id: 'cert', label: 'Documents approved', status: 'attention', statusLabel: 'Renew certificate', halal: true },
      { id: 'food', label: 'Food safety', status: 'attention', statusLabel: 'New upload' },
    ];
    render(<SetupChecklist steps={steps} />);
    const [cert, food] = screen.getAllByRole('listitem');
    expect(within(cert!).getByTestId('Badge')).toHaveAttribute('data-variant', 'outline');
    expect(cert!.innerHTML).not.toMatch(/warning|danger/);
    expect(within(food!).getByTestId('Badge')).toHaveAttribute('data-variant', 'warning');
  });

  it('collapses to icons with the percentage, keeping every name and status as text', () => {
    const onCollapsedChange = vi.fn();
    render(<SetupChecklist steps={STEPS} percent={57} onCollapsedChange={onCollapsedChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the setup checklist' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Expand the setup checklist' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('57%')).toBeInTheDocument();
    expect(screen.getByText('Payout account: In progress')).toBeInTheDocument();
  });
});
