/**
 * Restaurant sign-in composites (#737) — the per-component contract, table-driven, then the
 * invariant-bearing behaviour: support renders nothing unless `support_enabled` is true, the
 * WaitLine's id reaches the disabled button and its expiry fires once, and TextLink's targets.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, forwardRef, type AnchorHTMLAttributes, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button, setClientErrorReporter } from '../../ds/index';
import {
  StateCard,
  SupportBlock,
  SupportSentence,
  TextLink,
  WaitLine,
  formatSupportPhone,
  resolveWaitDeadline,
  useWaitLine,
} from '../index';

const NOW = Date.parse('2026-10-10T18:40:00Z');
const DATE_HEADER = new Date(NOW).toUTCString();
const ON = { supportEnabled: true, phoneE164: '+18005550199', hours: 'Every day, 9 am to 9 pm' };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  vi.setSystemTime(NOW);
  setClientErrorReporter(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  setClientErrorReporter(null);
});

/** A stand-in router link: takes `to` and `state`, renders an anchor. */
const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; state?: unknown }>(
  function RouterLink({ to, state, ...rest }, ref) {
    return <a ref={ref} href={to} data-state-json={JSON.stringify(state)} {...rest} />;
  },
);

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  role?: string;
  name?: string | RegExp;
  /** Classes the found element must carry (target sizes, weights). */
  classes?: string[];
  /** Classes it must not carry. */
  notClasses?: string[];
  busy?: boolean;
  /** The component renders nothing on purpose. */
  empty?: boolean;
  check?: (el: HTMLElement) => void;
}

const REGISTRY: Row[] = [
  /* TextLink: inline 600 without a minimum height; standalone 500 with 44px. */
  { component: 'TextLink', state: 'inline', element: () => <TextLink href="/forgot">Reset it by email</TextLink>, role: 'link', name: 'Reset it by email', classes: ['font-semibold', 'text-fg-link', 'hover:text-fg-link-hover', 'hg-focus'], notClasses: ['min-h-11'] },
  { component: 'TextLink', state: 'standalone', element: () => <TextLink href="/sign-in" variant="standalone">Back to sign in</TextLink>, role: 'link', name: 'Back to sign in', classes: ['font-medium', 'min-h-11', 'text-body-md', 'hg-focus'] },
  { component: 'TextLink', state: 'tel', element: () => <TextLink href="tel:+18005550199">1-800-555-0199</TextLink>, role: 'link', name: '1-800-555-0199', check: (el) => expect(el).toHaveAttribute('href', 'tel:+18005550199') },
  { component: 'TextLink', state: 'external', element: () => <TextLink href="https://example.org/terms" external>Partner terms</TextLink>, role: 'link', name: 'Partner terms (opens in a new tab)', check: (el) => { expect(el).toHaveAttribute('target', '_blank'); expect(el).toHaveAttribute('rel', 'noopener noreferrer'); } },
  { component: 'TextLink', state: 'as router link', element: () => <TextLink as={RouterLink} to="/register" state={{ from: 'sign-in' }} variant="standalone">Register your restaurant</TextLink>, role: 'link', name: 'Register your restaurant', classes: ['min-h-11', 'text-fg-link'], check: (el) => { expect(el).toHaveAttribute('href', '/register'); expect(el).toHaveAttribute('data-state-json', '{"from":"sign-in"}'); } },
  { component: 'TextLink', state: 'render', element: () => <TextLink to="/forgot" render={({ to, children }) => <RouterLink to={to}>{children}</RouterLink>}>Reset it by email</TextLink>, role: 'link', name: 'Reset it by email', classes: ['font-semibold', 'hg-focus'], check: (el) => expect(el).toHaveAttribute('data-testid', 'TextLink') },
  { component: 'TextLink', state: 'accessibilityLabel', element: () => <TextLink href="tel:+18005550199" accessibilityLabel="Call partner support">1-800-555-0199</TextLink>, role: 'link', name: 'Call partner support' },

  /* StateCard: h1 by default, the icon tile is decorative, a form card is a named form. */
  { component: 'StateCard', state: 'heading only', element: () => <StateCard heading="Sign in to your restaurant" description="Use the email and password you registered with." />, role: 'heading', name: 'Sign in to your restaurant', check: (el) => expect(el.tagName).toBe('H1') },
  { component: 'StateCard', state: 'icon', element: () => <StateCard icon="lock" heading="This account is locked" />, role: 'heading', name: 'This account is locked', check: () => { const tile = document.querySelector('[data-slot="state-card-icon"]')!; expect(tile).toHaveAttribute('aria-hidden', 'true'); expect(tile.className).toMatch(/size-12/); expect(tile.className).toMatch(/bg-surface-sunken/); expect(tile.className).toMatch(/rounded-md/); } },
  { component: 'StateCard', state: 'headingLevel 2', element: () => <StateCard headingLevel={2} heading="Check your email" />, role: 'heading', name: 'Check your email', check: (el) => expect(el.tagName).toBe('H2') },
  { component: 'StateCard', state: 'form', element: () => <StateCard heading="Reset your password" onSubmit={() => undefined}><Button type="submit">Send link</Button></StateCard>, role: 'form', name: 'Reset your password', classes: ['p-6', '@sm:p-8', 'gap-5'] },
  { component: 'StateCard', state: 'busy', element: () => <StateCard heading="Confirming your email" busy />, role: 'heading', name: 'Confirming your email', check: () => expect(document.querySelector('[data-slot="state-card"]')).toHaveAttribute('aria-busy', 'true') },

  /* SupportBlock: available, loading, unavailable, unavailable none. */
  { component: 'SupportBlock', state: 'available', element: () => <SupportBlock {...ON} />, role: 'link', name: '1-800-555-0199', classes: ['min-h-11', 'text-heading-sm'], check: (el) => { expect(el).toHaveAttribute('href', 'tel:+18005550199'); expect(screen.getByText('Partner support')).toBeInTheDocument(); expect(screen.getByText(ON.hours)).toBeInTheDocument(); } },
  { component: 'SupportBlock', state: 'config prop', element: () => <SupportBlock config={{ support_enabled: true, support_phone_e164: '+14165550123', support_hours: null }} />, role: 'link', name: '416-555-0123' },
  { component: 'SupportBlock', state: 'loading', element: () => <SupportBlock loading {...ON} />, busy: true },
  { component: 'SupportBlock', state: 'unavailable', element: () => <SupportBlock supportEnabled={false} />, check: () => expect(screen.getByText("Partner support isn't available right now")).toBeInTheDocument() },
  { component: 'SupportBlock', state: 'unavailable none', element: () => <SupportBlock supportEnabled={false} unavailable="none" />, empty: true },

  /* SupportSentence: on, off, off with a fallback. */
  { component: 'SupportSentence', state: 'available', element: () => <SupportSentence {...ON} />, role: 'link', name: '1-800-555-0199', classes: ['font-semibold'], check: () => expect(screen.getByTestId('SupportSentence')).toHaveTextContent('Need help signing in? Call partner support on 1-800-555-0199, Every day, 9 am to 9 pm.') },
  { component: 'SupportSentence', state: 'lead', element: () => <SupportSentence {...ON} lead="Partner support:" hours={null} />, role: 'link', name: '1-800-555-0199', check: () => expect(screen.getByTestId('SupportSentence')).toHaveTextContent(/^Partner support: 1-800-555-0199\.$/) },
  { component: 'SupportSentence', state: 'unavailable', element: () => <SupportSentence supportEnabled={false} />, empty: true },
  { component: 'SupportSentence', state: 'unavailable fallback', element: () => <SupportSentence supportEnabled={false} fallback="If you didn't expect this, contact HalalGoes after signing in." />, check: () => expect(screen.getByTestId('SupportSentence')).toHaveTextContent('contact HalalGoes after signing in') },

  /* WaitLine: the silent countdown inside a described line. */
  { component: 'WaitLine', state: 'waiting', element: () => <WaitLine id="wait-reason" serverNow={DATE_HEADER} retryAfter={42} />, role: 'timer', name: '42 seconds left', check: (el) => { expect(el).not.toHaveAttribute('aria-live'); expect(document.getElementById('wait-reason')).toHaveTextContent('You can try again in'); expect(el.closest('p'), 'a timer div inside a paragraph is invalid HTML').toBeNull(); } },
  { component: 'WaitLine', state: 'lead', element: () => <WaitLine serverNow={DATE_HEADER} retryAfter="60" lead="You can send another in" />, role: 'timer', name: '1 minute left', check: () => expect(screen.getByTestId('WaitLine')).toHaveTextContent('You can send another in') },
  { component: 'WaitLine', state: 'no Retry-After', element: () => <WaitLine serverNow={DATE_HEADER} />, empty: true },
];

describe('sign-in composites: every state renders with its role and name', () => {
  it.each(REGISTRY.map((row) => [`${row.component} / ${row.state}`, row] as const))('%s', (_label, row) => {
    const { container } = render(row.element());
    if (row.empty) {
      expect(container).toBeEmptyDOMElement();
      return;
    }
    expect(container).not.toBeEmptyDOMElement();
    if (row.busy) expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    if (!row.role) {
      row.check?.(container as HTMLElement);
      return;
    }
    const el = screen.getByRole(row.role, row.name === undefined ? {} : { name: row.name });
    for (const c of row.classes ?? []) expect(el.className.split(/\s+/), c).toContain(c);
    for (const c of row.notClasses ?? []) expect(el.className.split(/\s+/), c).not.toContain(c);
    row.check?.(el);
  });
});

describe('support renders nothing unless support_enabled is true', () => {
  const PHONE_PATTERN = /555|tel:|9 am/;

  it.each([
    ['false', false],
    ['null', null],
    ['undefined (config loading)', undefined],
  ] as const)('supportEnabled %s: no phone, no hours, no tel: link, even when they are passed', (_label, flag) => {
    const { container } = render(
      <>
        <SupportBlock supportEnabled={flag} phoneE164={ON.phoneE164} hours={ON.hours} />
        <SupportSentence supportEnabled={flag} phoneE164={ON.phoneE164} hours={ON.hours} />
        <SupportSentence config={{ support_enabled: flag, support_phone_e164: ON.phoneE164, support_hours: ON.hours }} />
      </>,
    );
    expect(container.textContent ?? '').not.toMatch(PHONE_PATTERN);
    expect(container.innerHTML).not.toMatch(PHONE_PATTERN);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryAllByTestId('SupportSentence')).toHaveLength(0);
  });

  it('an explicit null or a loaded config without the flag is off, not a placeholder that never ends', () => {
    render(
      <>
        <SupportBlock supportEnabled={null} phoneE164={ON.phoneE164} testId="explicit-null" />
        <SupportBlock config={{ support_phone_e164: ON.phoneE164 }} testId="config-no-flag" />
      </>,
    );
    expect(screen.getByTestId('explicit-null')).toHaveAttribute('data-state', 'unavailable');
    expect(screen.getByTestId('config-no-flag')).toHaveAttribute('data-state', 'unavailable');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('true without a phone shows the replacement and reports the config fault', () => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(<SupportBlock supportEnabled phoneE164={null} hours={ON.hours} />);
    expect(screen.getByText("Partner support isn't available right now")).toBeInTheDocument();
    expect(screen.queryByText(ON.hours)).toBeNull();
    expect(report).toHaveBeenCalledWith('SUPPORT_PHONE_MISSING', expect.anything());
  });

  it('formats North American numbers, toll-free with a leading 1', () => {
    expect(formatSupportPhone('+18005550199')).toBe('1-800-555-0199');
    expect(formatSupportPhone('+14165550123')).toBe('416-555-0123');
    expect(formatSupportPhone('+442071838750')).toBe('+442071838750');
  });
});

describe('WaitLine', () => {
  function Form({ onExpire, retryAfter = 42 }: { onExpire?: () => void; retryAfter?: number | string }) {
    const wait = useWaitLine({ serverNow: DATE_HEADER, retryAfter, onExpire });
    return (
      <>
        <Button type="submit" disabled={wait.waiting} aria-describedby={wait.describedBy}>
          Try again
        </Button>
        <WaitLine {...wait.lineProps} />
      </>
    );
  }

  it("the disabled button's aria-describedby points at the line, which describes the wait", () => {
    render(<Form />);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const id = button.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent('You can try again in');
    // The visible lead is hidden from the description and the spoken lead stands in. The time is
    // the timer's name or its numeral, depending on the accessible-name engine.
    expect(button).toHaveAccessibleDescription(/^Time until you can try again: (42 seconds left|0:42)$/);
  });

  it('expires once: onExpire fires, the line says so, the button re-enables and loses the description', () => {
    const onExpire = vi.fn();
    render(<Form onExpire={onExpire} />);
    expect(screen.getByRole('status')).toHaveTextContent('You can try again in 42 seconds.');
    act(() => vi.advanceTimersByTime(41_000));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('WaitLine')).toHaveTextContent('You can try again now.');
    expect(screen.getByRole('status')).toHaveTextContent('You can try again now.');
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
    act(() => vi.advanceTimersByTime(60_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a wait already over at mount renders nothing and fires onExpire once', () => {
    const onExpire = vi.fn();
    render(<WaitLine serverNow={DATE_HEADER} expiresAt={new Date(NOW - 5_000).toISOString()} onExpire={onExpire} />);
    expect(screen.queryByTestId('WaitLine')).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a wait already over at mount stays empty under StrictMode (double effects)', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <StrictMode>
        <WaitLine serverNow={DATE_HEADER} expiresAt={new Date(NOW - 5_000).toISOString()} onExpire={onExpire} />
      </StrictMode>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('activating the disabled button says the wait again (SignIn-Locked), and stops once it ends', () => {
    function Locked() {
      const wait = useWaitLine({ serverNow: DATE_HEADER, retryAfter: 42 });
      return (
        <>
          <Button disabled={wait.waiting} {...wait.buttonProps}>Sign in</Button>
          <WaitLine {...wait.lineProps} />
        </>
      );
    }
    render(<Locked />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('You can try again in 42 seconds.');
    act(() => vi.advanceTimersByTime(10_000));
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    expect(status).toHaveTextContent('You can try again in 32 seconds.');
    const spoken = status.firstChild;
    fireEvent.keyDown(button, { key: 'Enter' });
    // The same words again, in a new node, so a screen reader says them again.
    expect(status).toHaveTextContent('You can try again in 32 seconds.');
    expect(status.firstChild).not.toBe(spoken);
    act(() => vi.advanceTimersByTime(40_000));
    expect(status).toHaveTextContent('You can try again now.');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(status).toHaveTextContent('You can try again now.');
  });

  it('reads Retry-After as seconds or as an HTTP date', () => {
    expect(resolveWaitDeadline({ serverNow: DATE_HEADER, retryAfter: '90' })).toEqual({
      serverNow: '2026-10-10T18:40:00.000Z',
      expiresAt: '2026-10-10T18:41:30.000Z',
      windowSeconds: 90,
    });
    expect(resolveWaitDeadline({ serverNow: DATE_HEADER, retryAfter: new Date(NOW + 900_000).toUTCString() })?.windowSeconds).toBe(900);
    expect(resolveWaitDeadline({ serverNow: DATE_HEADER, retryAfter: null })).toBeNull();
    expect(resolveWaitDeadline({ serverNow: 'not a date', retryAfter: 30 })).toBeNull();
  });

  it('announce={false} renders no status region', () => {
    render(<WaitLine serverNow={DATE_HEADER} retryAfter={30} announce={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('TextLink', () => {
  it('onNavigate takes a plain click and leaves modified clicks to the browser', () => {
    const onNavigate = vi.fn();
    render(<TextLink to="/sign-in" state={{ email: 'samir@zaytoungrill.ca' }} onNavigate={onNavigate} variant="standalone">Back to sign in</TextLink>);
    const link = screen.getByRole('link', { name: 'Back to sign in' });
    expect(link).toHaveAttribute('href', '/sign-in');
    expect(fireEvent.click(link)).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith('/sign-in', { state: { email: 'samir@zaytoungrill.ca' } });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('a standalone link has the 44px target; an inline link stays in the line', () => {
    render(
      <p>
        Forgot your password? <TextLink href="/forgot">Reset it by email</TextLink>.
        <TextLink href="/sign-in" variant="standalone">Back to sign in</TextLink>
      </p>,
    );
    expect(screen.getByRole('link', { name: 'Back to sign in' }).className).toMatch(/\bmin-h-11\b/);
    expect(screen.getByRole('link', { name: 'Reset it by email' }).className).not.toMatch(/\bmin-h-/);
  });
});
