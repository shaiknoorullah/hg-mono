import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';

import profilePending from '../../../contracts/fixtures/onboarding/restaurant_onboarding_profile_pending.json';
import documentsPending from '../../../contracts/fixtures/onboarding/restaurant_onboarding_documents_pending.json';
import documentsReview from '../../../contracts/fixtures/onboarding/restaurant_onboarding_documents_review.json';
import documentsRejected from '../../../contracts/fixtures/onboarding/restaurant_onboarding_documents_rejected.json';
import documentsApproved from '../../../contracts/fixtures/onboarding/restaurant_onboarding_documents_approved.json';
import payoutPending from '../../../contracts/fixtures/onboarding/restaurant_onboarding_payout_pending.json';
import menuPending from '../../../contracts/fixtures/onboarding/restaurant_onboarding_menu_pending.json';
import active from '../../../contracts/fixtures/onboarding/restaurant_onboarding_active.json';
import connectComplete from '../../../contracts/fixtures/platform/connect_status_complete.json';

/**
 * The restaurant's onboarding flow, one screen driven entirely by
 * `GET /v1/restaurant/onboarding/status` → `current_step`: profile → documents → in review /
 * fix documents (with the reviewer's reasons) → Stripe Connect payout account → menu → done.
 *
 * The payout step is money-adjacent: it must create the Connect account, then mint a fresh
 * server-generated onboarding link and send the browser to exactly that URL — the client
 * never builds or supplies a Stripe URL (contract: `createConnectOnboardingLink`).
 */

const STRIPE_URL = 'https://connect.stripe.com/setup/e/acct_1Test/abc123';

interface Call {
  method: string;
  path: string;
  body: string;
  idempotencyKey: string | null;
}

type Reply = Response | (() => Response | Promise<Response>);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, message = code) =>
  json(status, { error: { code, message, request_id: 'req-test' } });
const statusOf = (fixture: { payload: unknown }) => json(200, { data: fixture.payload });

/**
 * Answers `"METHOD /path"` keys; a list is consumed in order (the last reply repeats).
 * Anything unscripted is a test failure, so an unexpected call cannot pass silently.
 */
function scriptFetch(script: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      const call: Call = {
        method: request.method,
        path: new URL(request.url).pathname,
        body: request.method === 'GET' ? '' : await request.clone().text(),
        idempotencyKey: request.headers.get('Idempotency-Key'),
      };
      calls.push(call);
      const queue = queues.get(`${call.method} ${call.path}`);
      if (!queue) throw new Error(`unscripted fetch: ${call.method} ${call.path}`);
      const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
      return typeof reply === 'function' ? reply() : reply.clone();
    }),
  );
  return calls;
}

const where = { pathname: '' };
function LocationProbe() {
  where.pathname = useLocation().pathname;
  return null;
}

/** Replaces `window.location` (jsdom's cannot be spied on) so the Stripe redirect is recorded. */
function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

async function mountAt(path: string) {
  const { OnboardingPage } = await import('../src/routes/onboarding/OnboardingPage');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding/*" element={<OnboardingPage />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const statusCalls = (calls: Call[]) => calls.filter((c) => c.path === '/v1/restaurant/onboarding/status').length;

describe('restaurant onboarding', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('shows a loading state while the status is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    await mountAt('/onboarding');

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByText('Checking onboarding status…')).not.toBeNull();
  });

  it("shows the server's error with a retry that recovers", async () => {
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': [apiError(500, 'INTERNAL_ERROR', 'Onboarding is unavailable.'), statusOf(documentsReview)],
    });

    await mountAt('/onboarding');

    expect(await screen.findByText('Onboarding is unavailable.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Documents in review')).not.toBeNull();
    expect(statusCalls(calls)).toBe(2);
  });

  it('opens the business profile form first', async () => {
    scriptFetch({ 'GET /v1/restaurant/onboarding/status': statusOf(profilePending) });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Business profile')).not.toBeNull();
    expect(container.textContent).toContain('20% complete');
    expect(container.textContent).toContain('Step 1 of 5');
  });

  it('asks for the document pack when documents are pending', async () => {
    scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(documentsPending),
      'GET /v1/restaurant/documents': json(200, { data: [] }),
    });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Compliance documents')).not.toBeNull();
    expect(container.textContent).toContain('Step 2 of 5');
  });

  it('shows "in review" while the pack is locked for review, still counted as the documents step', async () => {
    scriptFetch({ 'GET /v1/restaurant/onboarding/status': statusOf(documentsReview) });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Documents in review')).not.toBeNull();
    expect(container.textContent).toContain('Review cycle 1');
    expect(container.textContent).toContain('Step 2 of 5');
    expect(screen.queryByRole('button', { name: 'Go to documents' })).toBeNull();
  });

  it("lists each rejected document with the reviewer's reason, and reloads to fix them", async () => {
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': [statusOf(documentsRejected), statusOf(documentsPending)],
      'GET /v1/restaurant/documents': json(200, { data: [] }),
    });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Documents need attention')).not.toBeNull();
    expect(container.textContent).toContain('Review cycle 2');
    for (const doc of documentsRejected.payload.rejection.documents) {
      expect(screen.getByText(doc.doc_type)).not.toBeNull();
      expect(screen.getByText(doc.review_note)).not.toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Go to documents' }));
    expect(await screen.findByText('Compliance documents')).not.toBeNull();
    expect(statusCalls(calls)).toBe(2);
  });

  it('payout step: creates the Connect account, then sends the browser to the server-minted link', async () => {
    const assign = stubLocation();
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(documentsApproved),
      'POST /v1/connect/account': json(201, { data: { ...connectComplete.payload, payouts_enabled: false, details_submitted: false } }),
      'POST /v1/connect/onboarding-link': json(201, { data: { url: STRIPE_URL, expires_at: '2026-10-05T12:05:00Z' } }),
    });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Connect payouts')).not.toBeNull();
    expect(container.textContent).toContain('Step 3 of 5');
    // Not back from Stripe: no "check again" prompt.
    expect(screen.queryByText(/Back from Stripe/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
    const connect = calls.filter((c) => c.path.startsWith('/v1/connect/'));
    expect(connect.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/connect/account', 'POST /v1/connect/onboarding-link']);
    // Account creation is a money-class write: it carries an idempotency key.
    expect(connect[0]!.idempotencyKey).toBeTruthy();
    // The client supplies no return/refresh URL — those are server-generated.
    expect(connect[1]!.body).not.toMatch(/url/i);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('payout step: an account that already exists still gets a fresh link', async () => {
    const assign = stubLocation();
    scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(payoutPending),
      'POST /v1/connect/account': apiError(409, 'CONFLICT', 'Connect account already exists.'),
      'POST /v1/connect/onboarding-link': json(201, { data: { url: STRIPE_URL, expires_at: '2026-10-05T12:05:00Z' } }),
    });

    await mountAt('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('payout step: "not approved yet" stops before any link is minted and says why', async () => {
    const assign = stubLocation();
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(payoutPending),
      'POST /v1/connect/account': apiError(409, 'STEP_NOT_AVAILABLE', 'Your restaurant is not approved yet.'),
    });

    await mountAt('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Your restaurant is not approved yet.');
    expect(calls.some((c) => c.path === '/v1/connect/onboarding-link')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('payout step: a failed link shows an error and does not navigate', async () => {
    const assign = stubLocation();
    scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(payoutPending),
      'POST /v1/connect/account': json(201, { data: connectComplete.payload }),
      'POST /v1/connect/onboarding-link': apiError(502, 'UPSTREAM_UNAVAILABLE', 'Stripe is unavailable. Try again shortly.'),
    });

    await mountAt('/onboarding');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Stripe is unavailable. Try again shortly.');
    expect(assign).not.toHaveBeenCalled();
  });

  it('back from Stripe: readiness comes from the status fetch, with a "check again" that refetches', async () => {
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': [statusOf(payoutPending), statusOf(menuPending)],
    });

    await mountAt('/onboarding/return');

    expect(await screen.findByText(/Back from Stripe/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'check again' }));

    // Payouts enabled (webhook-driven) → the menu step.
    expect(await screen.findByText('Publish your menu')).not.toBeNull();
    expect(statusCalls(calls)).toBe(2);
    expect(calls.some((c) => c.path.startsWith('/v1/connect/'))).toBe(false);
  });

  it('expired Stripe link (/onboarding/refresh): mints a new one straight away', async () => {
    const assign = stubLocation();
    const calls = scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(payoutPending),
      'POST /v1/connect/account': apiError(409, 'CONFLICT', 'exists'),
      'POST /v1/connect/onboarding-link': json(201, { data: { url: STRIPE_URL, expires_at: '2026-10-05T12:05:00Z' } }),
    });

    await mountAt('/onboarding/refresh');

    await waitFor(() => expect(assign).toHaveBeenCalledWith(STRIPE_URL));
    expect(calls.filter((c) => c.path === '/v1/connect/onboarding-link')).toHaveLength(1);
  });

  it('expired Stripe link that cannot be re-minted falls back to /onboarding', async () => {
    const assign = stubLocation();
    scriptFetch({
      'GET /v1/restaurant/onboarding/status': statusOf(payoutPending),
      'POST /v1/connect/account': apiError(409, 'STEP_NOT_AVAILABLE', 'Not approved.'),
    });

    await mountAt('/onboarding/refresh');

    await waitFor(() => expect(where.pathname).toBe('/onboarding'));
    expect(assign).not.toHaveBeenCalled();
    expect(await screen.findByText('Connect payouts')).not.toBeNull();
  });

  it('menu step sends the operator to the menu editor', async () => {
    scriptFetch({ 'GET /v1/restaurant/onboarding/status': statusOf(menuPending) });

    const { container } = await mountAt('/onboarding');

    expect(await screen.findByText('Publish your menu')).not.toBeNull();
    expect(container.textContent).toContain('Step 4 of 5');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu editor' }));
    await waitFor(() => expect(where.pathname).toBe('/menu'));
  });

  it('done goes straight to the live order queue', async () => {
    scriptFetch({ 'GET /v1/restaurant/onboarding/status': statusOf(active) });

    await mountAt('/onboarding');

    await waitFor(() => expect(where.pathname).toBe('/orders'));
  });

  it('an unknown step from a newer server says so instead of rendering nothing', async () => {
    scriptFetch({
      'GET /v1/restaurant/onboarding/status': json(200, { data: { ...menuPending.payload, current_step: 'TAX_INFO' } }),
    });

    await mountAt('/onboarding');

    expect(await screen.findByText('Unrecognised onboarding step')).not.toBeNull();
    expect(screen.getByText('TAX_INFO')).not.toBeNull();
  });
});
