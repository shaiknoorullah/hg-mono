/**
 * W4 Feedback — the per-component contract, table-driven (plan/design-system.md §5.1).
 *
 * One registry of {component, state, element, expectation}. Each row renders and is checked for
 * the role and accessible name its README specifies, `aria-disabled` / `aria-busy` where the
 * state has one, and the measured minimum target class where the row has a control. The
 * invariant-bearing behaviour (Countdown's clock, Toast's persistence, the halal tone) is in
 * `w4.invariants.test.tsx`.
 */

import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Countdown, Menu, Modal, StatusTimeline, Toast, setClientErrorReporter } from '../index';
import { Banner, EmptyState, ErrorState, HalalBanner, InlineAlert, PageAnnouncerProvider, ProgressBar } from '../../proposed/index';

const NOW = Date.parse('2026-10-10T18:40:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  role: string;
  name?: string | RegExp;
  /** Extra assertions on the element found by role. */
  check?: (el: HTMLElement) => void;
}

const minTarget = (el: HTMLElement) => {
  expect(el.className).toMatch(/min-h-11/);
  expect(el.className).toMatch(/min-w-11/);
};

const countdown = (props: Partial<Parameters<typeof Countdown>[0]> = {}) => (
  <Countdown expiresAt={iso(NOW + 120_000)} serverNow={iso(NOW)} windowSeconds={180} label="to accept" {...props} />
);

const REGISTRY: Row[] = [
  /* Countdown: every variant and size; the timer is named "{label}: {time} left". */
  ...(['text', 'ring', 'bar', 'bar-only'] as const).flatMap((variant) =>
    (['sm', 'md', 'lg'] as const).map<Row>((size) => ({
      component: 'Countdown',
      state: `${variant}-${size}`,
      element: () => countdown({ variant, size }),
      role: 'timer',
      name: 'to accept: 2 minutes left',
    })),
  ),
  { component: 'Countdown', state: 'barOnly prop', element: () => countdown({ barOnly: true }), role: 'timer', name: /2 minutes left/ },
  { component: 'Countdown', state: 'silent', element: () => countdown({ silent: true }), role: 'timer', name: /2 minutes left/ },
  { component: 'Countdown', state: 'onDark', element: () => countdown({ onDark: true, variant: 'ring' }), role: 'timer' },

  /* Toast: status (polite) for all but danger, which is an alert. */
  ...(['neutral', 'success', 'warning', 'info'] as const).map<Row>((variant) => ({
    component: 'Toast',
    state: variant,
    element: () => <Toast variant={variant} title="Menu synced" />,
    role: 'status',
    check: (el) => expect(el).toHaveTextContent('Menu synced'),
  })),
  { component: 'Toast', state: 'danger', element: () => <Toast variant="danger" title="Payment declined" />, role: 'alert' },
  {
    component: 'Toast',
    state: 'dismissible',
    element: () => <Toast title="Address saved" onDismiss={() => undefined} />,
    role: 'button',
    name: 'Dismiss',
  },
  {
    component: 'Toast',
    state: 'action',
    element: () => <Toast title="Address saved" action={{ label: 'Undo', onAction: () => undefined }} />,
    role: 'button',
    name: 'Undo',
    check: (el) => expect(el.className).toMatch(/min-h-11/),
  },

  /* Modal: confirm and alert are alertdialogs named by the title; dialog is a dialog. */
  {
    component: 'Modal',
    state: 'confirm',
    element: () => <Modal open variant="confirm" destructive title="Cancel this order?" confirmLabel="Cancel order" cancelLabel="Keep order" />,
    role: 'alertdialog',
    name: 'Cancel this order?',
  },
  {
    component: 'Modal',
    state: 'confirm-loading',
    element: () => <Modal open variant="confirm" title="Cancel this order?" confirmLabel="Cancel order" confirmLoading />,
    role: 'button',
    name: /Cancel order/,
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  { component: 'Modal', state: 'alert', element: () => <Modal open variant="alert" title="Store closed" />, role: 'alertdialog', name: 'Store closed' },
  {
    component: 'Modal',
    state: 'dialog',
    element: () => <Modal open variant="dialog" title="Delivery instructions" description="Shown to your rider." onClose={() => undefined} />,
    role: 'dialog',
    name: 'Delivery instructions',
  },

  /* Menu: the trigger is a menu button with a unique name and a 44px target. */
  ...(['plain', 'tonal', 'filled'] as const).map<Row>((triggerVariant) => ({
    component: 'Menu',
    state: `trigger-${triggerVariant}`,
    element: () => <Menu label={`Actions for item ${triggerVariant}`} triggerVariant={triggerVariant} items={[{ label: 'Edit item' }]} />,
    role: 'button',
    name: `Actions for item ${triggerVariant}`,
    check: (el) => {
      expect(el).toHaveAttribute('aria-haspopup', 'menu');
      expect(el).toHaveAttribute('aria-expanded', 'false');
      minTarget(el);
    },
  })),
  {
    component: 'Menu',
    state: 'text-trigger',
    element: () => <Menu label="Sort orders" triggerText="Sort" items={[{ label: 'Newest first' }]} />,
    role: 'button',
    name: 'Sort orders',
    check: (el) => expect(el).toHaveTextContent('Sort'),
  },
  {
    component: 'Menu',
    state: 'disabled',
    element: () => <Menu label="Actions for order HG-1" disabled items={[{ label: 'Open order' }]} />,
    role: 'button',
    name: 'Actions for order HG-1',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled(); // still focusable
    },
  },

  /* StatusTimeline: a list; loading is busy; compact is a progressbar. */
  {
    component: 'StatusTimeline',
    state: 'vertical',
    element: () => <StatusTimeline audience="customer" state="PREPARING" />,
    role: 'list',
  },
  {
    component: 'StatusTimeline',
    state: 'horizontal',
    element: () => <StatusTimeline audience="restaurant" state="PREPARING" orientation="horizontal" />,
    role: 'list',
  },
  {
    component: 'StatusTimeline',
    state: 'compact',
    element: () => <StatusTimeline audience="customer" state="PICKED_UP" orientation="compact" />,
    role: 'progressbar',
    name: 'Order progress',
  },
  {
    component: 'StatusTimeline',
    state: 'reconnecting',
    element: () => <StatusTimeline audience="customer" state="PICKED_UP" connection="reconnecting" />,
    role: 'status',
    check: (el) => expect(el).toHaveTextContent('Not updating — reconnecting'),
  },

  /* Banner + InlineAlert: danger is an alert; the rest are status; slate exists. */
  ...(['neutral', 'info', 'warning', 'slate'] as const).flatMap((tone) =>
    (['page', 'inline'] as const).map<Row>((placement) => ({
      component: 'Banner',
      state: `${tone}-${placement}`,
      element: () => <Banner tone={tone} placement={placement} title="Store is closed" />,
      role: 'status',
      check: (el) => expect(el).toHaveAttribute('data-tone', tone),
    })),
  ),
  { component: 'Banner', state: 'danger', element: () => <Banner tone="danger" title="Not receiving new orders" />, role: 'alert' },
  {
    component: 'Banner',
    state: 'legacy-variant',
    element: () => <Banner variant="warning" title="Old props" description="still work" />,
    role: 'status',
    check: (el) => expect(el).toHaveAttribute('data-tone', 'warning'),
  },
  {
    component: 'Banner',
    state: 'action-loading',
    element: () => <Banner tone="info" title="Offline" action={{ label: 'Retry', onPress: () => undefined, loading: true }} />,
    role: 'button',
    name: /Retry/,
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  {
    component: 'Banner',
    state: 'dismissible',
    element: () => <Banner tone="info" title="Menu synced" dismissible />,
    role: 'button',
    name: 'Dismiss: Menu synced',
  },
  { component: 'InlineAlert', state: 'default', element: () => <InlineAlert tone="warning" title="Check the hours" />, role: 'status' },
  {
    component: 'HalalBanner',
    state: 'slate',
    element: () => <HalalBanner tone="slate" title="Certificate expired" />,
    role: 'status',
    check: (el) => expect(el).toHaveAttribute('data-tone', 'slate'),
  },

  /* EmptyState and ErrorState. */
  { component: 'EmptyState', state: 'region', element: () => <EmptyState title="No orders yet" description="New orders appear here." />, role: 'heading', name: 'No orders yet' },
  {
    component: 'EmptyState',
    state: 'filtered',
    element: () => <EmptyState variant="filtered" title="No orders match" onClearFilters={() => undefined} />,
    role: 'button',
    name: 'Clear filters',
  },
  { component: 'EmptyState', state: 'grid-body', element: () => <EmptyState variant="grid-body" title="No riders" headingLevel={3} />, role: 'heading', name: 'No riders' },
  {
    component: 'ErrorState',
    state: 'region',
    element: () => <ErrorState errorCode="INTERNAL_ERROR" onRetry={() => undefined} />,
    role: 'status',
    check: (el) => expect(within(el).getByRole('heading')).toHaveTextContent('Something went wrong on our side'),
  },
  {
    component: 'ErrorState',
    state: 'retrying',
    element: () => <ErrorState title="Orders did not load" onRetry={() => undefined} retrying />,
    role: 'button',
    name: /Try again/,
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  { component: 'ErrorState', state: 'inline', element: () => <ErrorState variant="inline" title="Could not save" />, role: 'alert' },

  /* ProgressBar: a named progressbar; indeterminate has no value. */
  {
    component: 'ProgressBar',
    state: 'determinate',
    element: () => <ProgressBar label="Uploading certificate" value={40} />,
    role: 'progressbar',
    name: 'Uploading certificate',
    check: (el) => expect(el).toHaveAttribute('aria-valuenow', '40'),
  },
  {
    component: 'ProgressBar',
    state: 'indeterminate',
    element: () => <ProgressBar label="Checking" value={null} />,
    role: 'progressbar',
    name: 'Checking',
    check: (el) => expect(el).not.toHaveAttribute('aria-valuenow'),
  },

  /* PageAnnouncer: one polite and one assertive region, always mounted. */
  { component: 'PageAnnouncer', state: 'regions', element: () => <PageAnnouncerProvider />, role: 'status' },
];

describe('W4 Feedback contract', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    // Icon extension names (info, warning, more…) land with W1; keep the reports out of the log.
    setClientErrorReporter(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    setClientErrorReporter(null);
  });

  it.each(REGISTRY.map((row) => [`${row.component} / ${row.state}`, row] as const))('%s', (_label, row) => {
    render(row.element());
    const el = row.name === undefined ? screen.getAllByRole(row.role)[0]! : screen.getByRole(row.role, { name: row.name });
    expect(el).toBeInTheDocument();
    row.check?.(el);
  });

  it('every component defaults its data-testid to its name', () => {
    const cases: Array<[ReactElement, string]> = [
      [countdown(), 'Countdown'],
      [<Toast title="t" />, 'Toast'],
      [<Menu label="Actions for testid" items={[]} />, 'Menu'],
      [<StatusTimeline audience="admin" state="CREATED" />, 'StatusTimeline'],
      [<Banner title="b" />, 'Banner'],
      [<InlineAlert title="i" />, 'InlineAlert'],
      [<EmptyState title="e" />, 'EmptyState'],
      [<ErrorState title="x" />, 'ErrorState'],
      [<ProgressBar label="p" />, 'ProgressBar'],
      [<Modal open variant="alert" title="m" />, 'Modal'],
    ];
    for (const [element, id] of cases) {
      const { unmount } = render(element);
      expect(screen.getByTestId(id)).toBeInTheDocument();
      unmount();
    }
  });
});
