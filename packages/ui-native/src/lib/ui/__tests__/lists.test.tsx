/**
 * Design-system N6 (lists and content) on the React Native Reusables tier, measured through the
 * REAL generated stylesheet (harness.ts): `/proposed` ListRow, Disclosure, MediaFrame,
 * FilterChip, FilterChipGroup, JumpLinks and the `/ds` Menu, in customer and rider × light and
 * dark.
 *
 * What must never regress: one press target with one name per row; selected, pressed and
 * focused are a FILL (never a left or top edge); targets are 44pt, 56pt on the rider; the only
 * danger colour is destructive TEXT; the halal seal green appears nowhere here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';

import { Menu, type MenuItem } from '../../../ds';
import { Disclosure, FilterChip, FilterChipGroup, JumpLinks, ListItem, ListRow, MediaFrame } from '../../../proposed';
import { themes } from '../../../tokens';
import { Glyph } from '../icon';
import { SCHEMES, SEAL_GREEN, dangerSet, flat, hex, loadThemeCssFor, paintedColours, renderNw } from './harness';

const SRC = path.resolve(__dirname, '../../..');
beforeAll(() => loadThemeCssFor([`${SRC}/lib/**/*.tsx`, `${SRC}/ds/**/*.tsx`, `${SRC}/proposed/**/*.tsx`]), 180_000);

/** The selected tint (`bg-accent` = `state.selectedTint`) and the pressed/focused fill (`bg-muted`). */
const selectedTint = (t: 'customer' | 'rider', s: 'light' | 'dark') => hex(themes[t][s].color.state.selectedTint);
const mutedFill = (t: 'customer' | 'rider', s: 'light' | 'dark') => hex(themes[t][s].color.surface.subtle);

const MENU: MenuItem[] = [
  { key: 'open', label: 'Open order' },
  { key: 'refund', label: 'Issue refund', disabled: true, disabledReason: 'Already refunded' },
  { type: 'separator' },
  { key: 'cancel', label: 'Cancel order', destructive: true },
];

describe('ListRow', () => {
  it.each(SCHEMES)('%s %s: one button with one name; heights 56/64/72; the rider floor holds', (theme, scheme) => {
    for (const height of [56, 64, 72] as const) {
      const onPress = jest.fn();
      const { unmount } = renderNw(
        <ListRow title="Vehicle" subline="Scooter · Honda PCX 125" value="CJRA 204" icon="profile" height={height} onPress={onPress} />,
        { theme, scheme },
      );
      const row = screen.getByRole('button', { name: 'Vehicle, Scooter · Honda PCX 125, CJRA 204' });
      expect(flat(row).minHeight).toBe(height);
      expect(flat(row).minHeight).toBeGreaterThanOrEqual(theme === 'rider' ? 56 : 44);
      // One press target: nothing inside the row is a control of its own.
      expect(screen.getAllByRole('button')).toHaveLength(1);
      fireEvent.press(row);
      expect(onPress).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it.each(SCHEMES)('%s %s: pressed is an inset muted fill; selected is the selected tint; never an edge', (theme, scheme) => {
    renderNw(<ListRow title="Home" onPress={jest.fn()} testID="r" />, { theme, scheme });
    const row = screen.getByRole('button', { name: 'Home' });
    expect(flat(screen.getByTestId('r-fill')).backgroundColor).toBeUndefined();
    fireEvent(row, 'pressIn');
    const fill = flat(screen.getByTestId('r-fill'));
    expect(hex(fill.backgroundColor)).toBe(mutedFill(theme, scheme));
    expect(fill.borderRadius).toBe(12);
    // Inset: the row pads the fill away from its edges.
    expect(flat(row).paddingHorizontal ?? flat(row).paddingLeft).toBeGreaterThan(0);
    fireEvent(row, 'pressOut');
    renderNw(<ListRow title="Work" selected onPress={jest.fn()} testID="s" />, { theme, scheme });
    expect(screen.getByRole('button', { name: 'Work' }).props.accessibilityState).toMatchObject({ selected: true });
    const sel = flat(screen.getByTestId('s-fill'));
    expect(hex(sel.backgroundColor)).toBe(selectedTint(theme, scheme));
    for (const k of ['borderLeftWidth', 'borderTopWidth', 'borderStartWidth']) expect(sel[k] ?? 0).toBe(0);
  });

  it('focus draws the same inset fill (keyboard and switch access)', () => {
    renderNw(<ListRow title="Payouts" onPress={jest.fn()} testID="f" />);
    act(() => screen.getByRole('button', { name: 'Payouts' }).props.onFocus?.());
    expect(hex(flat(screen.getByTestId('f-fill')).backgroundColor)).toBe(mutedFill('customer', 'light'));
  });

  it('disabled stays focusable, reads its reason, swallows presses', () => {
    const onPress = jest.fn();
    renderNw(<ListRow title="Documents" disabled disabledReason="Upload your licence first" onPress={onPress} testID="d" />);
    const row = screen.getByRole('button', { name: 'Documents, Upload your licence first' });
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Upload your licence first')).toBeTruthy();
    fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('d-fill')).opacity).toBeCloseTo(0.6);
  });

  it('a trailing switch makes the row the switch; a tap anywhere toggles it', () => {
    const onValueChange = jest.fn();
    renderNw(<ListRow title="Order updates" switchValue={false} onValueChange={onValueChange} />, { theme: 'rider' });
    const row = screen.getByRole('switch', { name: 'Order updates' });
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.press(row);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it.each(SCHEMES)('%s %s: destructive is danger TEXT only; nothing else paints danger or the seal', (theme, scheme) => {
    const danger = dangerSet(theme, scheme);
    const { toJSON, unmount } = renderNw(
      <>
        <ListRow title="Help" icon="info" onPress={jest.fn()} />
        <ListRow title="Notifications" switchValue onValueChange={jest.fn()} />
        <ListRow title="Version" value="1.0.0" />
        <ListRow title="Saved" selected onPress={jest.fn()} />
      </>,
      { theme, scheme },
    );
    const painted = paintedColours(toJSON());
    expect(painted.filter((c) => danger.has(c))).toEqual([]);
    expect(painted).not.toContain(SEAL_GREEN);
    unmount();
    renderNw(<ListRow title="Sign out" destructive onPress={jest.fn()} />, { theme, scheme });
    const label = flat(screen.getByText('Sign out'));
    expect(hex(label.color)).toBe(hex(themes[theme][scheme].color.feedback.danger.text));
    expect(label.backgroundColor).toBeUndefined();
    const all = paintedColours(screen.toJSON()).filter((c) => danger.has(c));
    expect(all).toEqual([hex(themes[theme][scheme].color.feedback.danger.text)]);
  });

  it('a static row is one named element; ListItem is the same row', () => {
    renderNw(<ListRow title="On my way · 9:31 pm" subline="Not sent yet" height={56} />, { theme: 'rider' });
    expect(screen.getByLabelText('On my way · 9:31 pm, Not sent yet')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(ListItem).toBe(ListRow);
  });
});

describe('Disclosure', () => {
  it.each([
    ['customer', 44],
    ['rider', 56],
  ] as const)('%s: a %ipt header button that says expanded; collapsed content is not rendered', (theme, min) => {
    const onExpandedChange = jest.fn();
    renderNw(
      <Disclosure title="Opening hours" summary="Open until 11 pm" onExpandedChange={onExpandedChange}>
        <ListRow title="Monday" value="11 am – 11 pm" />
      </Disclosure>,
      { theme },
    );
    const header = screen.getByRole('button', { name: 'Opening hours, Open until 11 pm' });
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });
    expect(flat(header).minHeight).toBe(min);
    expect(screen.queryByText('Monday')).toBeNull();
    fireEvent.press(header);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Opening hours' }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText('Monday')).toBeTruthy();
  });
});

describe('MediaFrame', () => {
  it.each(SCHEMES)('%s %s: a fixed ratio; "No image" on the muted plate when there is no photo', (theme, scheme) => {
    renderNw(<MediaFrame ratio={16 / 9} testID="m" />, { theme, scheme });
    const frame = flat(screen.getByTestId('m', { includeHiddenElements: true }));
    expect(frame.aspectRatio).toBeCloseTo(16 / 9);
    expect(hex(frame.backgroundColor)).toBe(mutedFill(theme, scheme));
    expect(screen.getByText('No image', { includeHiddenElements: true })).toBeTruthy();
  });

  it('decorative by default; a named image with alt; a failed load falls back to the plate', () => {
    renderNw(<MediaFrame src="https://img.example/a.jpg" ratio={1} width={88} alt="Chicken shawarma plate" testID="m" />);
    expect(screen.getByRole('image', { name: 'Chicken shawarma plate' })).toBeTruthy();
    const img = screen.getByTestId('m-image');
    act(() => img.props.onError());
    expect(screen.getByText('No image')).toBeTruthy();
    renderNw(<MediaFrame src={null} testID="d" />);
    expect(screen.queryByTestId('d')).toBeNull();
  });
});

describe('FilterChip and JumpLinks', () => {
  it.each(SCHEMES)('%s %s: selected is a filled tile with a bold check; unselected a muted tile; no border', (theme, scheme) => {
    const min = theme === 'rider' ? 56 : 44;
    const c = themes[theme][scheme].color;
    renderNw(
      <>
        <FilterChip label="Open now" selected onPress={jest.fn()} testID="on" />
        <FilterChip label="$$" onPress={jest.fn()} testID="off" />
      </>,
      { theme, scheme },
    );
    const on = screen.getByRole('button', { name: 'Open now' });
    const off = screen.getByRole('button', { name: '$$' });
    expect(on.props.accessibilityState).toMatchObject({ selected: true });
    expect(off.props.accessibilityState).toMatchObject({ selected: false });
    expect(hex(flat(on).backgroundColor)).toBe(hex(c.action.secondary));
    expect(hex(flat(off).backgroundColor)).toBe(hex(c.surface.subtle));
    for (const chip of [on, off]) {
      expect(flat(chip).minHeight).toBe(min);
      expect(flat(chip).borderWidth ?? 0).toBe(0);
    }
    expect(flat(screen.getByText('Open now')).fontFamily).toBe('PlusJakartaSans_700Bold');
    // The check glyph is only on the selected chip, and it is the bold drawing.
    const checks = screen.getAllByTestId('hg-icon-check', { includeHiddenElements: true });
    expect(checks).toHaveLength(1);
    const drawn = checks[0]!.props.xml as string;
    const { toJSON, unmount } = renderNw(<Glyph name="check" weight="bold" size={16} />);
    expect(JSON.stringify(toJSON())).toContain(JSON.stringify(drawn).slice(1, -1));
    unmount();
  });

  it('a group toggles values (multi or single) and is named', () => {
    const onValueChange = jest.fn();
    const options = [
      { value: 'open', label: 'Open now' },
      { value: 'veg', label: 'Vegetarian', count: 12 },
    ];
    const view = renderNw(<FilterChipGroup label="Filters" options={options} value={['open']} onValueChange={onValueChange} />);
    expect(screen.getByLabelText('Filters')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Vegetarian, 12' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['open', 'veg']);
    fireEvent.press(screen.getByRole('button', { name: 'Open now' }));
    expect(onValueChange).toHaveBeenLastCalledWith([]);
    view.unmount();
    renderNw(<FilterChipGroup single label="Sort" options={options} value={['open']} onValueChange={onValueChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Vegetarian, 12' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['veg']);
  });

  it('a disabled chip says so and ignores presses', () => {
    const onPress = jest.fn();
    renderNw(<FilterChip label="Rated 4+" disabled onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Rated 4+' });
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(chip);
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(SCHEMES)('%s %s: jump links mark the current section with the fill, as a selected tab', (theme, scheme) => {
    const onSelect = jest.fn();
    renderNw(
      <JumpLinks
        label="Menu sections"
        links={[
          { key: 'grills', label: 'Grills' },
          { key: 'wraps', label: 'Wraps' },
        ]}
        current="grills"
        onSelect={onSelect}
      />,
      { theme, scheme },
    );
    const current = screen.getByRole('tab', { name: 'Grills' });
    expect(current.props.accessibilityState).toMatchObject({ selected: true });
    expect(hex(flat(current).backgroundColor)).toBe(hex(themes[theme][scheme].color.action.secondary));
    fireEvent.press(screen.getByRole('tab', { name: 'Wraps' }));
    expect(onSelect).toHaveBeenCalledWith('wraps');
  });
});

describe('Menu (/ds)', () => {
  const mount = (ui: React.ReactElement, opts?: Parameters<typeof renderNw>[1]) =>
    renderNw(
      <>
        {ui}
        <PortalHost />
      </>,
      opts,
    );

  it.each(SCHEMES)('%s %s: button → menu → menuitems; disabled reasons are readable; destructive is text', (theme, scheme) => {
    const onSelect = jest.fn();
    mount(<Menu label="Actions for order HG-10482" items={MENU} onSelect={onSelect} align="end" />, { theme, scheme });
    const trigger = screen.getByRole('button', { name: 'Actions for order HG-10482' });
    expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
    expect(flat(trigger).minHeight).toBe(theme === 'rider' ? 56 : 44);
    fireEvent.press(trigger);
    expect(screen.getByRole('button', { name: 'Actions for order HG-10482' }).props.accessibilityState).toMatchObject({ expanded: true });
    const menu = screen.getByTestId('Menu-menu');
    expect(menu.props).toMatchObject({ accessibilityRole: 'menu', accessibilityLabel: 'Actions for order HG-10482' });
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    const refund = screen.getByRole('menuitem', { name: 'Issue refund' });
    expect(refund.props.accessibilityState).toMatchObject({ disabled: true });
    expect(refund.props.accessibilityHint).toBe('Already refunded');
    expect(screen.getByText('Already refunded')).toBeTruthy();
    for (const item of screen.getAllByRole('menuitem')) expect(flat(item).minHeight).toBe(theme === 'rider' ? 56 : 44);
    const cancel = flat(screen.getByText('Cancel order'));
    expect(hex(cancel.color)).toBe(hex(themes[theme][scheme].color.feedback.danger.text));
    expect(screen.getByTestId('Menu-separator', { includeHiddenElements: true })).toBeTruthy();
    // A disabled item cannot be activated and keeps the menu open.
    fireEvent.press(refund);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('Menu-menu')).toBeTruthy();
    // Choosing an item runs it and closes the menu.
    fireEvent.press(screen.getByRole('menuitem', { name: 'Open order' }));
    expect(onSelect).toHaveBeenCalledWith('open', expect.objectContaining({ label: 'Open order' }));
    expect(screen.queryByTestId('Menu-menu')).toBeNull();
  });

  it('a tap outside closes it; a text trigger reads its unique label; disabled does not open', () => {
    mount(<Menu label="Sort restaurants" triggerText="Sort" items={[{ label: 'Nearest' }, { label: 'Fastest' }]} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sort restaurants' }));
    expect(screen.getByText('Sort')).toBeTruthy();
    expect(screen.getByTestId('Menu-menu')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Menu-backdrop'));
    expect(screen.queryByTestId('Menu-menu')).toBeNull();
    mount(<Menu label="Actions" items={MENU} disabled />);
    fireEvent.press(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByTestId('Menu-menu')).toBeNull();
  });

  it.each(SCHEMES)('%s %s: only destructive text is danger; no seal green', (theme, scheme) => {
    const danger = dangerSet(theme, scheme);
    mount(<Menu label="Actions for item Falafel" items={MENU} open />, { theme, scheme });
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    const hits = paintedColours(screen.toJSON()).filter((c) => danger.has(c));
    expect(new Set(hits)).toEqual(new Set([hex(themes[theme][scheme].color.feedback.danger.text)]));
    expect(paintedColours(screen.toJSON())).not.toContain(SEAL_GREEN);
  });
});

describe('static guards over the N6 sources', () => {
  const files = [
    'lib/ui/list-row.tsx',
    'lib/ui/filter-chip.tsx',
    'lib/ui/disclosure.tsx',
    'lib/ui/media-frame.tsx',
    'lib/ui/menu.tsx',
    'proposed/Lists.tsx',
    'proposed/Cards.tsx',
    'proposed/Rider.tsx',
    'ds/Menu.tsx',
  ].map((f) => [f, fs.readFileSync(path.join(SRC, f), 'utf8')] as const);

  it('no selected, current or pressed style is a left or top edge', () => {
    const edge = /\bborder-(?:l|t|s)(?:-\d+|-\[|\b)|\bborder(?:Left|Top|Start)(?:Width|Color)\b/;
    expect(files.filter(([, code]) => edge.test(code)).map(([f]) => f)).toEqual([]);
  });

  it('no raw colour, no ramp step, no halal namespace, no solid green', () => {
    const raw = /#[0-9A-Fa-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:bg|text|border)-(?:brand|accent|neutral|success|warning|danger|info|halal)-\d{2,3}\b|color\.halal|\b(?:bg|text|border)-halal/;
    expect(files.filter(([, code]) => raw.test(code.replace(/\/\*[\s\S]*?\*\//g, ''))).map(([f]) => f)).toEqual([]);
  });
});
