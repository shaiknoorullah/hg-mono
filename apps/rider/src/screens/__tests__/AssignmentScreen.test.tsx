/**
 * `AssignmentScreen` at the counter (issue #311): the rider types the kitchen's pickup code, and
 * PICKED_UP goes out as `PickupTransitionInput` carrying `pickup_code`. A wrong code shows the
 * attempts left; five wrong codes (`PICKUP_CODE_LOCKED`) hand the pickup to support, with no code
 * entry left on the screen. Bodies are the contract's own fixtures.
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import arrivedAtPickup from '../../../../../contracts/fixtures/dispatch/assignment_arrived_at_pickup.json';
import pickedUp from '../../../../../contracts/fixtures/dispatch/assignment_picked_up.json';
import pickupIncorrect from '../../../../../contracts/fixtures/errors/error_pickup_code_incorrect.json';
import pickupLocked from '../../../../../contracts/fixtures/errors/error_pickup_code_locked.json';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

// The map, the live position and the camera are device surfaces; this test is about the codes.
jest.mock('../../map/DeliveryMap', () => ({ DeliveryMap: () => null }));
jest.mock('../../location', () => ({ useLiveFix: () => null }));
jest.mock('../../capture', () => ({ captureImage: jest.fn() }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// See OfferScreen.test.tsx: one persistent spy, installed before the screen is required.
const fetchSpy = jest.spyOn(globalThis, 'fetch');

afterAll(() => {
  fetchSpy.mockRestore();
});

const { AssignmentScreen } = require('../AssignmentScreen') as typeof import('../AssignmentScreen');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');
const { NavProvider } = require('../../nav') as typeof import('../../nav');

/** Serves the assignment read, and answers the PICKED_UP transition with `transition`. */
function serve(transition: () => Response): { bodies: unknown[] } {
  const bodies: unknown[] = [];
  fetchSpy.mockImplementation(async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (req.method === 'POST' && req.url.includes('/transitions')) {
      bodies.push(JSON.parse(await req.text()));
      return transition();
    }
    return json(200, { data: arrivedAtPickup.payload });
  });
  return { bodies };
}

function renderScreen() {
  return render(
    <ThemeProvider theme="rider" scheme="light">
      <NavProvider>
        <AssignmentScreen assignmentId={arrivedAtPickup.payload.id} />
      </NavProvider>
    </ThemeProvider>,
  );
}

async function typeAndConfirm(code: string) {
  const input = await screen.findByLabelText('Pickup code');
  fireEvent.changeText(input, code);
  fireEvent.press(screen.getByText('Confirm pickup'));
}

describe('AssignmentScreen — the pickup code', () => {
  it('sends PICKED_UP with the pickup code the rider typed', async () => {
    const { bodies } = serve(() => json(200, { data: pickedUp.payload }));
    renderScreen();

    await typeAndConfirm('4821');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ to_state: 'PICKED_UP', pickup_code: '4821' });
    expect(bodies[0]).not.toHaveProperty('override_reason');
    expect(await screen.findByText('Start heading to drop-off')).toBeTruthy();
  });

  it('shows the attempts left after a wrong code', async () => {
    serve(() => json(pickupIncorrect.status, pickupIncorrect.payload));
    renderScreen();

    await typeAndConfirm('1111');

    expect(await screen.findByText(/3 attempts left/)).toBeTruthy();
  });

  it('hands a locked pickup to support and leaves no code entry', async () => {
    serve(() => json(pickupLocked.status, pickupLocked.payload));
    renderScreen();

    await typeAndConfirm('1111');

    expect(await screen.findByText('HalalGoes support is taking over')).toBeTruthy();
    expect(screen.queryByLabelText('Pickup code')).toBeNull();
    expect(screen.queryByText('Confirm pickup')).toBeNull();
  });
});
