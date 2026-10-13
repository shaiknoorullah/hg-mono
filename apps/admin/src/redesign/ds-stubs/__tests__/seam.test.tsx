/**
 * The ds seam: adapters present the LIVE design-system props over `@hg/ui-web`, and the
 * temporary stubs keep the invariants screens rely on (halal silence, never red, integer
 * cents, focus rules).
 */
import { useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { installDomShims } from '@hg/ui-web/testing';

import {
  Button,
  DetailPanel,
  HalalBadge,
  Input,
  MoneyInput,
  SevenChecks,
  SideNav,
  parseDollarsToCents,
  setClientErrorReporter,
} from '../../ds';

beforeAll(() => {
  installDomShims();
});

afterEach(() => {
  cleanup();
  setClientErrorReporter(null);
});

describe('Button adapter', () => {
  it('calls onPress with the click event', () => {
    const onPress = vi.fn();
    render(
      <Button iconStart="check" onPress={onPress}>
        Approve…
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve…' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0]?.[0]).toHaveProperty('type', 'click');
  });

  it('swallows presses while disabled but stays focusable', () => {
    const onPress = vi.fn();
    render(
      <Button disabled onPress={onPress}>
        Reject…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Reject…' });
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

describe('Input adapter', () => {
  it('reports the event through onChange and the cleaned value through onValueChange', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    function Harness() {
      const [v, setV] = useState('');
      return (
        <Input
          label="Certificate number"
          value={v}
          errorText={null}
          onChange={onChange}
          onValueChange={(next) => {
            onValueChange(next);
            setV(next);
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Certificate number'), { target: { value: 'HMA-ON-2026-0417' } });
    expect(onValueChange).toHaveBeenLastCalledWith('HMA-ON-2026-0417');
    expect(onChange.mock.calls[0]?.[0]).toHaveProperty('target');
  });
});

describe('HalalBadge adapter', () => {
  it('renders nothing for a missing state and reports it', () => {
    const reporter = vi.fn();
    setClientErrorReporter(reporter);
    const { container } = render(
      <div data-testid="host">
        <HalalBadge state={null} restaurantId="r-1" />
        <HalalBadge state={undefined} />
      </div>,
    );
    expect(screen.getByTestId('host').childElementCount).toBe(0);
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(reporter).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', expect.objectContaining({ restaurantId: 'r-1' }));
  });

  it('never draws EXPIRED with a danger class', () => {
    render(<HalalBadge state="EXPIRED" />);
    const seal = screen.getByRole('img', { name: /Halal certification expired/ });
    const classes = [seal, ...Array.from(seal.querySelectorAll('*'))].map((el) => el.getAttribute('class') ?? '').join(' ');
    expect(classes).not.toMatch(/danger/);
    expect(classes).toMatch(/halal-expired/);
  });

  it('draws EXPIRING_SOON as the amber plate with its date, not the green seal', () => {
    render(<HalalBadge state="EXPIRING_SOON" surface="operational" expiresOn="2026-10-14" />);
    const seal = screen.getByRole('img', { name: 'Halal certified. Expires 14 October 2026.' });
    expect(seal.textContent).toBe('Halal certified · expires 14 Oct');
    expect(seal.className).toMatch(/halal-expiring/);
    expect(seal.className).not.toMatch(/halal-certified-seal|danger/);
  });
});

describe('SideNav stub', () => {
  it('marks the current item with aria-current and folds the count into its name', () => {
    render(
      <SideNav
        collapsed={false}
        onCollapsedChange={() => {}}
        groups={[
          {
            key: 'review',
            heading: 'Review',
            items: [
              { key: 'apps', label: 'Restaurant applications', shortLabel: 'Restaurants', href: '/applications', count: 4, countLabel: 'waiting', current: true },
              { key: 'riders', label: 'Rider applications', shortLabel: 'Riders', href: '/riders', count: null },
            ],
          },
        ]}
      />,
    );
    const current = screen.getByRole('link', { name: 'Restaurant applications, 4 waiting' });
    expect(current.getAttribute('aria-current')).toBe('page');
    const other = screen.getByRole('link', { name: 'Rider applications' });
    expect(other.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('DetailPanel stub', () => {
  it('moves focus to its heading on open and returns it to the opener on Close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={opener} type="button" onClick={() => setOpen(true)}>
            Reject…
          </button>
          <DetailPanel open={open} title="Reject this certificate" onClose={() => setOpen(false)} returnFocusRef={opener}>
            <p>Body</p>
          </DetailPanel>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Reject…' });
    opener.focus();
    fireEvent.click(opener);
    const heading = screen.getByRole('heading', { name: 'Reject this certificate' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('region', { name: 'Reject this certificate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Reject this certificate' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ignores Escape while busy', () => {
    const onClose = vi.fn();
    render(
      <DetailPanel title="Approve" onClose={onClose} busy>
        <p>Sending</p>
      </DetailPanel>,
    );
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Approve' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('MoneyInput stub', () => {
  it('turns "12.40" into 1240 integer cents and refuses a fraction of a cent', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput label="Goodwill amount" valueCents={null} onValueChange={onValueChange} />);
    const field = screen.getByLabelText('Goodwill amount');
    fireEvent.change(field, { target: { value: '12.40' } });
    expect(onValueChange).toHaveBeenLastCalledWith(1240);
    expect(Number.isInteger(onValueChange.mock.calls.at(-1)?.[0])).toBe(true);
    fireEvent.change(field, { target: { value: '12.405' } });
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it('parses dollars without floating point', () => {
    expect(parseDollarsToCents('0.29')).toBe(29);
    expect(parseDollarsToCents('$1,250')).toBe(125000);
    expect(parseDollarsToCents('12.4')).toBe(1240);
    expect(parseDollarsToCents('-3')).toBeNull();
    expect(parseDollarsToCents('1e3')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
  });
});

describe('SevenChecks stub', () => {
  it('draws locked rows without any radio and live rows with Pass, Fail and Not assessed', () => {
    const { container } = render(
      <SevenChecks
        value={{ H1_LEGIBLE_COMPLETE: { result: 'PASS' }, H2_ISSUER_ACCEPTED: { result: 'FAIL' } }}
        info={{ H5_DATES_VALID: { computed: 'PASS' }, H7_UNIQUE_NOT_REUSED: { computed: 'FAIL' } }}
        lockedKeys={{ H2_ISSUER_ACCEPTED: { reason: 'HFSAA is Suspended in the registry. Only an Accepted body passes this check.' } }}
        onChange={() => {}}
      />,
    );
    const row = (code: string) => container.querySelector<HTMLElement>(`[data-check="${code}"]`)!;

    for (const code of ['H2', 'H5', 'H7']) {
      expect(within(row(code)).queryAllByRole('radio')).toHaveLength(0);
    }
    expect(within(row('H5')).getByText('Computed by the server · locked')).toBeTruthy();
    expect(within(row('H2')).getByText(/HFSAA is Suspended/)).toBeTruthy();

    const h1 = within(row('H1'));
    expect(h1.getAllByRole('radio')).toHaveLength(3);
    for (const name of ['Pass', 'Fail', 'Not assessed']) expect(h1.getByRole('radio', { name })).toBeTruthy();
    expect(h1.getByRole('radio', { name: 'Pass' }).getAttribute('aria-checked')).toBe('true');
    expect(within(row('H4')).getByText('Not recorded')).toBeTruthy();

    // Never red for Fail: the computed H7 Fail is a slate tint with an icon and text.
    const fail = within(row('H7')).getByText('Fail');
    expect(fail.closest('span')?.className ?? '').not.toMatch(/danger/);
  });
});
