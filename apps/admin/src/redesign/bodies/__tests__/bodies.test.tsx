import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, fixtureMeta, mockApi, renderRedesign, resetSession } from '../../testing';
import BodiesRoute from '../BodiesRoute';
import type { Body } from '../model';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

const EVERY = 'halal_issuing_bodies_every_status';
const list = (rows: Body[]) => ({ data: rows, meta: { next_cursor: null, has_more: false } });

function renderBodies(role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT') {
  return renderRedesign(<Route path="/issuing-bodies" element={<BodiesRoute />} />, { route: '/issuing-bodies', principal: role });
}

describe('Issuing bodies: what each role is shown', () => {
  it('shows a super admin every column and an action on every row, with the proposal first', async () => {
    mockApi({ listHalalIssuingBodies: EVERY });
    renderBodies('SUPER_ADMIN');
    const grid = await screen.findByRole('grid');
    for (const h of ['Issuing body', 'Status', 'Passes Issuer accepted', 'Issuer confirmation', 'Region', 'Action']) expect(within(grid).getByText(h)).toBeTruthy();
    const review = within(grid).getAllByRole('button', { name: 'Review…' });
    expect(review).toHaveLength(1);
    expect(within(grid).getAllByRole('button', { name: 'Change status…' })).toHaveLength(4);
  });

  it('shows an admin the same list with no action, and a support agent name and status only', async () => {
    mockApi({ listHalalIssuingBodies: EVERY });
    const { unmount } = renderBodies('ADMIN');
    const grid = await screen.findByRole('grid');
    expect(within(grid).queryByRole('button', { name: /Review|Change status/ })).toBeNull();
    expect(within(grid).getByText('Passes Issuer accepted')).toBeTruthy();
    unmount();
    cleanup();
    mockApi({ listHalalIssuingBodies: EVERY });
    renderBodies('SUPPORT_AGENT');
    const g2 = await screen.findByRole('grid');
    expect(within(g2).queryByText('Passes Issuer accepted')).toBeNull();
    expect(within(g2).queryByText('Region')).toBeNull();
    expect(within(g2).getByText('Status')).toBeTruthy();
  });

  it('answers Yes to the Issuer accepted check for the Accepted body only', async () => {
    mockApi({ listHalalIssuingBodies: EVERY });
    renderBodies('ADMIN');
    const grid = await screen.findByRole('grid');
    const accepted = (fixture<Body[]>(EVERY)).filter((b) => b.status === 'ACCEPTED').length;
    expect(within(grid).getAllByText('Yes')).toHaveLength(accepted);
  });

  it('draws no status badge for a status it does not know', async () => {
    const odd = { ...fixture<Body[]>(EVERY)[0]!, status: 'UNDER_REVIEW' as never };
    mockApi({ listHalalIssuingBodies: { data: [odd], meta: fixtureMeta(EVERY) } });
    renderBodies('ADMIN');
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('Status not recognised')).toBeTruthy();
    expect(within(grid).getByText('No')).toBeTruthy();
  });
});

describe('Issuing bodies: empty, error and loading', () => {
  it('draws the error with Try again, and the loading skeleton before the answer', async () => {
    mockApi({ listHalalIssuingBodies: { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', request_id: 'req_test' } } } });
    renderBodies('SUPER_ADMIN');
    expect(await screen.findByText('Issuing bodies didn’t load')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('draws the loading state while the server has not answered', async () => {
    mockApi({ listHalalIssuingBodies: { pending: true } });
    renderBodies('SUPER_ADMIN');
    expect(await screen.findByText('Loading issuing bodies')).toBeTruthy();
  });

  it('says no proposed bodies are waiting, with a way back to every status', async () => {
    mockApi({ listHalalIssuingBodies: 'halal_issuing_bodies_empty' });
    renderBodies('SUPER_ADMIN');
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'PROPOSED' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PROPOSED' } });
    expect(await screen.findByText('No proposed bodies are waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show every status' })).toBeTruthy();
  });
});

describe('Issuing bodies: changing a status', () => {
  async function openProposal(extra: Parameters<typeof mockApi>[0] = {}) {
    const api = mockApi({ listHalalIssuingBodies: EVERY, ...extra });
    renderBodies('SUPER_ADMIN');
    fireEvent.click(await screen.findByRole('button', { name: 'Review…' }));
    const panel = await screen.findByRole('region', { name: /Review a proposed issuing body/ });
    return { api, panel };
  }

  it('sends nothing until the justification has 20 characters, then sends it with an idempotency key', async () => {
    const accepted = fixture<Body>('halal_issuing_body_accepted');
    const { api, panel } = await openProposal({ setHalalIssuingBodyStatus: { data: accepted } });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Accept' }));
    fireEvent.change(within(panel).getByLabelText(/Justification/), { target: { value: 'too short' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save decision' }));
    expect(await within(panel).findByText(/more\./)).toBeTruthy();
    expect(api.callsTo('setHalalIssuingBodyStatus')).toHaveLength(0);

    const why = 'Certificate verified with the issuer by phone.';
    fireEvent.change(within(panel).getByLabelText(/Justification/), { target: { value: why } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save decision' }));
    await waitFor(() => expect(api.callsTo('setHalalIssuingBodyStatus')).toHaveLength(1));
    const sent = api.callsTo('setHalalIssuingBodyStatus')[0]!;
    expect(sent.body).toEqual({ status: 'ACCEPTED', justification: why, requires_issuer_confirmation: false });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('says why when the session has no authenticator code, and changes nothing', async () => {
    const { api, panel } = await openProposal({ setHalalIssuingBodyStatus: 'error_refund_mfa_required' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Reject' }));
    fireEvent.change(within(panel).getByLabelText(/Justification/), { target: { value: 'Not an accredited certifier at all.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save decision' }));
    expect(await screen.findByText('Two-step sign-in is needed for this')).toBeTruthy();
    expect(api.callsTo('setHalalIssuingBodyStatus')).toHaveLength(1);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('warns that suspending a body hides restaurants that only it vouched for', async () => {
    mockApi({ listHalalIssuingBodies: EVERY });
    renderBodies('SUPER_ADMIN');
    const buttons = await screen.findAllByRole('button', { name: 'Change status…' });
    fireEvent.click(buttons[0]!);
    const panel = await screen.findByRole('region', { name: /Change status/ });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Suspended' }));
    expect(within(panel).getByText(/loses its halal badge/)).toBeTruthy();
  });
});
