/**
 * W7b: DocumentViewer, LiveMap, AddressCombobox and MapPinPicker — the contract, table-driven
 * (plan/design-system.md §5.1), then the behaviour each one's promise rests on:
 *
 * - DocumentViewer: a 403 from storage, or a link that runs out before the page loaded, is the
 *   expired state with "Get a new link" (never the failure treatment); a page already shown stays
 *   while the subtitle says the link expired; "Get a new link" calls `onRefresh` and is busy
 *   until its promise settles.
 * - AddressCombobox: one `suggest` call per pause in typing, the result count in a polite live
 *   region, and the manual-entry way out.
 * - MapPinPicker: arrow keys move the pin by metres and call back; reverse geocoding waits for
 *   the keys to pause.
 * - LiveMap: without a token, or when the engine fails, the same places and riders are listed
 *   in words.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddressCombobox, DocumentViewer, LiveMap, MapPinPicker, type MapboxModule } from '../index';

const NOW = Date.parse('2026-10-10T22:52:48Z');
const IN_TWO_MINUTES = new Date(NOW + 120_000).toISOString();
const never = () => new Promise<MapboxModule>(() => undefined);
const failing = () => Promise.reject(new Error('webgl unavailable'));
const PIN = { latitude: 43.7309, longitude: -79.2641 };
const noop = () => undefined;

const places = [{ id: 'r', kind: 'restaurant' as const, label: 'Zaytoun Grill', latitude: 43.73, longitude: -79.26 }];
const riders = [
  {
    id: 'rider',
    label: 'Ahmed K.',
    description: 'bicycle',
    fix: { latitude: 43.731, longitude: -79.262, headingDeg: null, accuracyM: null, recordedAt: new Date(NOW - 8_000).toISOString(), coarse: false },
  },
];

let createObjectURL: typeof URL.createObjectURL | undefined;
beforeEach(() => {
  createObjectURL = URL.createObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:document');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (createObjectURL) URL.createObjectURL = createObjectURL;
});

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  role: string;
  name: string | RegExp;
  check?: (el: HTMLElement) => void;
}

const target44 = (el: HTMLElement) => expect(el.className).toMatch(/min-h-11|after:min-h-11|size-11/);

const REGISTRY: Row[] = [
  {
    component: 'DocumentViewer',
    state: 'loading (link being minted)',
    element: () => <DocumentViewer title="Halal certificate scan" src={null} loading />,
    role: 'region',
    name: 'Halal certificate scan',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  {
    component: 'DocumentViewer',
    state: 'ready image (controlled)',
    element: () => <DocumentViewer title="Halal certificate scan" url="https://files.test/cert.png" kind="image" status="ready" />,
    role: 'img',
    name: 'Halal certificate scan',
  },
  {
    component: 'DocumentViewer',
    state: 'zoom control (44px hit area)',
    element: () => <DocumentViewer title="Scan" url="https://files.test/cert.png" kind="image" status="ready" />,
    role: 'button',
    name: 'Zoom in',
    check: target44,
  },
  {
    component: 'DocumentViewer',
    state: 'pdf with the new-tab fallback',
    element: () => <DocumentViewer title="Certificate PDF" src={{ url: 'https://files.test/c.pdf', kind: 'pdf', expiresAt: IN_TWO_MINUTES }} />,
    role: 'link',
    name: 'Open the PDF in a new tab',
    check: (el) => {
      expect(el).toHaveAttribute('target', '_blank');
      expect(el).toHaveAttribute('rel', 'noopener noreferrer');
    },
  },
  {
    component: 'DocumentViewer',
    state: 'expired',
    element: () => <DocumentViewer title="Scan" url="https://files.test/c.png" kind="image" status="expired" onRefresh={noop} />,
    role: 'button',
    name: 'Get a new link',
    check: target44,
  },
  {
    component: 'DocumentViewer',
    state: 'failed',
    element: () => <DocumentViewer title="Scan" url="https://files.test/c.png" kind="image" status="failed" onRetry={noop} />,
    role: 'alert',
    name: '',
    check: (el) => expect(el).toHaveTextContent('The document didn’t load'),
  },
  {
    component: 'DocumentViewer',
    state: 'no access',
    element: () => <DocumentViewer title="Scan" forbidden />,
    role: 'heading',
    name: 'You can’t open this document',
  },
  {
    component: 'DocumentViewer',
    state: 'no document',
    element: () => <DocumentViewer title="Scan" src={null} />,
    role: 'heading',
    name: 'No document attached',
  },
  {
    component: 'LiveMap',
    state: 'no token: text equivalent',
    element: () => <LiveMap accessToken="" loadMapbox={never} places={places} riders={riders} ariaLabel="Map of order HG-6RN4KP" now={() => NOW} />,
    role: 'heading',
    name: 'Text equivalent',
  },
  {
    component: 'LiveMap',
    state: 'empty',
    element: () => <LiveMap accessToken="pk.test" loadMapbox={never} places={[]} riders={[]} ariaLabel="Map" />,
    role: 'heading',
    name: 'Nothing to show on the map yet',
  },
  {
    component: 'LiveMap',
    state: 'loading',
    element: () => <LiveMap accessToken="pk.test" loadMapbox={never} places={places} riders={[]} ariaLabel="Map of order HG-6RN4KP" />,
    role: 'region',
    name: 'Map of order HG-6RN4KP',
  },
  {
    component: 'AddressCombobox',
    state: 'idle',
    element: () => <AddressCombobox suggest={async () => []} resolve={async () => null} onResolve={noop} />,
    role: 'combobox',
    name: 'Search your address',
    check: (el) => expect(el).toHaveAttribute('aria-expanded', 'false'),
  },
  {
    component: 'AddressCombobox',
    state: 'disabled',
    element: () => <AddressCombobox suggest={async () => []} resolve={async () => null} onResolve={noop} disabled />,
    role: 'combobox',
    name: 'Search your address',
    check: (el) => expect(el).toHaveAttribute('aria-disabled', 'true'),
  },
  {
    component: 'AddressCombobox',
    state: 'manual entry link',
    element: () => <AddressCombobox suggest={async () => []} resolve={async () => null} onResolve={noop} onManualEntry={noop} />,
    role: 'button',
    name: 'Enter the address manually',
    check: target44,
  },
  {
    component: 'MapPinPicker',
    state: 'pin placed, no map token (44px pin)',
    element: () => <MapPinPicker accessToken={undefined} loadMapbox={never} value={PIN} onChange={noop} />,
    role: 'button',
    name: 'Pin for riders at 43.7309, -79.2641. Drag it, or use the arrow keys to move it.',
    check: target44,
  },
  {
    component: 'MapPinPicker',
    state: 'disabled',
    element: () => <MapPinPicker accessToken={undefined} loadMapbox={never} value={PIN} onChange={noop} disabled />,
    role: 'button',
    name: /Pin for riders/,
    check: (el) => expect(el).toHaveAttribute('aria-disabled', 'true'),
  },
];

describe('W7b contract registry', () => {
  it.each(REGISTRY.map((row) => [`${row.component}: ${row.state}`, row] as const))('%s', (_label, row) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(row.element());
    const el = row.name === '' ? screen.getByRole(row.role) : screen.getByRole(row.role, { name: row.name });
    expect(el).toBeInTheDocument();
    row.check?.(el);
  });
});

describe('DocumentViewer: the expired link is the expected path', () => {
  it('a 403 from storage is the expired state, and Get a new link calls onRefresh, busy until it settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    let settle: () => void = noop;
    const onRefresh = vi.fn(() => new Promise<void>((done) => (settle = done)));
    render(<DocumentViewer title="Scan" src={{ url: 'https://files.test/c.png', kind: 'image', expiresAt: IN_TWO_MINUTES }} onRefresh={onRefresh} />);
    const renew = await screen.findByRole('button', { name: 'Get a new link' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Each new link is recorded in the audit log.')).toBeInTheDocument();
    fireEvent.click(renew);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(renew).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(renew);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    expect(renew).not.toHaveAttribute('aria-busy');
  });

  it('a link that runs out before the page loaded shows the expired state and fires onExpire once', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const onExpire = vi.fn();
    render(
      <DocumentViewer
        title="Scan"
        src={{ url: 'https://files.test/c.png', kind: 'image', expiresAt: new Date(Date.now() - 1000).toISOString() }}
        onRefresh={noop}
        onExpire={onExpire}
      />,
    );
    expect(screen.getByTestId('DocumentViewer')).toHaveAttribute('data-state', 'expired');
    expect(screen.getByRole('heading', { name: 'This link expired' })).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a page already shown stays when the link expires; the subtitle says so; blankOnExpire blanks it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png']), { status: 200 })));
    const src = { url: 'https://files.test/c.png', kind: 'image' as const, expiresAt: IN_TWO_MINUTES };
    const { rerender } = render(<DocumentViewer title="Scan" src={src} onRefresh={noop} />);
    await act(async () => undefined);
    expect(screen.getByRole('img', { name: 'Scan' })).toHaveAttribute('src', 'blob:document');
    expect(screen.getByTestId('DocumentViewer-meta')).toHaveTextContent(/^Private link valid until \d{1,2}:\d{2} [ap]m · viewing is audited$/);
    await act(async () => vi.advanceTimersByTime(120_001));
    expect(screen.getByRole('img', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.getByTestId('DocumentViewer-meta')).toHaveTextContent(/^Private link expired at \d{1,2}:\d{2} [ap]m$/);
    expect(screen.getByRole('button', { name: 'Get a new link' })).toBeInTheDocument();
    rerender(<DocumentViewer title="Scan" src={src} onRefresh={noop} blankOnExpire />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document');
  });

  it('zoom stops at 400% with the reason in the name, and the keys work only inside the page', () => {
    render(<DocumentViewer title="Scan" url="https://files.test/c.png" kind="image" status="ready" />);
    const page = screen.getByRole('region', { name: /Scan, 100 percent/ });
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(page, { key: '+' });
    expect(screen.getByRole('button', { name: 'Zoom in, unavailable: 400% is the largest size' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(page, { key: '0' });
    expect(screen.getByRole('region', { name: /Scan, 100 percent/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '+' });
    expect(screen.getByRole('region', { name: /Scan, 100 percent/ })).toBeInTheDocument();
  });
});

describe('AddressCombobox', () => {
  it('debounces the search, announces the count politely and resolves the pick', async () => {
    vi.useFakeTimers();
    const suggest = vi.fn(async () => [
      { place_id: 'a', title: '2872 Eglinton Ave E', subtitle: 'Toronto, ON M1J 2E1' },
      { place_id: 'b', title: '2872 Eglinton Ave W', subtitle: 'Toronto, ON M6M 1V1' },
      { place_id: 'c', title: '2872 Eglinton Ave E, Unit 4', subtitle: 'Toronto, ON M1J 2E1' },
    ]);
    const resolve = vi.fn(async () => ({ line1: '2872 Eglinton Ave E', ...PIN }));
    const onResolve = vi.fn();
    render(<AddressCombobox suggest={suggest} resolve={resolve} onResolve={onResolve} />);
    const input = screen.getByRole('combobox', { name: 'Search your address' });
    for (const text of ['287', '2872 E', '2872 Eglint']) {
      fireEvent.change(input, { target: { value: text } });
      act(() => vi.advanceTimersByTime(100));
    }
    expect(suggest).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(150));
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith('2872 Eglint', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const announcer = screen.getByTestId('AddressCombobox-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('3 addresses found. Use the arrow keys to choose one.');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(screen.getByRole('listbox')).getByText('2872 Eglinton Ave W'));
    await act(async () => undefined);
    expect(resolve).toHaveBeenCalledWith('b', expect.anything());
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ line1: '2872 Eglinton Ave E' }), expect.objectContaining({ place_id: 'b' }));
  });

  it('no match is announced, never an error, and the manual entry stays', async () => {
    vi.useFakeTimers();
    const onManualEntry = vi.fn();
    render(<AddressCombobox suggest={async () => []} resolve={async () => null} onResolve={noop} onManualEntry={onManualEntry} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2872 Eglington Avenue' } });
    await act(async () => vi.advanceTimersByTime(250));
    expect(screen.getByTestId('AddressCombobox-announcer')).toHaveTextContent(/^No match for that address/);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enter the address manually' }));
    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });
});

describe('MapPinPicker', () => {
  it('arrow keys move the pin by metres and call back; reverse geocoding waits for a pause', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const reverseGeocode = vi.fn();
    const { rerender } = render(
      <MapPinPicker accessToken="" loadMapbox={never} value={PIN} onChange={onChange} reverseGeocode={reverseGeocode} origin={PIN} />,
    );
    const pin = screen.getByRole('button', { name: /Pin for riders/ });
    fireEvent.keyDown(pin, { key: 'ArrowUp' });
    const north = onChange.mock.calls[0]![0] as typeof PIN;
    expect(onChange.mock.calls[0]![1]).toBe('keyboard');
    expect((north.latitude - PIN.latitude) * 111_320).toBeCloseTo(1, 1);
    expect(north.longitude).toBe(PIN.longitude);
    fireEvent.keyDown(pin, { key: 'ArrowRight', shiftKey: true });
    const east = onChange.mock.calls[1]![0] as typeof PIN;
    expect(east.longitude).toBeGreaterThan(PIN.longitude);
    act(() => vi.advanceTimersByTime(599));
    expect(reverseGeocode).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(reverseGeocode).toHaveBeenCalledWith(east);
    rerender(<MapPinPicker accessToken="" loadMapbox={never} value={east} onChange={onChange} reverseGeocode={reverseGeocode} origin={PIN} />);
    expect(screen.getByTestId('MapPinPicker-status')).toHaveTextContent('You moved the pin 10 m. Save to keep it.');
  });

  it('a disabled pin does not move', () => {
    const onChange = vi.fn();
    render(<MapPinPicker accessToken="" loadMapbox={never} value={PIN} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Pin for riders/ }), { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('LiveMap: the text equivalent is the fallback', () => {
  it('without a token, lists every place and rider in words and requests no map', () => {
    const loadMapbox = vi.fn(never);
    render(<LiveMap accessToken={undefined} loadMapbox={loadMapbox} places={places} riders={riders} ariaLabel="Map" now={() => NOW} />);
    expect(loadMapbox).not.toHaveBeenCalled();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toBe('Restaurant. Zaytoun Grill.');
    expect(items[1]).toMatch(/^Rider\. Ahmed K\., bicycle\. Last position \d{1,2}:\d{2}:\d{2} [ap]m, 8 seconds ago\.$/);
  });

  it('when the engine fails: the alert, Try again, and the list with a stale rider marked', async () => {
    const stale = [{ ...riders[0]!, fix: { ...riders[0]!.fix, recordedAt: new Date(NOW - 240_000).toISOString() } }];
    render(<LiveMap accessToken="pk.test" loadMapbox={failing} places={places} riders={stale} ariaLabel="Map" now={() => NOW} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The map didn’t load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const rider = screen.getAllByRole('listitem')[1]!;
    expect(rider).toHaveTextContent('4 minutes ago. This may not be where the rider is now.');
    expect(within(rider).getByText('Stale')).toBeInTheDocument();
  });
});
