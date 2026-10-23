import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

import { fixture, mockApi, renderRedesign, resetSession } from '../../testing';
import { apiBanner, smsBanner } from '../banners';
import SystemRoute from '../SystemRoute';
import { checkNow, checkSmsSender, getStatus, parseReadiness, resetStatus, viewOf, type Reading } from '../status';

// The suites run beside other packages' tests before a push; a cold first render can be slow.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => resetStatus());
afterEach(() => {
  cleanup();
  resetSession();
  resetStatus();
});

const READY = { data: { ready: true, dependencies: ['postgres', 'redis', 'minio', 'stripe'].map((name) => ({ name, ready: true, detail: null })) } };
const HEALTH = { data: { status: 'ok', version: '0.18.3', started_at: '2026-09-27T22:10:00.000Z' } };
const ENVELOPE_503 = { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Service not ready.', request_id: '01JTESTREQUEST0000000000000' } } };

async function open(role: 'ADMIN' | 'SUPPORT_AGENT' = 'ADMIN') {
  await act(async () => {
    await checkNow();
    await checkSmsSender();
  });
  return renderRedesign(<Route path="/system" element={<SystemRoute />} />, { route: '/system', principal: role });
}

describe('System status: what the two probes say', () => {
  it('is ready when every dependency is, and shows the version and the table to an admin', async () => {
    mockApi({ getReadiness: READY, getHealth: HEALTH });
    await open();
    expect(screen.getByText('The API is ready to serve requests')).toBeTruthy();
    expect(screen.getByText('0.18.3')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'What the API needs to work' });
    expect(within(table).getAllByText('Ready')).toHaveLength(4);
  });

  it('names the failing part when the 503 carries the readiness body, and keeps the server’s words for admins only', async () => {
    mockApi({ getReadiness: 'readiness_not_ready_503', getHealth: HEALTH });
    await open('ADMIN');
    expect(screen.getByText('The API is not ready')).toBeTruthy();
    expect(screen.getByText(/The server says Redis is not ready/)).toBeTruthy();
    expect(screen.getByText(/connection refused/)).toBeTruthy();
    cleanup();
    renderRedesign(<Route path="/system" element={<SystemRoute />} />, { route: '/system', principal: 'SUPPORT_AGENT' });
    expect(screen.getByText('What customers may notice')).toBeTruthy();
    expect(screen.queryByText(/connection refused/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says "Not reported" for every row, not "Ready", when the 503 is only an error envelope', async () => {
    mockApi({ getReadiness: ENVELOPE_503, getHealth: HEALTH });
    await open();
    expect(screen.getByText(/The server didn't say which part failed/)).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Not reported')).toHaveLength(4);
    expect(within(table).queryByText('Ready')).toBeNull();
  });

  it('treats a report that says ready but lists a dependency down as not adding up, and never claims sign-outs', async () => {
    const report = { data: { ready: true, dependencies: [{ name: 'postgres', ready: true, detail: null }, { name: 'redis', ready: false, detail: null }] } };
    mockApi({ getReadiness: report, getHealth: HEALTH });
    await open();
    expect(screen.getByText("The readiness report doesn't add up")).toBeTruthy();
    expect(screen.queryByText(/signed out/)).toBeNull();
  });

  it('does not call an empty report ready', async () => {
    mockApi({ getReadiness: { data: { ready: true, dependencies: [] } }, getHealth: HEALTH });
    await open();
    expect(screen.getByText('The API answered but listed no dependencies')).toBeTruthy();
    expect(screen.queryByText('The API is ready to serve requests')).toBeNull();
  });

  it('says the version is unknown when only the liveness probe failed, and when neither answered says that', async () => {
    mockApi({ getReadiness: READY, getHealth: { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: '01JTESTREQUEST0000000000000' } } } });
    await open();
    expect(screen.getByText(/API version unknown\./)).toBeTruthy();
    cleanup();
    resetStatus();
    mockApi({ getReadiness: { status: 500 }, getHealth: { status: 500 } });
    await open();
    expect(screen.getByText("The API didn't answer either check")).toBeTruthy();
  });

  it('shows a first check as loading, and a re-check keeps the earlier answer until the new one arrives', async () => {
    mockApi({ getReadiness: { pending: true }, getHealth: { pending: true } });
    renderRedesign(<Route path="/system" element={<SystemRoute />} />, { route: '/system', principal: 'ADMIN' });
    expect(screen.getByText('Checking the API')).toBeTruthy();
    expect(screen.queryByText('The API is ready to serve requests')).toBeNull();
  });

  it('announces a recovery once, and the banner clears', async () => {
    const api = mockApi({ getReadiness: 'readiness_not_ready_503', getHealth: HEALTH });
    await open();
    expect(apiBanner(getStatus())?.title).toBe('The API is not ready.');
    expect(getStatus().announcement).toMatch(/^API not ready, /);
    api.set({ getReadiness: READY });
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
    await waitFor(() => expect(getStatus().recovered).not.toBeNull());
    expect(apiBanner(getStatus())).toBeNull();
    expect(getStatus().announcement).toMatch(/^All dependencies ready again, /);
    expect(await screen.findByText(/Ready again since .* It was not ready from /)).toBeTruthy();
  });
});

describe('System status: the text-message sender', () => {
  it('shows the failed check to every role, with the server’s words, and raises the sticky banner', async () => {
    mockApi({ getReadiness: READY, getHealth: HEALTH, getSmsSenderStatus: 'sms_sender_failed' });
    await open('SUPPORT_AGENT');
    expect(screen.getByText('SMS sender: sign-in codes by text may not arrive')).toBeTruthy();
    expect(screen.getByText(/Twilio refused our credentials/)).toBeTruthy();
    expect(smsBanner(getStatus())?.onDismiss).toBeUndefined();
  });

  it('says nothing when the check passed, was not run, or cannot be read', async () => {
    for (const reply of ['sms_sender_passed', 'sms_sender_not_checked', { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x', request_id: '01JTESTREQUEST0000000000000' } } }] as const) {
      resetStatus();
      mockApi({ getReadiness: READY, getHealth: HEALTH, getSmsSenderStatus: reply });
      await act(async () => {
        await checkSmsSender();
      });
      expect(smsBanner(getStatus())).toBeNull();
    }
  });
});

describe('what a reading means', () => {
  const at = new Date('2026-09-28T13:14:05Z');
  const ok = { kind: 'ok', version: '1', startedAt: '2026-09-27T00:00:00Z' } as const;
  const reading = (readiness: Reading['readiness'], health: Reading['health'] = ok): Reading => ({ at, readiness, health });

  it('reads a timeout as unfinished when the liveness probe answered, and as unreachable when nothing did', () => {
    expect(viewOf(reading({ kind: 'timeout' }))).toBe('readiness-timeout');
    expect(viewOf(reading({ kind: 'timeout' }, { kind: 'timeout' }))).toBe('unreachable');
    expect(viewOf(reading({ kind: 'failed' }, { kind: 'failed' }))).toBe('unreachable');
  });

  it('keeps out of the table a dependency name it does not know, rather than guessing', () => {
    const parsed = parseReadiness({ ready: false, dependencies: [{ name: 'kafka', ready: false }, { name: 'redis', ready: false, detail: 'x' }] });
    expect(parsed?.dependencies.map((d) => d.name)).toEqual(['redis']);
    expect(parseReadiness({ error: { message: 'x' } })).toBeNull();
  });

  it('the fixture set has a not-ready body whose failing dependency is named', () => {
    expect(parseReadiness(fixture('readiness_not_ready_503'))?.dependencies.filter((d) => !d.ready).map((d) => d.name)).toEqual(['redis']);
  });
});
