/**
 * Restaurant onboarding, first menu and opening hours (canvas ON `Menu-*`, `Hours-Set`): the hours are saved as
 * the contract's intervals (past midnight marked), a refusal lands on the day it names, and the
 * step moves on only when the server says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const menuRoutes = (extra: Record<string, never | object | string | ((req: Request) => object)> = {}) =>
  consoleRoutes({
    'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_menu_pending',
    'GET /v1/restaurant/documents': 'restaurant_document_pack_complete',
    'GET /v1/restaurant/menu': 'owned_menu_empty',
    'GET /v1/restaurant/hours': 'restaurant_hours_none',
    ...extra,
  });

async function fillSaturday() {
  fireEvent.click(await screen.findByRole('button', { name: 'Set opening hours' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add times for Saturday' }));
  fireEvent.change(screen.getByLabelText('Saturday opens'), { target: { value: '11:00 am' } });
  fireEvent.change(screen.getByLabelText('Saturday closes'), { target: { value: '12:30 am' } });
}

describe('first menu and opening hours', () => {
  it('saves the week as intervals, marking a late close as past midnight, and keeps the special dates', async () => {
    const saved = fixture('restaurant_hours_split_past_midnight');
    const api = installFakeApi(menuRoutes({ 'PUT /v1/restaurant/hours': { body: saved } }));
    await renderRedesign('/onboarding');
    expect(await screen.findByTestId('embedded-menu')).toBeTruthy();
    await fillSaturday();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.callsTo('PUT /v1/restaurant/hours')).toHaveLength(1));
    const body = await api.callsTo('PUT /v1/restaurant/hours')[0]!.json();
    expect(body.intervals).toEqual([{ day_of_week: 6, opens_at: '11:00', closes_at: '00:30', crosses_midnight: true }]);
    expect(body.overrides).toEqual(fixture('restaurant_hours_none').overrides);
    expect(await screen.findByTestId('hours-summary')).toBeTruthy();
  });

  it('puts a refusal on the day it names, keeps the times typed, and says nothing was saved', async () => {
    installFakeApi(
      menuRoutes({
        'PUT /v1/restaurant/hours': { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'x', request_id: 'r', details: [{ field: 'intervals[0].closes_at', code: 'x', message: 'bad' }] } } },
      }),
    );
    await renderRedesign('/onboarding');
    await fillSaturday();
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    const summary = await screen.findByTestId('hours-errors');
    expect(within(summary).getByText('Your hours weren’t saved')).toBeTruthy();
    expect((screen.getByLabelText('Saturday closes') as HTMLInputElement).value).toBe('12:30 am');
  });
});
