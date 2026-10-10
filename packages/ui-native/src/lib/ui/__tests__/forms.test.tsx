/**
 * Design-system N3 (forms) on the React Native Reusables tier, measured through the REAL
 * generated stylesheet (harness.ts): `/ds` Input, Checkbox, RadioGroup, Switch, Select,
 * SegmentedControl and `/proposed` CheckboxGroup, QuantityStepper, Textarea, DateInput,
 * ErrorSummary, in customer and rider × light and dark.
 *
 * Few and high-value: measured targets (44 / 52 / 56 / 72), focus as the field's own 2px border
 * in the focus role (never a ring), an invalid field keeps its danger border, danger colours
 * only in error states, and the halal seal green nowhere.
 */
import type { ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import * as ds from '../../../ds';
import * as proposed from '../../../proposed';
import { themes, tokens } from '../../../tokens';
import type { ColorScheme, ThemeName } from '../../../tokens';
import { SCHEMES, flat, hex, loadThemeCss, paintedColours, renderNw } from './harness';

const { Checkbox, Input, RadioGroup, Select, SegmentedControl, Switch } = ds;
const { CheckboxGroup, DateInput, ErrorSummary, QuantityStepper, Textarea } = proposed;

beforeAll(loadThemeCss, 120_000);

const SEAL = tokens.color.halal.certified.seal.toUpperCase();

function dangerColours(theme: ThemeName, scheme: ColorScheme): Set<string> {
  const t = themes[theme][scheme].color;
  return new Set<string>(
    [t.feedback.danger.tint, t.feedback.danger.tintText, t.feedback.danger.text, t.feedback.danger.icon, t.feedback.danger.border, t.feedback.danger.solid, t.action.danger].map(hex),
  );
}

const INPUT_VARIANTS = ['text', 'email', 'tel', 'numeric', 'password', 'search'] as const;

describe('Input', () => {
  it('renders every variant at md 44 and lg 52, and at the 56 field size on rider, light and dark', () => {
    for (const [theme, scheme] of SCHEMES) {
      for (const variant of INPUT_VARIANTS) {
        for (const size of ['md', 'lg'] as const) {
          const { unmount } = renderNw(<Input label="Field" variant={variant} size={size} defaultValue="41" />, { theme, scheme });
          const frame = flat(screen.getByTestId('Input-frame'));
          expect(frame.minHeight).toBe(theme === 'rider' ? 56 : { md: 44, lg: 52 }[size]);
          expect(hex(frame.backgroundColor)).toBe(hex(themes[theme][scheme].color.surface.raised));
          unmount();
        }
      }
    }
  });

  it('focus is the frame’s own 2px border in the focus role, with no ring; invalid keeps its danger border', () => {
    const c = themes.customer.light.color;
    renderNw(<Input label="Email" variant="email" />);
    const field = screen.getByTestId('Input-field');
    expect(flat(screen.getByTestId('Input-frame'))).toMatchObject({ borderWidth: 1 });
    expect(hex(flat(screen.getByTestId('Input-frame')).borderColor)).toBe(hex(c.border.interactive));
    fireEvent(field, 'focus');
    const focused = flat(screen.getByTestId('Input-frame'));
    expect(focused.borderWidth).toBe(2);
    expect(hex(focused.borderColor)).toBe(hex(c.focus.ring));
    expect(screen.queryByTestId('Input-focus-ring')).toBeNull();
    // The 1px -> 2px change is absorbed by padding: the text does not move.
    expect(focused.paddingLeft).toBe(11);

    renderNw(<Input label="Email" variant="email" errorText="Enter an email address" />);
    fireEvent(screen.getByTestId('Input-field'), 'focus');
    const invalid = flat(screen.getByTestId('Input-frame'));
    expect(invalid.borderWidth).toBe(2);
    expect(hex(invalid.borderColor)).toBe(hex(c.feedback.danger.border));
  });

  it('helper and error are linked; the error is an alert with a glyph; success is a check with no fill', () => {
    renderNw(<Input label="Phone" variant="tel" helperText="We text a code to sign you in." />);
    expect(screen.getByLabelText('Phone')).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.accessibilityHint).toBe('We text a code to sign you in.');
    expect(hex(flat(screen.getByText('We text a code to sign you in.')).color)).toBe(hex(themes.customer.light.color.text.secondary));

    renderNw(<Input label="Phone" variant="tel" errorText="Enter a 10-digit number" />);
    expect(screen.getByRole('alert', { name: 'Enter a 10-digit number' })).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.accessibilityHint).toBe('Enter a 10-digit number');

    const { toJSON } = renderNw(<Input label="Name" defaultValue="Amina" success />);
    expect(screen.getByTestId('Input-success')).toBeTruthy();
    const painted = paintedColours(toJSON());
    expect(painted).toContain(hex(themes.customer.light.color.feedback.success.text));
    // No green fill anywhere: success is a text-role glyph.
    const t = themes.customer.light.color.feedback.success;
    for (const node of [screen.getByTestId('Input-frame')]) expect(hex(flat(node).backgroundColor)).not.toBe(hex(t.icon));
  });

  it('tel shows the national number behind a fixed +1 and hands back digits; international stays as typed', () => {
    const onValueChange = jest.fn();
    renderNw(<Input label="Mobile number" variant="tel" onValueChange={onValueChange} />);
    const field = screen.getByTestId('Input-field');
    fireEvent.changeText(field, '+1 (416) 555-0134');
    expect(onValueChange).toHaveBeenLastCalledWith('4165550134');
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.value).toMatch(/^\(?416\)? 555[ -]0134$/);
    fireEvent.changeText(screen.getByTestId('Input-field'), '+44 7700 900123');
    expect(onValueChange).toHaveBeenLastCalledWith('+44 7700 900123');
    expect(screen.queryByText('+1')).toBeNull();
  });

  it('numeric hands back digits only; prefix, suffix and iconStart render; the counter announces what is left', () => {
    const onValueChange = jest.fn();
    renderNw(<Input label="Tip" variant="numeric" prefix="$" suffix="CAD" iconStart="star" onValueChange={onValueChange} />);
    fireEvent.changeText(screen.getByTestId('Input-field'), '1a2.5');
    expect(onValueChange).toHaveBeenLastCalledWith('125');
    expect(screen.getByText('$')).toBeTruthy();
    expect(screen.getByText('CAD')).toBeTruthy();

    renderNw(<Input label="Note" maxLength={10} characterCount value="12345678" />);
    const count = screen.getByTestId('Input-count');
    expect(count.props.children).toBe('8/10');
    expect(count.props.accessibilityLabel).toBe('2 characters remaining');
    expect(count.props.accessibilityLiveRegion).toBe('polite');
  });

  it('password masks with a 44pt Show control; loading shows a spinner and stays editable; disabled is not editable', () => {
    renderNw(<Input label="Password" variant="password" defaultValue="secret" />);
    expect(screen.getByTestId('Input-field').props.secureTextEntry).toBe(true);
    const reveal = screen.getByRole('button', { name: 'Show password' });
    expect(flat(reveal).minHeight).toBe(44);
    fireEvent.press(reveal);
    expect(screen.getByTestId('Input-field').props.secureTextEntry).toBe(false);

    renderNw(<Input label="Address" loading />);
    expect(screen.getByTestId('Input-spinner', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.editable).toBe(true);

    renderNw(<Input label="Address" disabled />);
    expect(screen.getByTestId('Input-field').props.editable).toBe(false);
    expect(flat(screen.getByTestId('Input-frame')).opacity).toBeCloseTo(0.6);
  });
});

describe('Input otp', () => {
  it.each([
    [6, 'customer', 52],
    [4, 'rider', 56],
  ] as const)('%i cells on %s: one real field, typed and pasted, digits only, named for the count', (cells, theme, cellH) => {
    const onValueChange = jest.fn();
    renderNw(<Input label={cells === 4 ? 'Handover code' : 'Sign-in code'} variant="otp" cells={cells} onValueChange={onValueChange} />, { theme });
    const field = screen.getByTestId('Input-field');
    expect(field.props.textContentType).toBe('oneTimeCode');
    expect(field.props.autoComplete).toBe('sms-otp');
    expect(field.props.maxLength).toBe(cells);
    expect(field.props.accessibilityLabel).toBe(`${cells === 4 ? 'Handover code' : 'Sign-in code'}, ${cells} digits`);
    // Exactly `cells` cells, hidden from assistive technology, at the measured height.
    for (let i = 0; i < cells; i++) {
      const cell = screen.getByTestId(`Input-cell-${i}`, { includeHiddenElements: true });
      expect(flat(cell).minHeight).toBe(cellH);
    }
    expect(screen.queryByTestId(`Input-cell-${cells}`, { includeHiddenElements: true })).toBeNull();
    // Typing one digit at a time.
    fireEvent.changeText(field, '4');
    expect(onValueChange).toHaveBeenLastCalledWith('4');
    // A paste of the whole message: digits only, cut to the cell count, and every cell fills.
    fireEvent.changeText(screen.getByTestId('Input-field'), 'Your code is 9-8-7-6-5-4-3');
    const expected = '9876543'.slice(0, cells);
    expect(onValueChange).toHaveBeenLastCalledWith(expected);
    for (let i = 0; i < cells; i++) {
      expect(screen.getByTestId(`Input-cell-${i}`, { includeHiddenElements: true })).toHaveTextContent(expected[i]!);
    }
    expect(screen.getByTestId('Input-field').props.accessibilityValue).toEqual({ text: expected.split('').join(' ') });
  });

  it('the active cell takes the focus border; an error turns every cell danger and is one alert', () => {
    const c = themes.customer.light.color;
    renderNw(<Input label="Sign-in code" variant="otp" value="12" />);
    fireEvent(screen.getByTestId('Input-field'), 'focus');
    const active = flat(screen.getByTestId('Input-cell-2', { includeHiddenElements: true }));
    expect(active.borderWidth).toBe(2);
    expect(hex(active.borderColor)).toBe(hex(c.focus.ring));
    renderNw(<Input label="Sign-in code" variant="otp" value="123456" errorText="That code is not right. 2 tries left." />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(hex(flat(screen.getByTestId('Input-cell-0', { includeHiddenElements: true })).borderColor)).toBe(hex(c.feedback.danger.border));
  });
});

describe('Checkbox, RadioGroup, CheckboxGroup', () => {
  it('rows are 44, 56 on rider, and roomy radio rows are 72 in both themes', () => {
    for (const theme of ['customer', 'rider'] as const) {
      const row = theme === 'rider' ? 56 : 44;
      const a = renderNw(<Checkbox label="Extra garlic sauce" />, { theme });
      expect(flat(screen.getByRole('checkbox')).minHeight).toBe(row);
      a.unmount();
      const b = renderNw(<RadioGroup label="Size" value={null} options={[{ value: 'r', label: 'Regular' }]} />, { theme });
      expect(flat(screen.getByRole('radio')).minHeight).toBe(row);
      b.unmount();
      const c = renderNw(<RadioGroup label="Size" roomy value={null} options={[{ value: 'r', label: 'Regular' }]} />, { theme });
      expect(flat(screen.getByRole('radio')).minHeight).toBe(72);
      c.unmount();
      const d = renderNw(<CheckboxGroup label="Add-ons" value={[]} options={[{ value: 'g', label: 'Garlic' }]} />, { theme });
      expect(flat(screen.getByRole('checkbox')).minHeight).toBe(row);
      d.unmount();
    }
  });

  it('checked is the brand control fill with an on-brand tick, never green; indeterminate is "mixed"', () => {
    for (const [theme, scheme] of SCHEMES) {
      const { unmount } = renderNw(<Checkbox label="Select all" checked size={24} />, { theme, scheme });
      const box = flat(screen.getByTestId('Checkbox-box', { includeHiddenElements: true }));
      expect(hex(box.backgroundColor)).toBe(hex(themes[theme][scheme].color.action.control));
      expect([box.width, box.height]).toEqual([24, 24]);
      unmount();
    }
    renderNw(<Checkbox label="Select all 24 restaurants" indeterminate />);
    expect(screen.getByRole('checkbox').props.accessibilityState).toMatchObject({ checked: 'mixed' });
  });

  it('a disabled option stays focusable, says why, and swallows presses', () => {
    const onValueChange = jest.fn();
    renderNw(
      <RadioGroup
        label="Size"
        value="r"
        onValueChange={onValueChange}
        options={[
          { value: 'r', label: 'Regular' },
          { value: 'f', label: 'Family', disabled: true, disabledReason: 'Out of stock' },
        ]}
      />,
    );
    const family = screen.getByRole('radio', { name: 'Family' });
    expect(family.props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    expect(family.props.accessible).not.toBe(false);
    expect(family.props.accessibilityHint).toBe('Out of stock');
    expect(hex(flat(screen.getByText('Out of stock')).color)).toBe(hex(themes.customer.light.color.text.secondary));
    fireEvent.press(family);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('switch, segmented and select reach the measured targets on both themes', () => {
    for (const theme of ['customer', 'rider'] as const) {
      const r = theme === 'rider';
      const a = renderNw(<Switch label="Online" stateLabel={{ on: 'Online', off: 'Offline' }} checked={false} />, { theme });
      expect(flat(screen.getByRole('switch')).minHeight).toBe(r ? 56 : 44);
      a.unmount();
      for (const size of ['sm', 'md', 'lg'] as const) {
        const b = renderNw(
          <SegmentedControl label="Period" size={size} value="d" options={[{ value: 'd', label: 'Day' }, { value: 'w', label: 'Week' }]} />,
          { theme },
        );
        const seg = screen.getByRole('radio', { name: 'Week' });
        expect(flat(seg).minHeight).toBe(r ? 56 : { sm: 36, md: 44, lg: 52 }[size]);
        if (!r && size === 'sm') expect(seg.props.hitSlop).toEqual({ top: 4, bottom: 4 });
        b.unmount();
      }
      const c = renderNw(<Select label="Province" value={null} options={[{ value: 'ON', label: 'Ontario' }]} />, { theme });
      expect(flat(screen.getByTestId('Select-trigger')).minHeight).toBe(r ? 56 : 44);
      c.unmount();
      for (const size of ['sm', 'md', 'lg'] as const) {
        const d = renderNw(<QuantityStepper value={2} onChange={() => {}} size={size} />, { theme });
        const plus = flat(screen.getByRole('button', { name: 'Increase quantity' }));
        const px = r ? 56 : { sm: 36, md: 44, lg: 56 }[size];
        expect([plus.minHeight, plus.minWidth]).toEqual([px, px]);
        d.unmount();
      }
    }
  });

  it('switch: on is the track-on role, off is border.strong; loading holds the position', () => {
    const c = themes.customer.light.color;
    const onCheckedChange = jest.fn();
    renderNw(<Switch label="Online" stateLabel={{ on: 'Online', off: 'Offline' }} checked onCheckedChange={onCheckedChange} />);
    expect(hex(flat(screen.getByTestId('Switch-track', { includeHiddenElements: true })).backgroundColor)).toBe(hex(c.action.trackOn));
    renderNw(<Switch label="Online" stateLabel={{ on: 'Online', off: 'Offline' }} checked={false} loading onCheckedChange={onCheckedChange} />);
    const track = () => flat(screen.getByTestId('Switch-track', { includeHiddenElements: true }));
    expect(hex(track().backgroundColor)).toBe(hex(c.border.strong));
    expect(track().justifyContent).toBe('flex-start');
    const sw = screen.getByRole('switch', { name: 'Online' });
    expect(sw.props.accessibilityState).toMatchObject({ busy: true, checked: false });
    fireEvent.press(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(track().justifyContent).toBe('flex-start');
    expect(screen.getByText('Offline')).toBeTruthy();
  });
});

describe('colour invariants across customer and rider × light and dark', () => {
  const calm = (): ReactElement[] => [
    <Input key="i" label="Email" variant="email" helperText="For receipts" success defaultValue="a@b.co" />,
    <Input key="o" label="Code" variant="otp" cells={4} value="12" />,
    <Input key="p" label="Password" variant="password" loading />,
    <Checkbox key="c" label="Extra garlic sauce" checked priceDeltaCents={150} />,
    <Checkbox key="cd" label="Falafel" disabled disabledReason="Out of stock" />,
    <RadioGroup key="r" label="Size" roomy value="l" options={[{ value: 'r', label: 'Regular' }, { value: 'l', label: 'Large', priceDeltaCents: 250 }]} />,
    <CheckboxGroup key="cg" label="Add-ons" max={1} value={['a']} options={[{ value: 'a', label: 'Hummus', priceDeltaCents: 200 }, { value: 'b', label: 'Pickles' }]} />,
    <Switch key="s" label="Online" stateLabel={{ on: 'Online', off: 'Offline' }} checked loading />,
    <Select key="se" label="Province" value="ON" options={[{ value: 'ON', label: 'Ontario' }]} />,
    <SegmentedControl key="sc" label="Fulfilment" tone="chrome" value="d" options={[{ value: 'd', label: 'Delivery' }, { value: 'p', label: 'Pickup' }]} />,
    <SegmentedControl key="sl" label="Period" value="d" options={[{ value: 'd', label: 'Day', icon: 'clock' }, { value: 'w', label: 'Week' }]} />,
    <QuantityStepper key="q" value={4} max={4} maxReason="Only 4 left today" onChange={() => {}} />,
    <QuantityStepper key="qt" variant="tonal" value={1} removeAtZero itemName="Mango lassi" onChange={() => {}} />,
    <Textarea key="t" label="Reason" maxLength={500} defaultValue="Gate code missing" />,
    <DateInput key="d" label="Date of birth" defaultValue="1990-04-12" />,
  ];

  it('no danger colour outside an error state, and never the seal green', () => {
    for (const [theme, scheme] of SCHEMES) {
      const danger = dangerColours(theme, scheme);
      for (const node of calm()) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        const painted = paintedColours(toJSON());
        expect(painted.filter((c) => danger.has(c))).toEqual([]);
        expect(painted).not.toContain(SEAL);
        unmount();
      }
      // Error states paint danger, and still never the seal.
      const errors = [
        <Input key="e" label="Email" errorText="Enter an email address" />,
        <RadioGroup key="re" label="Size" value={null} error="Choose a size" options={[{ value: 'r', label: 'Regular' }]} />,
        <ErrorSummary key="es" errors={[{ message: 'Enter your date of birth' }]} />,
      ];
      for (const node of errors) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        const painted = paintedColours(toJSON());
        expect(painted.some((c) => danger.has(c))).toBe(true);
        expect(painted).not.toContain(SEAL);
        unmount();
      }
    }
  });
});
