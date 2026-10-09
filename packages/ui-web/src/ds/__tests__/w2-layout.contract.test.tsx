/**
 * W2 (layout and shell) contract: one registry of every component and state this work package
 * ships, checked for render, accessible role and name, busy and disabled semantics and the
 * target-size classes; then the behaviour each one exists for: the current page as a filled
 * tile with aria-current (never an edge stripe), counts folded into names, in-page panels that
 * are not overlays, keyboard-operable pane handles, and a drawer that returns focus.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AppBar, DetailPanel, SideNav, SplitPanes, type SideNavGroup } from '../index';
import {
  Banner,
  Disclosure,
  NavDrawer,
  SectionNav,
  SkipLink,
  StickyFooter,
  SystemBannerSlot,
} from '../../proposed/index';

const groups: SideNavGroup[] = [
  {
    key: 'main',
    label: 'Operate',
    items: [
      { key: 'orders', label: 'Live orders', shortLabel: 'Orders', icon: 'orders', href: '#o', badge: 3, badgeNoun: 'new' },
      { key: 'menu', label: 'Menu', icon: 'menu', href: '#m' },
      { key: 'staff', label: 'Staff', disabled: true, disabledReason: 'Only an admin can manage staff' },
    ],
  },
];

interface Case {
  name: string;
  ui: () => ReactElement;
  role: string;
  accessibleName: string | RegExp;
  busy?: boolean;
  disabled?: boolean;
  /** A class the element (or its nearest element with the role) must carry for its target size. */
  targetClass?: RegExp;
}

const registry: Case[] = [
  { name: 'SideNav expanded', ui: () => <SideNav groups={groups} activeKey="orders" />, role: 'navigation', accessibleName: 'Main' },
  { name: 'SideNav current item', ui: () => <SideNav groups={groups} activeKey="orders" />, role: 'link', accessibleName: 'Live orders, 3 new', targetClass: /\bmin-h-12\b/ },
  { name: 'SideNav collapsed item', ui: () => <SideNav groups={groups} activeKey="orders" defaultCollapsed />, role: 'link', accessibleName: 'Live orders, 3 new', targetClass: /\bmin-h-15\b/ },
  { name: 'SideNav disabled item', ui: () => <SideNav groups={groups} />, role: 'button', accessibleName: 'Staff', disabled: true, targetClass: /\bmin-h-12\b/ },
  { name: 'SideNav sign out', ui: () => <SideNav groups={groups} onSignOut={() => undefined} />, role: 'button', accessibleName: 'Sign out', targetClass: /\bmin-h-11\b/ },
  { name: 'SideNav collapse toggle', ui: () => <SideNav groups={groups} defaultCollapsed />, role: 'button', accessibleName: 'Expand menu', targetClass: /\bmin-w-11\b/ },
  { name: 'AppBar default', ui: () => <AppBar title="Live orders" />, role: 'banner', accessibleName: '' },
  { name: 'AppBar title', ui: () => <AppBar title="Live orders" tone="chrome" />, role: 'heading', accessibleName: 'Live orders' },
  { name: 'AppBar large', ui: () => <AppBar variant="large" title="Payouts" />, role: 'heading', accessibleName: 'Payouts' },
  { name: 'AppBar loading', ui: () => <AppBar title="Orders" loading loadingLabel="Loading orders" />, role: 'progressbar', accessibleName: 'Loading orders' },
  { name: 'AppBar back', ui: () => <AppBar title="Order" onBack={() => undefined} backLabel="Back to Orders" />, role: 'button', accessibleName: 'Back to Orders' },
  { name: 'AppBar contextual', ui: () => <AppBar variant="contextual" title="3 selected" onBack={() => undefined} />, role: 'button', accessibleName: 'Clear selection' },
  { name: 'AppBar transparent', ui: () => <AppBar variant="transparent" title="Zaytoun Grill" />, role: 'heading', accessibleName: 'Zaytoun Grill' },
  { name: 'AppBar search', ui: () => <AppBar variant="search" search={<input aria-label="Search orders" />} />, role: 'textbox', accessibleName: 'Search orders' },
  { name: 'DetailPanel ready', ui: () => <DetailPanel title="Order B3M9">Body</DetailPanel>, role: 'complementary', accessibleName: 'Order B3M9' },
  { name: 'DetailPanel loading', ui: () => <DetailPanel title="Order B3M9" status="loading" />, role: 'complementary', accessibleName: 'Order B3M9', busy: true },
  { name: 'DetailPanel error', ui: () => <DetailPanel title="Order B3M9" status="error" />, role: 'alert', accessibleName: '' },
  { name: 'DetailPanel empty', ui: () => <DetailPanel title="Order details" status="empty" />, role: 'complementary', accessibleName: 'Order details' },
  { name: 'DetailPanel close', ui: () => <DetailPanel title="Order B3M9" onClose={() => undefined} />, role: 'button', accessibleName: 'Close Order B3M9' },
  {
    name: 'SplitPanes handle',
    ui: () => (
      <SplitPanes
        panes={[
          { id: 'list', label: 'Orders', content: 'list', foldable: true },
          { id: 'detail', label: 'Order', content: 'detail' },
        ]}
      />
    ),
    role: 'separator',
    accessibleName: 'Resize Orders and Order',
    targetClass: /after:-start-4/,
  },
  { name: 'Disclosure closed', ui: () => <Disclosure summary="Rider details">Body</Disclosure>, role: 'button', accessibleName: 'Rider details', targetClass: /\bmin-h-11\b/ },
  { name: 'SkipLink', ui: () => <SkipLink targetId="main" />, role: 'link', accessibleName: 'Skip to main content', targetClass: /\bmin-h-11\b/ },
  {
    name: 'SystemBannerSlot one',
    ui: () => <SystemBannerSlot banners={[{ id: 'o', severity: 'warning', node: <Banner variant="warning" title="You’re offline." /> }]} />,
    role: 'region',
    accessibleName: 'System messages',
  },
  { name: 'StickyFooter', ui: () => <StickyFooter label="Hours actions">x</StickyFooter>, role: 'group', accessibleName: 'Hours actions' },
  { name: 'NavDrawer trigger', ui: () => <NavDrawer triggerCount={3} triggerCountNoun="new orders">nav</NavDrawer>, role: 'button', accessibleName: 'Open menu, 3 new orders' },
  {
    name: 'SectionNav current',
    ui: () => <SectionNav label="Settings sections" activeKey="halal" items={[{ key: 'halal', label: 'Halal certificate', href: '#h' }]} />,
    role: 'link',
    accessibleName: 'Halal certificate',
    targetClass: /\bmin-h-12\b/,
  },
];

describe('W2 contract registry', () => {
  it.each(registry)('$name renders with its role, name and state', (c) => {
    render(c.ui());
    const el =
      c.accessibleName === ''
        ? screen.getAllByRole(c.role)[0]!
        : screen.getByRole(c.role, { name: c.accessibleName });
    expect(el).toBeInTheDocument();
    if (c.busy) expect(el).toHaveAttribute('aria-busy', 'true');
    if (c.disabled) {
      // aria-disabled, never the disabled attribute: it stays focusable so its reason can be read.
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
      el.focus();
      expect(el).toHaveFocus();
    }
    if (c.targetClass) expect(el.className).toMatch(c.targetClass);
  });
});

describe('SideNav', () => {
  it('marks the current page with aria-current and a filled tile, and folds counts into the name', () => {
    render(<SideNav groups={groups} activeKey="orders" />);
    const current = screen.getByRole('link', { name: 'Live orders, 3 new' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.className).toMatch(/\bbg-fg-on-accent\b/);
    expect(screen.getByRole('link', { name: 'Menu' })).not.toHaveAttribute('aria-current');
  });

  it('keeps every name when collapsed to the icon rail, and toggles with aria-expanded', () => {
    const onToggle = vi.fn();
    render(<SideNav groups={groups} activeKey="orders" collapsed onToggleCollapsed={onToggle} />);
    expect(screen.getByRole('navigation')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('link', { name: 'Live orders, 3 new' })).toHaveTextContent('Orders');
    const toggle = screen.getByRole('button', { name: 'Expand menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('reads a disabled item’s reason and ignores activation', () => {
    const onSelect = vi.fn();
    render(<SideNav groups={[{ key: 'g', items: [{ key: 's', label: 'Staff', disabled: true, disabledReason: 'Only an admin can manage staff', onSelect }] }]} />);
    const item = screen.getByRole('button', { name: 'Staff' });
    expect(item).toHaveAccessibleDescription('Only an admin can manage staff');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the pre-redesign props working (header, footer, className, testId)', () => {
    render(<SideNav groups={groups} header="Head" footer="Foot" className="extra" testId="side-nav" />);
    const nav = screen.getByTestId('side-nav');
    expect(nav.className).toMatch(/\bextra\b/);
    expect(within(nav).getByText('Head')).toBeInTheDocument();
    expect(screen.getByTestId('side-nav-item-orders')).toBeInTheDocument();
  });
});

describe('AppBar', () => {
  it('is a banner with an h1 by default, and role="none" inside main', () => {
    const { rerender } = render(<AppBar title="Orders" />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toHaveAttribute('tabindex', '-1');
    rerender(<AppBar title="Orders" role="none" titleIsPageHeading={false} />);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the leading slot and the brand mark', () => {
    render(<AppBar title="Orders" leading={<button type="button">Open menu</button>} brand={<span>Brand</span>} />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(screen.getByText('Brand')).toBeInTheDocument();
  });
});

describe('DetailPanel is in-page, not an overlay', () => {
  it('has no dialog role, no aria-modal, and is named by its heading', () => {
    render(<DetailPanel title="Order B3M9">Body</DetailPanel>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Order B3M9' })).toBeInTheDocument();
  });

  it('lands focus on its heading, closes on Escape, and returns focus to where it was', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open B3M9
          </button>
          {open ? (
            <DetailPanel title="Order B3M9" onClose={() => setOpen(false)}>
              Body
            </DetailPanel>
          ) : null}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open B3M9' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('heading', { name: 'Order B3M9' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Order B3M9' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('renders a pinned footer outside the scrolling body', () => {
    render(<DetailPanel title="Order" footer={<button type="button">Mark ready</button>}>Body</DetailPanel>);
    const footer = screen.getByTestId('DetailPanel-footer');
    expect(within(footer).getByRole('button', { name: 'Mark ready' })).toBeInTheDocument();
    expect(footer.closest('[data-slot="scroll-area"]')).toBeNull();
  });
});

describe('SplitPanes', () => {
  it('names each handle and exposes its value, and folds a pane to a strip with "Show {label}"', () => {
    const onFold = vi.fn();
    render(
      <SplitPanes
        onFoldChange={onFold}
        panes={[
          { id: 'queue', label: 'Rider applications', content: 'queue', foldable: true, defaultFolded: true },
          { id: 'app', label: 'Application', content: 'app' },
        ]}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize Rider applications and Application' });
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuemin');
    expect(handle).toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('complementary', { name: 'Rider applications, folded' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Rider applications' })).toBeInTheDocument();
  });
});

describe('NavDrawer', () => {
  it('opens a named drawer and returns focus to "Open menu" on Escape', async () => {
    render(
      <NavDrawer>
        <SideNav groups={groups} activeKey="orders" collapsible={false} />
      </NavDrawer>,
    );
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    expect(within(dialog).getByRole('link', { name: 'Live orders, 3 new' })).toHaveAttribute('aria-current', 'page');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Radix restores focus on the tick after unmount.
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('SystemBannerSlot', () => {
  it('renders no empty landmark, orders by severity and counts the overflow', () => {
    const { container, rerender } = render(<SystemBannerSlot banners={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <SystemBannerSlot
        max={2}
        banners={[
          { id: 'info', severity: 'info', node: <p>info</p> },
          { id: 'warn', severity: 'warning', node: <p>warn</p> },
          { id: 'danger', severity: 'danger', node: <p>danger</p> },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'System messages' });
    expect([...region.querySelectorAll('[data-severity]')].map((n) => n.getAttribute('data-severity'))).toEqual(['danger', 'warning']);
    expect(within(region).getByText('1 more system message')).toBeInTheDocument();
  });
});

describe('SkipLink and Disclosure', () => {
  it('SkipLink moves focus to its target', () => {
    render(
      <>
        <SkipLink targetId="main-x" />
        <main id="main-x">Main</main>
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('Disclosure toggles aria-expanded and hides closed content', () => {
    render(<Disclosure summary="Rider details">Vehicle: bicycle</Disclosure>);
    const summary = screen.getByRole('button', { name: 'Rider details' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Vehicle: bicycle')).toBeNull();
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Vehicle: bicycle')).toBeVisible();
  });
});

describe('app requests (#675 restaurant, #699 admin)', () => {
  it('DetailPanel: busy blocks Escape and Close (Close stays focusable), and returns focus to returnFocusRef', () => {
    const onClose = vi.fn();
    const row = createRef<HTMLButtonElement>();
    function Harness({ busy }: { busy: boolean }) {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" ref={row}>
            Row B3M9
          </button>
          <DetailPanel
            open={open}
            busy={busy}
            title="Refund B3M9"
            width="panel"
            returnFocusRef={row}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            Body
          </DetailPanel>
        </>
      );
    }
    const { rerender } = render(<Harness busy />);
    const panel = screen.getByRole('complementary', { name: 'Refund B3M9' });
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(panel.className).toMatch(/w-\[380px\]/);
    expect(panel.className).toMatch(/xl:w-\[460px\]/);
    const close = screen.getByRole('button', { name: 'Close Refund B3M9' });
    expect(close).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(close);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Refund B3M9' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Harness busy={false} />);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Refund B3M9' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Row B3M9' })).toHaveFocus();
  });

  it('SideNav: the admin names work (count, countLabel, current, heading, onNavigate, onCollapsedChange)', () => {
    const onNavigate = vi.fn();
    const onCollapsedChange = vi.fn();
    render(
      <SideNav
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        onNavigate={onNavigate}
        groups={[
          {
            key: 'review',
            heading: 'Review',
            items: [
              {
                key: 'apps',
                label: 'Restaurant applications',
                shortLabel: 'Restaurant',
                href: '/apps',
                count: 4,
                countLabel: 'waiting',
                countTone: 'warning',
                current: true,
              },
              { key: 'orders', label: 'Orders', href: '/orders', count: null },
              { key: 'refunds', label: 'Refunds', href: '/refunds', count: 0 },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    const current = screen.getByRole('link', { name: 'Restaurant applications, 4 waiting' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.querySelector('[data-tone="warning"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Orders' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Refunds' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }), { button: 0 });
    expect(onNavigate).toHaveBeenCalledWith('/orders', expect.objectContaining({ key: 'orders' }), expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('SideNav rail: 80px wide, labels wrap under the icon instead of truncating', () => {
    render(<SideNav groups={groups} activeKey="orders" collapsed />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.className).toMatch(/\bw-20\b/);
    const label = within(screen.getByRole('link', { name: 'Live orders, 3 new' })).getByText('Orders');
    expect(label.className).toMatch(/max-w-18/);
    expect(label.className).not.toMatch(/\btruncate\b/);
  });

  it('SplitPanes: px units, a fill pane and a controlled 48px strip', () => {
    const onCollapsedChange = vi.fn();
    const panes = (collapsed: boolean) => [
      { id: 'list', label: 'Orders', content: 'list', defaultSize: 360, collapsible: true, collapsed, onCollapsedChange },
      { id: 'detail', label: 'Order', content: 'detail', fill: true },
    ];
    const { rerender } = render(<SplitPanes units="px" panes={panes(false)} />);
    expect(screen.getByRole('separator', { name: 'Resize Orders and Order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Orders' })).toBeNull();
    rerender(<SplitPanes units="px" panes={panes(true)} />);
    expect(screen.getByRole('complementary', { name: 'Orders, folded' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Orders' }));
    expect(onCollapsedChange).toHaveBeenCalledTimes(1);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('NavDrawer with the app’s own trigger returns focus to it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" aria-controls="nav-drawer" onClick={() => setOpen(true)}>
            Open navigation
          </button>
          <NavDrawer hideTrigger id="nav-drawer" open={open} onClose={() => setOpen(false)} title="Navigation">
            <SideNav groups={groups} activeKey="orders" collapsible={false} />
          </NavDrawer>
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('id', 'nav-drawer');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Disclosure accepts the admin’s title and meta', () => {
    render(<Disclosure title="Documents" meta="3 files">Licence</Disclosure>);
    expect(screen.getByRole('button', { name: /Documents/ })).toHaveTextContent('3 files');
  });
});

// ---------------------------------------------------------------------------
// Static checks over this work package's source (constitution gate items 6 and 9; lint L-2).

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W2_FILES = [
  'ds/SideNav.tsx',
  'ds/AppBar.tsx',
  'ds/DetailPanel.tsx',
  'ds/SplitPanes.tsx',
  'proposed/Disclosure.tsx',
  'proposed/SkipLink.tsx',
  'proposed/SystemBannerSlot.tsx',
  'proposed/StickyFooter.tsx',
  'proposed/NavDrawer.tsx',
  'proposed/SectionNav.tsx',
  'lib/ui/sidebar.tsx',
  'lib/ui/resizable.tsx',
  'lib/ui/scroll-area.tsx',
  'lib/ui/collapsible.tsx',
  'lib/ui/sheet.tsx',
  'lib/ui/progress.tsx',
  'lib/ui/skip-link.tsx',
];
const source = (file: string): string =>
  readFileSync(join(SRC, file), 'utf8')
    // Comments may name what is forbidden; only code counts.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('W2 source rules', () => {
  it.each(W2_FILES)('%s marks nothing with an inline-start edge (fills only)', (file) => {
    expect(source(file)).not.toMatch(/\bborder-(l|s)(-\S+)?\b|border-inline-start|borderLeft|borderInlineStart/);
  });

  it.each(W2_FILES)('%s uses role tokens only: no raw colours, no ramp steps, no success or danger fills', (file) => {
    const code = source(file);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    expect(code).not.toMatch(/\b(brand|accent|neutral|success|warning|danger|info)-(50|[1-9]00|950|1000)\b/);
    expect(code).not.toMatch(/\bbg-(feedback-success|feedback-danger-solid|action-danger)/);
  });
});
