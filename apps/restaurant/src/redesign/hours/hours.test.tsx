/**
 * WP9 — Hours and pause (spec wp9-hours; manifest §3 WP9 DONE): the boards' states against
 * the contract's fixtures (`restaurant_hours_standard`, `restaurant_open_state_*`), patched
 * where the contract has no fixture yet (hours empty, 21 ranges, suspended profile, auto-off:
 * fixtures requested in #676).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FakeRealtimeSocket } from '@hg/ui-web/testing';
import { consoleRoutes, errorBody, fixture, installFakeApi, restaurantPrincipal, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { addDays, formatTime, isoDateIn } from '../format/time';
import { ActionBar, Button, type ActionBarConfirm } from '../ds';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TZ = 'America/Toronto';
const today = () => isoDateIn(Date.now(), TZ);

/**
 * Fixes the clock (Date only; timers stay real so waitFor and the fake API run) for the tests
 * whose outcome depends on the time of day: the weekly save asks "Save and close now?" only
 * when the new hours have you closed now. The fixture's Monday is 11:00 am – 10:00 pm.
 */
const MONDAY_NOON = '2026-10-12T16:00:00Z'; // Monday 12 October 2026, 12:00 pm in Toronto
const MONDAY_930PM = '2026-10-13T01:30:00Z'; // Monday 12 October 2026, 9:30 pm in Toronto
function clockAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

function openAvailability(patch: Record<string, unknown> = {}) {
  return { ...fixture('restaurant_open_state_open'), pause_until: null, missed_order_count: 0, reason: 'Open and accepting orders.', ...patch };
}

/** Hours GET/PUT over a store, so a PUT changes the next GET (the mock forgets writes). */
function hoursRoutes(seed = fixture('restaurant_hours_standard')) {
  const state = { hours: seed, puts: [] as any[] };
  const handler: Handler = async (req) => {
    if (req.method === 'PUT') {
      const body = await req.json();
      state.puts.push(body);
      state.hours = { timezone: state.hours.timezone, intervals: body.intervals, overrides: body.overrides ?? [] };
    }
    return { body: state.hours };
  };
  return { state, routes: { 'GET /v1/restaurant/hours': handler, 'PUT /v1/restaurant/hours': handler } };
}

function setup(opts: { hours?: any; availability?: any; overrides?: Record<string, Handler> } = {}) {
  const h = hoursRoutes(opts.hours);
  const patches: any[] = [];
  let av = opts.availability ?? openAvailability();
  const api = installFakeApi(
    consoleRoutes({
      ...h.routes,
      'GET /v1/restaurant/availability': () => ({ body: av }),
      'PATCH /v1/restaurant/availability': async (req) => {
        const body = await req.json();
        patches.push(body);
        const pausing = body.is_accepting_orders && body.pause_until;
        av = {
          ...av,
          is_accepting_orders: body.is_accepting_orders,
          pause_until: body.is_accepting_orders ? (body.pause_until ?? null) : av.pause_until,
          open_state: !body.is_accepting_orders ? 'CLOSED_TOGGLE' : pausing ? 'PAUSED' : 'OPEN',
          reason: !body.is_accepting_orders ? 'This restaurant has paused new orders.' : pausing ? 'Briefly paused.' : 'Open and accepting orders.',
        };
        return { body: av };
      },
      ...(opts.overrides ?? {}),
    }),
  );
  return { api, hours: h.state, patches };
}

async function openHours(path = '/hours') {
  await renderRedesign(path);
  return screen.findByRole('table', { name: 'Weekly opening hours' });
}

const editor = () => screen.getByRole('region', { name: 'Edit weekly hours' });
const day = (id: string) => document.getElementById(id) as HTMLElement;
const type = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe('Hours: view', () => {
  it('shows the week Monday first in 12-hour time, ranges past midnight badged, today marked, and the special dates', async () => {
    setup();
    const table = await openHours();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent?.replace('Today', ''))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    const friday = within(table).getByRole('row', { name: /Friday/ });
    expect(friday.textContent).toContain('11:00 am – 1:00 am');
    expect(within(friday).getByText('Past midnight')).toBeTruthy();
    expect(within(table).getByRole('row', { name: /Sunday/ }).textContent).toContain('12:00 pm – 9:00 pm');
    expect(screen.getByText('Eastern time (America/Toronto).')).toBeTruthy();
    // Today's row carries the Today badge.
    const weekday = new Intl.DateTimeFormat('en-CA', { weekday: 'long', timeZone: TZ }).format(new Date());
    expect(within(within(table).getByRole('row', { name: new RegExp(weekday) })).getByText('Today')).toBeTruthy();
    const special = screen.getByRole('region', { name: 'Special dates' });
    expect(within(special).getByText('Friday 25 December 2026')).toBeTruthy();
    expect(within(special).getByText('4:00 pm – 10:00 pm')).toBeTruthy();
    expect(within(special).getByText('Saturday 20 March 2027')).toBeTruthy();
    expect(within(special).getByText('Closed all day')).toBeTruthy();
    // The closed date follows a Friday whose hours run past midnight.
    expect(within(special).getByText('Friday’s hours still run to 1:00 am on Saturday. You’re closed from 1:00 am.')).toBeTruthy();
  });

  it('says it is loading, then shows the error with a way out, then the hours', async () => {
    let fail = true;
    setup({ overrides: { 'GET /v1/restaurant/hours': () => (fail ? { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } : { body: fixture('restaurant_hours_standard') }) } });
    await renderRedesign('/hours');
    expect(await screen.findByText('Loading your hours…')).toBeTruthy();
    const heading = await screen.findByRole('heading', { name: 'We couldn’t load your hours' });
    const alert = heading.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(within(alert).getByText('Your hours haven’t changed. Check your connection and try again.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Right now' })).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Weekly opening hours' })).toBeTruthy();
  });

  it('with no hours: the empty state opens the editor, Right now says customers can’t order, and there is no switch', async () => {
    setup({ hours: { timezone: TZ, intervals: [], overrides: [] } });
    await renderRedesign('/hours');
    expect(await screen.findByRole('heading', { name: 'Add the times you take orders' })).toBeTruthy();
    expect(screen.getByTestId('right-now-reason').textContent).toBe('You have no opening hours set, so customers can’t order.');
    expect(screen.getByText('New orders are switched on, but you have no hours, so none can arrive.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'New orders' })).toBeNull();
    expect(screen.getByText('No special dates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add your hours' }));
    expect(editor()).toBeTruthy();
    expect(within(day('mon')).getByText('Closed all day')).toBeTruthy();
  });

  it('shows the same opening and closing time as open 24 hours', async () => {
    const hours = fixture('restaurant_hours_standard');
    hours.intervals = [{ day_of_week: 1, opens_at: '09:00', closes_at: '09:00', crosses_midnight: true }];
    setup({ hours });
    const table = await openHours();
    expect(within(table).getByRole('row', { name: /Monday/ }).textContent).toContain('Open 24 hours from 9:00 am');
  });
});

describe('Hours: Right now', () => {
  it('pause: three lengths each naming its end time, none preselected, no "until closing"; sends pause_until and shows the time read back', async () => {
    const { patches } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Pause new orders' }));
    const menu = screen.getByRole('menu', { name: 'Pause new orders' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.replace(/\(until .*\)/, '(until …)'))).toEqual([
      'Pause for 15 minutes (until …)',
      'Pause for 30 minutes (until …)',
      'Pause for 60 minutes (until …)',
    ]);
    expect(within(menu).queryByText(/until closing/i)).toBeNull();
    expect(within(menu).queryAllByRole('menuitemradio')).toHaveLength(0);
    fireEvent.click(items[0]!);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].is_accepting_orders).toBe(true);
    const mins = (Date.parse(patches[0].pause_until) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
    expect(await screen.findByText(`Paused until ${formatTime(patches[0].pause_until, TZ)}.`)).toBeTruthy();
    expect(screen.getByTestId('right-now-badge').textContent).toBe('Paused');
  });

  it('resume asks in the page first (Stay paused focused); a failed resume says you are still paused', async () => {
    const until = new Date(Date.now() + 20 * 60_000).toISOString();
    const { api } = setup({ availability: openAvailability({ open_state: 'PAUSED', pause_until: until, resolvable_by: 'TIME' }) });
    await openHours();
    expect(screen.getByText(`Paused until ${formatTime(until, TZ)}.`)).toBeTruthy();
    // The Right now card's (the status bar on every console page has its own Resume now).
    fireEvent.click(within(screen.getByTestId('right-now')).getByRole('button', { name: 'Resume now' }));
    const confirm = screen.getByRole('group', { name: 'Resume new orders now?' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Stay paused' }));
    api.set('PATCH /v1/restaurant/availability', { status: 503, body: errorBody('SERVICE_UNAVAILABLE') });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Resume now' }));
    expect((await screen.findByText(`Couldn’t resume. You are still paused until ${formatTime(until, TZ)}.`)).getAttribute('role')).toBe('alert');
    const body = await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json();
    expect(body).toEqual({ is_accepting_orders: true, pause_until: null });
  });

  it('a pause whose time has passed says so and offers Refresh', async () => {
    const until = new Date(Date.now() - 2 * 60_000).toISOString();
    setup({ availability: openAvailability({ open_state: 'PAUSED', pause_until: until }) });
    await openHours();
    expect(screen.getByTestId('right-now-reason').textContent).toBe(`Your pause ended at ${formatTime(until, TZ)}. Updating this screen…`);
    expect(screen.getByText('If this doesn’t change within a minute, refresh.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('turning off asks first ("Keep accepting" focused); a failure leaves the switch on and says so', async () => {
    const { api } = setup({ overrides: { 'PATCH /v1/restaurant/availability': { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } } });
    await openHours();
    const sw = screen.getByRole('switch', { name: 'New orders' });
    fireEvent.click(sw);
    const confirm = screen.getByRole('group', { name: 'Stop accepting new orders?' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep accepting' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop accepting' }));
    expect(await screen.findByText('Couldn’t turn off new orders. You are still accepting orders.')).toBeTruthy();
    expect(screen.getByText('You are still accepting orders. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'New orders' }).getAttribute('aria-checked')).toBe('true');
    expect(await api.callsTo('PATCH /v1/restaurant/availability')[0]!.json()).toEqual({ is_accepting_orders: false });
  });

  it('one missed order warns before the second stops new orders', async () => {
    setup({ availability: openAvailability({ missed_order_count: 1 }) });
    await openHours();
    expect(screen.getByText(/1 order timed out without an answer\. One more in a row and new orders stop\./)).toBeTruthy();
  });

  it('closed by hours explains why switching on doesn’t open you (step 6 of 7)', async () => {
    setup({ availability: openAvailability({ open_state: 'CLOSED_HOURS', reason: 'Outside your opening hours.', resolvable_by: 'TIME' }) });
    await openHours();
    expect(screen.getByText('New orders is on. You’re closed because it’s outside your opening hours.')).toBeTruthy();
    expect(screen.getByText('Why switching on doesn’t open you')).toBeTruthy();
    expect(screen.getByText(/You’re closed because of step 6\./)).toBeTruthy();
    expect(screen.getByText(/this is why you are closed now/).textContent).toContain('You are outside your opening hours');
    expect(screen.getByRole('button', { name: 'See your hours' })).toBeTruthy();
  });

  it('offline points to the Orders page on this device', async () => {
    setup({ availability: openAvailability({ open_state: 'CLOSED_OFFLINE', reason: 'No order screen has checked in for 5 minutes.', resolvable_by: 'RESTAURANT' }) });
    await openHours();
    expect(screen.getByTestId('right-now-badge').textContent).toBe('Not receiving orders');
    expect(screen.getByRole('button', { name: 'Open Orders on this device' })).toBeTruthy();
  });

  it('raises the auto-off toast only from the live event, naming HalalGoes when the event does', async () => {
    const sockets: FakeRealtimeSocket[] = [];
    vi.stubGlobal(
      'WebSocket',
      class extends FakeRealtimeSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      },
    );
    setup({ overrides: { 'POST /v1/realtime/ticket': 'realtime_ticket' } });
    await openHours();
    expect(screen.queryByText('HalalGoes switched off new orders')).toBeNull();
    await waitFor(() => expect(sockets.length).toBe(1));
    const sock = sockets[0]!;
    await act(async () => sock.open());
    const id = fixture('restaurant_profile').id;
    await waitFor(() => expect(sock.sent).toContainEqual(expect.objectContaining({ type: 'subscribe', channel: `restaurant:${id}` })));
    await act(async () => {
      sock.push({
        id: 'e1',
        seq: 1,
        channel: `restaurant:${id}`,
        type: 'restaurant.status_changed',
        data: {
          restaurant_id: id,
          is_accepting_orders: false,
          open_state: 'CLOSED_TOGGLE',
          reason: 'New orders were switched off after 2 orders in a row timed out.',
          changed_by: 'HalalGoes',
        },
      });
    });
    expect(await screen.findByText('HalalGoes switched off new orders')).toBeTruthy();
    expect(screen.getAllByText('New orders were switched off after 2 orders in a row timed out.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Go to Orders' })).toBeTruthy();
  });
});

describe('Hours: weekly editor', () => {
  it('catches overlap on the same day and past midnight into the next day, Sunday into Monday too; the summary takes focus and nothing is sent', async () => {
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    expect(within(editor()).getByText('No changes yet')).toBeTruthy();
    // Friday 11:00 am – 3:00 pm and 2:00 pm – 2:00 am.
    type(within(day('fri')).getByLabelText('Closes'), '3:00 pm');
    fireEvent.click(within(day('fri')).getByRole('button', { name: 'Add hours on Friday' }));
    type(within(day('fri')).getByLabelText('Opens, range 2'), '2:00 pm');
    type(within(day('fri')).getByLabelText('Closes, range 2'), '2:00 am');
    // Sunday 8:00 pm – 3:00 am runs into Monday 2:00 am.
    type(within(day('sun')).getByLabelText('Opens'), '8:00 pm');
    type(within(day('sun')).getByLabelText('Closes'), '3:00 am');
    type(within(day('mon')).getByLabelText('Opens'), '2:00 am');
    type(within(day('mon')).getByLabelText('Closes'), '10:00 am');
    expect(screen.getByText('Unsaved changes · 3 days changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    const summary = await screen.findByTestId('hours-error-summary');
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.textContent).toContain('Fix 2 things to save your hours');
    const links = within(summary).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Sunday and Monday: Sunday 8:00 pm – 3:00 am runs into Monday 2:00 am – 10:00 am', '#mon'],
      ['Friday: two time ranges overlap', '#fri'],
    ]);
    expect(within(day('fri')).getByText('Overlaps 11:00 am – 3:00 pm. Change one of them.')).toBeTruthy();
    expect(within(day('mon')).getByText('Overlaps Sunday 8:00 pm – 3:00 am, which runs to 3:00 am on Monday. Change one of them.')).toBeTruthy();
    expect(hours.puts).toHaveLength(0);
  });

  it('saves: re-reads first, sends the edited week with crosses_midnight and the special dates the server has, then shows the new hours', async () => {
    clockAt(MONDAY_NOON);
    const { api, hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('fri')).getByLabelText('Closes'), '3:00 pm');
    fireEvent.click(within(day('fri')).getByRole('button', { name: 'Add hours on Friday' }));
    type(within(day('fri')).getByLabelText('Opens, range 2'), '5:00 pm');
    type(within(day('fri')).getByLabelText('Closes, range 2'), '12:30 am');
    type(within(day('sat')).getByLabelText('Opens'), '1:00 am');
    // Someone added a special date meanwhile: it must survive the weekly save.
    const added = { date: addDays(today(), 50), is_closed: true, opens_at: null, closes_at: null, reason: 'Added elsewhere' };
    hours.hours = { ...hours.hours, overrides: [...hours.hours.overrides, added] };
    const getsBefore = api.callsTo('GET /v1/restaurant/hours').length;
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    // Monday noon is inside the new hours: nothing to ask.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText('Hours saved')).toBeTruthy();
    expect(screen.getByText('Customers see your new hours now.')).toBeTruthy();
    expect(api.callsTo('GET /v1/restaurant/hours').length).toBeGreaterThan(getsBefore);
    const sent = hours.puts[0];
    expect(sent.intervals.filter((i: any) => i.day_of_week === 5)).toEqual([
      { day_of_week: 5, opens_at: '11:00', closes_at: '15:00', crosses_midnight: false },
      { day_of_week: 5, opens_at: '17:00', closes_at: '00:30', crosses_midnight: true },
    ]);
    expect(sent.overrides).toContainEqual(added);
    const friday = within(screen.getByRole('table', { name: 'Weekly opening hours' })).getByRole('row', { name: /Friday/ });
    expect(friday.textContent).toContain('5:00 pm – 12:30 am');
  });

  it('stops when the hours changed while editing (HoursConflict); "Save mine anyway" saves', async () => {
    clockAt(MONDAY_NOON);
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('mon')).getByLabelText('Closes'), '9:00 pm');
    hours.hours = { ...hours.hours, intervals: hours.hours.intervals.map((i: any) => (i.day_of_week === 2 ? { ...i, closes_at: '23:00' } : i)) };
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const banner = await screen.findByTestId('hours-conflict');
    expect(within(banner).getByText('Your hours were changed while you were editing')).toBeTruthy();
    expect(hours.puts).toHaveLength(0);
    fireEvent.click(within(banner).getByRole('button', { name: 'See current hours' }));
    expect(within(banner).getByText('11:00 am – 11:00 pm')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Hours saved')).toBeTruthy();
    expect(hours.puts).toHaveLength(1);
  });

  it('maps a server 422 to the day and keeps the edits; a network failure keeps them, and "Save again" saves the edits as they are then', async () => {
    clockAt(MONDAY_NOON);
    const { api, hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('mon')).getByLabelText('Closes'), '9:00 pm');
    // intervals[2] is Wednesday (Monday first, one range a day).
    api.set('PUT /v1/restaurant/hours', {
      status: 422,
      body: { error: { code: 'VALIDATION_FAILED', message: 'x', request_id: 'r', details: [{ field: 'intervals[2].closes_at', code: 'invalid', message: 'closes_at must be HH:MM' }] } },
    });
    const save = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    };
    save();
    const summary = await screen.findByTestId('hours-error-summary');
    expect(within(summary).getByText('We checked your hours. Fix the date below; nothing was saved.')).toBeTruthy();
    expect(within(summary).getByRole('link', { name: 'Wednesday: HalalGoes couldn’t accept a time' }).getAttribute('href')).toBe('#wed');
    expect(within(day('wed')).getByText('HalalGoes couldn’t accept this time. Enter a time like 11:00 am.')).toBeTruthy();
    api.set('PUT /v1/restaurant/hours', { status: 503, body: errorBody('SERVICE_UNAVAILABLE') });
    save();
    expect(await screen.findByText('Couldn’t save your hours')).toBeTruthy();
    expect(screen.getByText('Your changes are still here. Check your connection and save again.')).toBeTruthy();
    expect(editor()).toBeTruthy();
    expect((within(day('mon')).getByLabelText('Closes') as HTMLInputElement).value).toBe('9:00 pm');
    // Keep editing after the failure, then "Save again": the newer edit is what is sent.
    type(within(day('mon')).getByLabelText('Closes'), '8:00 pm');
    api.set('PUT /v1/restaurant/hours', async (req) => {
      const body = await req.json();
      hours.puts.push(body);
      hours.hours = { timezone: TZ, intervals: body.intervals, overrides: body.overrides };
      return { body: hours.hours };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save again' }));
    expect(await screen.findByText('Hours saved')).toBeTruthy();
    expect(hours.puts.at(-1).intervals.find((i: any) => i.day_of_week === 1)).toMatchObject({ opens_at: '11:00', closes_at: '20:00' });
  });

  it('closes you now (HoursClosesNow): asks in the save bar, "Keep editing" first; with a conflict too it still saves, once, and "Save and go to" still goes', async () => {
    clockAt(MONDAY_930PM);
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('mon')).getByLabelText('Closes'), '9:00 pm');
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    const ask = screen.getByRole('alertdialog', { name: 'Save and close now?' });
    expect(within(ask).getByText('It’s Monday 9:30 pm and your new hours end at 9:00 pm today. Saving closes you now. Orders in progress still complete.')).toBeTruthy();
    expect(within(ask).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep editing', 'Save and close now']);
    expect(document.activeElement).toBe(within(ask).getByRole('heading', { name: 'Save and close now?' }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(hours.puts).toHaveLength(0);

    // The hours change elsewhere meanwhile: confirm closing, meet the conflict, save anyway.
    hours.hours = { ...hours.hours, intervals: hours.hours.intervals.map((i: any) => (i.day_of_week === 2 ? { ...i, closes_at: '23:00' } : i)) };
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Save and close now?' })).getByRole('button', { name: 'Save and close now' }));
    const banner = await screen.findByTestId('hours-conflict');
    expect(hours.puts).toHaveLength(0);
    fireEvent.click(within(banner).getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Hours saved')).toBeTruthy();
    expect(hours.puts).toHaveLength(1);
    expect(hours.puts[0].intervals.find((i: any) => i.day_of_week === 1)).toMatchObject({ closes_at: '21:00' });

    // Leaving with unsaved changes: "Save and go to Live orders" asks about closing, then goes.
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('mon')).getByLabelText('Closes'), '8:00 pm');
    fireEvent.click(screen.getAllByRole('link', { name: /^Live orders/ })[0]!);
    const leave = screen.getByRole('alertdialog', { name: 'Leave without saving?' });
    fireEvent.click(within(leave).getByRole('button', { name: 'Save and go to Live orders' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Save and close now?' })).getByRole('button', { name: 'Save and close now' }));
    await waitFor(() => expect(hours.puts).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId('hours-page')).toBeNull());
  });

  it('limits: at 3 ranges a day Add is disabled with a spoken reason, up to 21 in all', async () => {
    const hours = fixture('restaurant_hours_standard');
    hours.intervals = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      { day_of_week: d, opens_at: '06:00', closes_at: '08:00', crosses_midnight: false },
      { day_of_week: d, opens_at: '11:00', closes_at: '14:00', crosses_midnight: false },
      ...(d === 0 ? [] : [{ day_of_week: d, opens_at: '17:00', closes_at: '21:00', crosses_midnight: false }]),
    ]);
    setup({ hours });
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    expect(screen.getByText(/20 of 21 time ranges used\./)).toBeTruthy();
    const friAdd = within(day('fri')).getByRole('button', { name: 'Add hours on Friday. Not available: up to 3 time ranges a day.' });
    expect(friAdd.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(day('sun')).getByRole('button', { name: 'Add hours on Sunday' }));
    expect(screen.getByText(/21 of 21 time ranges used\./)).toBeTruthy();
    // 21 of 21 is every day at 3 (7 × 3), so each Add gives the per-day reason.
    for (const id of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(within(day(id)).getByRole('button', { name: /Not available: up to 3 time ranges a day\.$/ }).getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('closing a day removes its ranges with Undo', async () => {
    setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    fireEvent.click(within(day('sat')).getByRole('switch', { name: 'Saturday' }));
    expect(within(day('sat')).getByText('Closed all day. 1 time range removed (11:00 am – 1:00 am).')).toBeTruthy();
    fireEvent.click(within(day('sat')).getByRole('button', { name: 'Undo closing Saturday' }));
    expect((within(day('sat')).getByLabelText('Opens') as HTMLInputElement).value).toBe('11:00 am');
    expect(screen.getByText('No changes yet')).toBeTruthy();
  });
});

describe('Hours: save bar confirmation', () => {
  it('takes focus when it opens, not again when the page re-renders with a new confirm object', () => {
    const confirm = (): ActionBarConfirm => ({
      title: 'Leave without saving?',
      body: 'Body',
      onCancel: () => {},
      actions: (
        <Button variant="tertiary" size="md" onPress={() => {}}>
          Keep editing
        </Button>
      ),
    });
    const bar = (c: ActionBarConfirm | null) => <ActionBar title="No changes yet" actions={null} confirm={c} />;
    const { rerender } = render(bar(null));
    rerender(bar(confirm()));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Leave without saving?' }));
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    keep.focus();
    // A poll or a toast re-renders the page, which builds a fresh confirm object.
    rerender(bar(confirm()));
    expect(document.activeElement).toBe(keep);
  });
});

describe('Hours: special dates', () => {
  it('add opens the panel in place of the list; a closed date saves straight away with the weekly hours as loaded, not the unsaved edits', async () => {
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours' }));
    type(within(day('mon')).getByLabelText('Closes'), '9:00 pm');
    fireEvent.click(screen.getByRole('button', { name: 'Add a special date' }));
    const panel = await screen.findByRole('complementary', { name: 'Special date' });
    expect(screen.queryByRole('region', { name: 'Special dates' })).toBeNull();
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Add a special date' }));
    expect(within(panel).getByText('This replaces your weekly hours on that date only. It saves straight away, separately from your weekly hours.')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add date' }));
    expect(await within(panel).findByText('Fix 1 thing to add this date')).toBeTruthy();
    expect(within(panel).getByText('Choose a date.')).toBeTruthy();
    const date = addDays(today(), 30);
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: date } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add date' }));
    await waitFor(() => expect(hours.puts).toHaveLength(1));
    const sent = hours.puts[0];
    expect(sent.overrides).toContainEqual({ date, is_closed: true, opens_at: null, closes_at: null, reason: null });
    expect(sent.overrides).toHaveLength(3);
    // Monday as loaded (10:00 pm), not the unsaved 9:00 pm.
    expect(sent.intervals.find((i: any) => i.day_of_week === 1)).toMatchObject({ opens_at: '11:00', closes_at: '22:00' });
    // Back to the list; the weekly edit is still unsaved.
    expect(await screen.findByRole('region', { name: 'Special dates' })).toBeTruthy();
    expect(screen.getByText('Unsaved changes · 1 day changed')).toBeTruthy();
  });

  it('special hours need both times, refuse a duplicate and a date more than a year ahead, and note past midnight', async () => {
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Add a special date' }));
    const panel = await screen.findByRole('complementary', { name: 'Special date' });
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: '2026-12-25' } });
    fireEvent.click(within(panel).getByRole('radio', { name: /Special hours/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save date' }));
    expect(await within(panel).findByText('Fix 3 things to add this date')).toBeTruthy();
    expect(within(panel).getByText('You already have a special date on Friday 25 December 2026. Edit that one instead.')).toBeTruthy();
    expect(within(panel).getByText('Enter an opening time.')).toBeTruthy();
    expect(within(panel).getByText('Enter a closing time.')).toBeTruthy();
    const far = addDays(today(), 400);
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: far } });
    type(within(panel).getByLabelText(/^Opens/), '6:00 pm');
    type(within(panel).getByLabelText(/^Closes/), '1:00 am');
    expect(within(panel).getByText(new RegExp(`^Past midnight: closes at 1:00 am on `))).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Save date' }));
    expect(await within(panel).findByText(/^This date is more than a year ahead\. Choose a date up to \d{1,2} \w+ \d{4}\.$/)).toBeTruthy();
    expect(hours.puts).toHaveLength(0);
  });

  it('remove is confirmed in its panel ("Keep it" first) and saves at once', async () => {
    const { hours } = setup();
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Edit special date Friday 25 December 2026' }));
    const panel = await screen.findByRole('complementary', { name: 'Special date' });
    expect(within(panel).getByRole('heading', { name: 'Edit special date' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove date' }));
    const ask = within(panel).getByRole('alertdialog', { name: 'Remove Late opening on 25 December, Friday 25 December 2026?' });
    expect(within(ask).getByText(/Your weekly hours apply on that date instead: 11:00 am – 1:00 am\./)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Keep it' })));
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove now' }));
    expect(await screen.findByText('Special date removed')).toBeTruthy();
    expect(hours.puts[0].overrides.map((o: any) => o.date)).toEqual(['2027-03-20']);
    expect(screen.queryByText('Friday 25 December 2026')).toBeNull();
  });

  it('reads the hours again before saving a date, so changes made elsewhere since the page loaded survive (add and remove)', async () => {
    const { hours } = setup();
    await openHours();
    // Another device changes Tuesday and adds a special date after this page loaded.
    const elsewhere = { date: addDays(today(), 40), is_closed: true, opens_at: null, closes_at: null, reason: 'Added elsewhere' };
    hours.hours = {
      ...hours.hours,
      intervals: hours.hours.intervals.map((i: any) => (i.day_of_week === 2 ? { ...i, closes_at: '23:00' } : i)),
      overrides: [...hours.hours.overrides, elsewhere],
    };
    fireEvent.click(screen.getByRole('button', { name: 'Add a special date' }));
    let panel = await screen.findByRole('complementary', { name: 'Special date' });
    const date = addDays(today(), 30);
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: date } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(hours.puts).toHaveLength(1));
    expect(hours.puts[0].overrides.map((o: any) => o.date).sort()).toEqual(['2026-12-25', '2027-03-20', date, elsewhere.date].sort());
    expect(hours.puts[0].intervals.find((i: any) => i.day_of_week === 2)).toMatchObject({ closes_at: '23:00' });

    // Again before a remove: a date added elsewhere in between is kept.
    const another = { date: addDays(today(), 60), is_closed: true, opens_at: null, closes_at: null, reason: null };
    hours.hours = { ...hours.hours, overrides: [...hours.hours.overrides, another] };
    fireEvent.click(await screen.findByRole('button', { name: 'Edit special date Friday 25 December 2026' }));
    panel = await screen.findByRole('complementary', { name: 'Special date' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove date' }));
    fireEvent.click(within(within(panel).getByRole('alertdialog')).getByRole('button', { name: 'Remove now' }));
    await waitFor(() => expect(hours.puts).toHaveLength(2));
    expect(hours.puts[1].overrides.map((o: any) => o.date).sort()).toEqual(['2027-03-20', date, elsewhere.date, another.date].sort());
  });

  it('refuses a 91st special date even when Add is reached by its address (?date=new)', async () => {
    const hours = fixture('restaurant_hours_standard');
    hours.overrides = Array.from({ length: 90 }, (_, i) => ({ date: addDays(today(), i + 1), is_closed: true, opens_at: null, closes_at: null, reason: null }));
    const { hours: store } = setup({ hours });
    await renderRedesign('/hours?date=new');
    const panel = await screen.findByRole('complementary', { name: 'Special date' });
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: addDays(today(), 200) } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save date' }));
    expect(await within(panel).findByText('You have 90 special dates, the most allowed. Remove one to add another.')).toBeTruthy();
    expect(store.puts).toHaveLength(0);
  });

  it('a server refusal is reported only in the panel', async () => {
    setup({
      overrides: {
        'PUT /v1/restaurant/hours': {
          status: 422,
          body: { error: { code: 'VALIDATION_FAILED', message: 'x', request_id: 'r', details: [{ field: 'overrides[0].date', code: 'invalid', message: 'bad' }] } },
        },
      },
    });
    await openHours();
    fireEvent.click(screen.getByRole('button', { name: 'Add a special date' }));
    const panel = await screen.findByRole('complementary', { name: 'Special date' });
    fireEvent.change(panel.querySelector('#sd-date')!, { target: { value: addDays(today(), 2) } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save date' }));
    expect(await within(panel).findByText('HalalGoes couldn’t save this date. Fix 1 thing.')).toBeTruthy();
    expect(screen.queryByTestId('hours-error-summary')).toBeNull();
  });
});

describe('Hours: who can change them', () => {
  it('suspended: the banner says hours are still editable; the switch is locked', async () => {
    const profile = { ...fixture('restaurant_profile'), account_state: 'SUSPENDED' };
    setup({
      availability: openAvailability({ open_state: 'CLOSED_SUSPENDED', is_accepting_orders: false, reason: 'This restaurant is temporarily unavailable.', resolvable_by: 'ADMIN' }),
      overrides: { 'GET /v1/restaurant/profile': { body: profile } },
    });
    await openHours();
    expect(await screen.findByText('Your account is suspended. You can still update your hours.')).toBeTruthy();
    expect(screen.getByTestId('right-now-badge').textContent).toBe('Suspended');
    expect(screen.getByText('Only HalalGoes support can change this. Orders already in progress still complete.')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'New orders' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Edit hours' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a special date' })).toBeTruthy();
  });

  it('deactivated, or a staff login: read-only (no Edit hours, Add date or Edit)', async () => {
    const profile = { ...fixture('restaurant_profile'), account_state: 'DEACTIVATED' };
    setup({ overrides: { 'GET /v1/restaurant/profile': { body: profile } } });
    await openHours();
    await screen.findByTestId('deactivated-banner');
    expect(screen.queryByRole('button', { name: 'Edit hours' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a special date' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit special date/ })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    const staff = { ...restaurantPrincipal(), roles: [{ role: 'RESTAURANT_STAFF', scope_type: 'RESTAURANT', scope_id: fixture('restaurant_profile').id }] };
    setup({ overrides: { 'GET /v1/auth/me': { body: staff } } });
    await openHours();
    expect(screen.queryByRole('button', { name: 'Edit hours' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a special date' })).toBeNull();
  });
});
