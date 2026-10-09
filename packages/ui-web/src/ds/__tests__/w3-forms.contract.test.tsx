/**
 * W3 Forms contract: every rebuilt form component, in every state the live index.d.ts and the
 * approval packet declare, renders with the accessible role and name its README specifies,
 * reports disabled and busy through ARIA (still focusable), and keeps its 44px (or 56/72px)
 * target. Then the behaviour that carries an invariant or a README rule: event shapes,
 * announcements, the switch that holds its position, the group-level error, FileDrop's checks.
 * MoneyInput's integer-cents invariant has its own file.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as ds from '../index';
import * as proposed from '../../proposed/index';

interface Case {
  name: string;
  ui: ReactElement;
  role: string;
  accessibleName: string | RegExp;
  /** Extra checks on the found element. */
  check?: (el: HTMLElement) => void;
  /** A class that sets the target size, on the element or an ancestor within the specimen. */
  target?: RegExp;
}

const noop = () => {};

function hasTarget(el: HTMLElement, re: RegExp, root: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== root.parentElement) {
    if (re.test(node.className)) return true;
    node = node.parentElement;
  }
  return false;
}

const CASES: Case[] = [
  /* Input */
  { name: 'Input default', ui: <ds.Input label="Email" variant="email" />, role: 'textbox', accessibleName: 'Email', target: /min-h-11/ },
  { name: 'Input lg', ui: <ds.Input label="Name" size="lg" />, role: 'textbox', accessibleName: 'Name', target: /min-h-13/ },
  { name: 'Input field size', ui: <ds.Input label="Name" size="field" />, role: 'textbox', accessibleName: 'Name', target: /min-h-14/ },
  {
    name: 'Input error',
    ui: <ds.Input label="Email" errorText="Enter a valid email address" />,
    role: 'textbox',
    accessibleName: 'Email',
    check: (el) => {
      expect(el).toHaveAttribute('aria-invalid', 'true');
      expect(el).toHaveAccessibleDescription(/Enter a valid email address/);
    },
  },
  {
    name: 'Input disabled',
    ui: <ds.Input label="Legal name" disabled defaultValue="Zaytoun Grill Inc." />,
    role: 'textbox',
    accessibleName: 'Legal name',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
    },
  },
  {
    name: 'Input loading',
    ui: <ds.Input label="Instructions" loading />,
    role: 'textbox',
    accessibleName: 'Instructions',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  { name: 'Input required', ui: <ds.Input label="Phone" variant="tel" required />, role: 'textbox', accessibleName: /Phone/, check: (el) => expect(el).toBeRequired() },
  { name: 'Input search', ui: <ds.Input label="Search" variant="search" />, role: 'searchbox', accessibleName: 'Search' },
  { name: 'Input readOnly', ui: <ds.Input label="Restaurant ID" readOnly defaultValue="rst_1" />, role: 'textbox', accessibleName: 'Restaurant ID', check: (el) => expect(el).toHaveAttribute('readonly') },
  {
    name: 'Input otp 6',
    ui: <ds.Input label="Sign-in code" variant="otp" />,
    role: 'textbox',
    accessibleName: 'Sign-in code',
    check: (el) => {
      expect(el).toHaveAttribute('maxlength', '6');
      expect(el).toHaveAttribute('autocomplete', 'one-time-code');
    },
  },
  { name: 'Input otp 4', ui: <ds.Input label="Handover code" variant="otp" otpLength={4} />, role: 'textbox', accessibleName: 'Handover code', check: (el) => expect(el).toHaveAttribute('maxlength', '4') },
  /* Select */
  { name: 'Select native', ui: <ds.Select label="Province" options={[{ value: 'ON', label: 'Ontario' }]} />, role: 'combobox', accessibleName: 'Province', target: /min-h-11/ },
  {
    name: 'Select native disabled',
    ui: <ds.Select label="Province" disabled options={[{ value: 'ON', label: 'Ontario' }]} />,
    role: 'combobox',
    accessibleName: 'Province',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
    },
  },
  { name: 'Select native loading', ui: <ds.Select label="Cuisine" loading options={[]} />, role: 'combobox', accessibleName: 'Cuisine', check: (el) => expect(el).toHaveAttribute('aria-busy', 'true') },
  {
    name: 'Select listbox',
    ui: <ds.Select label="Certifying body" variant="listbox" options={[{ value: 'hma', label: 'HMA' }]} value="hma" />,
    role: 'combobox',
    accessibleName: /Certifying body/,
    check: (el) => {
      expect(el).toHaveAttribute('aria-expanded', 'false');
      expect(el).toHaveAttribute('aria-controls');
      expect(el).toHaveAttribute('aria-haspopup', 'listbox');
    },
    target: /min-h-11/,
  },
  {
    name: 'Select listbox error',
    ui: <ds.Select label="Body" variant="listbox" errorText="Choose a body" options={[]} />,
    role: 'combobox',
    accessibleName: /Body/,
    check: (el) => expect(el).toHaveAttribute('aria-invalid', 'true'),
  },
  /* Checkbox */
  { name: 'Checkbox', ui: <ds.Checkbox label="Text me" />, role: 'checkbox', accessibleName: 'Text me', target: /min-h-11/ },
  {
    name: 'Checkbox indeterminate',
    ui: <ds.Checkbox label="Select all" indeterminate />,
    role: 'checkbox',
    accessibleName: 'Select all',
    check: (el) => expect((el as HTMLInputElement).indeterminate).toBe(true),
  },
  {
    name: 'Checkbox disabled with reason',
    ui: <ds.Checkbox label="Add falafel" disabled disabledReason="Out of stock" />,
    role: 'checkbox',
    accessibleName: 'Add falafel',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
      expect(el).toHaveAccessibleDescription('Out of stock');
    },
  },
  {
    name: 'Checkbox error',
    ui: <ds.Checkbox label="I agree" error="Agree to continue" />,
    role: 'checkbox',
    accessibleName: 'I agree',
    check: (el) => {
      expect(el).toHaveAttribute('aria-invalid', 'true');
      expect(el).toHaveAccessibleDescription(/Agree to continue/);
    },
  },
  /* RadioGroup */
  { name: 'RadioGroup', ui: <ds.RadioGroup label="Size" value={null} options={[{ value: 'r', label: 'Regular' }]} />, role: 'radiogroup', accessibleName: 'Size' },
  {
    name: 'RadioGroup error',
    ui: <ds.RadioGroup label="Size" value={null} error="Choose a size" options={[{ value: 'r', label: 'Regular' }]} />,
    role: 'radiogroup',
    accessibleName: 'Size',
    check: (el) => {
      expect(el).toHaveAttribute('aria-invalid', 'true');
      expect(el).toHaveAccessibleDescription(/Choose a size/);
    },
  },
  {
    name: 'RadioGroup disabled',
    ui: <ds.RadioGroup label="Size" value="r" disabled options={[{ value: 'r', label: 'Regular' }]} />,
    role: 'radiogroup',
    accessibleName: 'Size',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(within(el).getByRole('radio')).not.toBeDisabled();
    },
  },
  { name: 'Radio row', ui: <ds.RadioGroup label="Tip" value="15" options={[{ value: '15', label: '15%' }]} />, role: 'radio', accessibleName: '15%', target: /min-h-11/ },
  { name: 'Radio roomy row', ui: <ds.RadioGroup label="Tip" roomy value="15" options={[{ value: '15', label: '15%' }]} />, role: 'radio', accessibleName: '15%', target: /min-h-18/ },
  /* Switch */
  { name: 'Switch md', ui: <ds.Switch label="Accepting orders" stateLabel={{ on: 'Open', off: 'Closed' }} checked />, role: 'switch', accessibleName: 'Accepting orders', target: /after:min-h-11/ },
  { name: 'Switch sm', ui: <ds.Switch label="Available" size="sm" stateLabel={{ on: 'Available', off: 'Sold out' }} checked={false} />, role: 'switch', accessibleName: 'Available', target: /after:min-h-11/ },
  {
    name: 'Switch disabled',
    ui: <ds.Switch label="Item available" stateLabel={{ on: 'Available', off: 'Sold out' }} checked={false} disabled />,
    role: 'switch',
    accessibleName: 'Item available',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
    },
  },
  {
    name: 'Switch loading',
    ui: <ds.Switch label="Online" stateLabel={{ on: 'Online', off: 'Offline' }} checked={false} loading />,
    role: 'switch',
    accessibleName: 'Online',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  /* SegmentedControl */
  {
    name: 'SegmentedControl',
    ui: <ds.SegmentedControl label="Fulfilment" value="delivery" options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pickup' }]} />,
    role: 'radiogroup',
    accessibleName: 'Fulfilment',
  },
  {
    name: 'SegmentedControl sm segment',
    ui: <ds.SegmentedControl label="Mode" size="sm" tone="chrome" value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    role: 'radio',
    accessibleName: 'A',
    check: (el) => expect(el).toHaveAttribute('aria-checked', 'true'),
    target: /after:min-h-11/,
  },
  { name: 'SegmentedControl lg segment', ui: <ds.SegmentedControl label="Mode" size="lg" value="a" options={[{ value: 'a', label: 'A' }]} />, role: 'radio', accessibleName: 'A', target: /min-h-13/ },
  /* FileDrop */
  { name: 'FileDrop idle', ui: <ds.FileDrop label="business licence" acceptDescription="PDF, up to 10 MB." />, role: 'button', accessibleName: 'Upload file: business licence' },
  {
    name: 'FileDrop uploading',
    ui: <ds.FileDrop label="business licence" status="uploading" fileName="licence.pdf" progress={40} />,
    role: 'progressbar',
    accessibleName: 'Uploading licence.pdf',
    check: (el) => expect(el).toHaveAttribute('aria-valuenow', '40'),
  },
  { name: 'FileDrop failed', ui: <ds.FileDrop label="business licence" status="failed" onRetry={noop} errorText="The upload didn’t finish" />, role: 'alert', accessibleName: '' },
  /* Proposed */
  { name: 'Field', ui: <proposed.Field label="Issuer" helperText="From the registry"><input /></proposed.Field>, role: 'textbox', accessibleName: 'Issuer', check: (el) => expect(el).toHaveAccessibleDescription('From the registry') },
  { name: 'ErrorSummary', ui: <proposed.ErrorSummary errors={[{ fieldId: 'x', message: 'Enter your name' }]} />, role: 'link', accessibleName: 'Enter your name', target: /min-h-11/ },
  { name: 'Textarea', ui: <proposed.Textarea label="What happened" characterCount maxLength={1000} />, role: 'textbox', accessibleName: 'What happened' },
  {
    name: 'Textarea disabled',
    ui: <proposed.Textarea label="Note" disabled />,
    role: 'textbox',
    accessibleName: 'Note',
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el).not.toBeDisabled();
    },
  },
  { name: 'CheckboxGroup', ui: <proposed.CheckboxGroup label="Documents to redo" value={[]} options={[{ value: 'a', label: 'Licence' }]} error="Choose at least one document" />, role: 'group', accessibleName: 'Documents to redo', check: (el) => expect(el).toHaveAccessibleDescription(/Choose at least one document/) },
  { name: 'DateInput', ui: <proposed.DateInput label="Date of birth" value={null} onValueChange={noop} />, role: 'group', accessibleName: 'Date of birth' },
  { name: 'DateInput day', ui: <proposed.DateInput label="Date of birth" value={null} onValueChange={noop} />, role: 'textbox', accessibleName: 'Day', target: /min-h-11/ },
  { name: 'TimeField', ui: <proposed.TimeField label="Opens" value="21:30" onValueChange={noop} />, role: 'group', accessibleName: 'Opens', check: (el) => expect(el).toHaveTextContent('Set to 9:30 pm') },
  { name: 'MoneyInput', ui: <proposed.MoneyInput label="Goodwill amount" valueCents={null} onValueChange={noop} />, role: 'textbox', accessibleName: 'Goodwill amount', target: /min-h-11/ },
  { name: 'Stepper full', ui: <proposed.Stepper steps={[{ id: 'a', label: 'Profile', status: 'done' }, { id: 'b', label: 'Documents', status: 'current' }]} />, role: 'navigation', accessibleName: 'Progress' },
  { name: 'Stepper compact', ui: <proposed.Stepper variant="compact" label="Setup progress" steps={[{ id: 'a', label: 'Profile', status: 'done' }, { id: 'b', label: 'Documents', status: 'current' }]} />, role: 'progressbar', accessibleName: 'Setup progress', check: (el) => expect(el).toHaveAttribute('aria-valuenow', '50') },
  { name: 'InlineConfirm', ui: <proposed.InlineConfirm prompt="Turn off new orders?" confirmLabel="Turn off" onConfirm={noop} onCancel={noop} />, role: 'group', accessibleName: 'Turn off new orders?' },
];

describe('W3 Forms contract', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s renders with its role, name and target', (_name, c) => {
    const { container } = render(c.ui);
    const el = c.accessibleName === '' ? screen.getAllByRole(c.role)[0]! : screen.getAllByRole(c.role, { name: c.accessibleName })[0]!;
    expect(el).toBeInTheDocument();
    c.check?.(el);
    if (c.target) expect(hasTarget(el, c.target, container as HTMLElement), `${c.name} target ${c.target}`).toBe(true);
  });

  it('every component defaults data-testid to its own name', () => {
    const { container } = render(
      <>
        <ds.Input label="a" />
        <ds.Select label="b" options={[]} />
        <ds.Checkbox label="c" />
        <ds.RadioGroup label="d" value={null} options={[]} />
        <ds.Switch label="e" stateLabel={{ on: 'On', off: 'Off' }} checked={false} />
        <ds.SegmentedControl label="f" value="x" options={[{ value: 'x', label: 'X' }]} />
        <ds.FileDrop label="g" />
        <proposed.Textarea label="h" />
        <proposed.MoneyInput label="i" valueCents={null} onValueChange={noop} />
      </>,
    );
    for (const id of ['Input', 'Select', 'Checkbox', 'RadioGroup', 'Switch', 'SegmentedControl', 'FileDrop', 'Textarea', 'MoneyInput']) {
      expect(container.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });
});

describe('W3 Forms behaviour', () => {
  it('Input announces remaining characters at 80% and at the limit, and cleans numeric input', () => {
    const onValueChange = vi.fn();
    function Counted() {
      const [v, setV] = useState('');
      return <ds.Input label="Note" maxLength={10} characterCount value={v} onValueChange={setV} />;
    }
    render(
      <>
        <Counted />
        <ds.Input label="Amount" variant="numeric" onValueChange={onValueChange} />
      </>,
    );
    const note = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: '1234567' } });
    expect(screen.getByText('7/10')).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('');
    fireEvent.change(note, { target: { value: '12345678' } });
    expect(screen.getByText('2 characters left.')).toBeInTheDocument();
    fireEvent.change(note, { target: { value: '1234567890' } });
    expect(screen.getByText('Character limit reached.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '1a2b' } });
    expect(onValueChange).toHaveBeenLastCalledWith('12');
  });

  it('a disabled Input ignores typing', () => {
    const onValueChange = vi.fn();
    render(<ds.Input label="Name" disabled onValueChange={onValueChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'x' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('Select native passes the event to onChange; listbox passes the value; both pass the value to onValueChange', () => {
    const nativeChange = vi.fn();
    const nativeValue = vi.fn();
    render(
      <ds.Select
        label="Province"
        onChange={nativeChange}
        onValueChange={nativeValue}
        options={[
          { value: 'ON', label: 'Ontario', group: 'Launch' },
          { value: 'QC', label: 'Quebec', group: 'Later', disabled: true },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Province' });
    expect(select.querySelectorAll('optgroup')).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'ON' } });
    expect(nativeChange.mock.calls[0]?.[0]).toHaveProperty('target');
    expect(nativeValue).toHaveBeenCalledWith('ON');
  });

  it('Select listbox opens a searchable listbox, filters, and hands onChange the value', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ds.Select
        label="Certifying body"
        variant="listbox"
        searchable
        value={null}
        onChange={onChange}
        onValueChange={onValueChange}
        options={[
          { value: 'hma', label: 'Halal Monitoring Authority', description: 'Ontario' },
          { value: 'isna', label: 'ISNA Canada Halal' },
        ]}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: /Certifying body/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search certifying body' }), { target: { value: 'isna' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option', { name: /ISNA/ }));
    expect(onChange).toHaveBeenCalledWith('isna');
    expect(onValueChange).toHaveBeenCalledWith('isna');
  });

  it('Select listbox shows skeleton rows while loading and emptyText with no options, never an empty list', () => {
    const { unmount } = render(<ds.Select label="Cuisine" variant="listbox" loading options={[]} />);
    fireEvent.click(screen.getByRole('combobox', { name: /Cuisine/ }));
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('Select-loading')).toBeInTheDocument();
    unmount();
    render(<ds.Select label="Cuisine" variant="listbox" emptyText="No cuisines yet" options={[]} />);
    fireEvent.click(screen.getByRole('combobox', { name: /Cuisine/ }));
    expect(screen.getByText('No cuisines yet')).toBeInTheDocument();
  });

  it('Checkbox hands onChange the event and onCheckedChange the boolean; disabled ignores clicks; price delta is signed', async () => {
    const onChange = vi.fn();
    const onCheckedChange = vi.fn();
    render(
      <>
        <ds.Checkbox label="Garlic sauce" priceDeltaCents={150} onChange={onChange} onCheckedChange={onCheckedChange} />
        <ds.Checkbox label="Falafel" disabled onCheckedChange={onCheckedChange} />
      </>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /^Garlic sauce/ }));
    expect(onChange.mock.calls[0]?.[0]).toHaveProperty('target');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/\+\$1\.50/)).toBeInTheDocument();
    onCheckedChange.mockClear();
    const falafel = screen.getByRole('checkbox', { name: 'Falafel' });
    fireEvent.click(falafel);
    await act(async () => {});
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(falafel).not.toBeChecked();
  });

  it('RadioGroup accepts <Radio> children, announces its error on the group, and passes value and event', () => {
    const onChange = vi.fn();
    render(
      <ds.RadioGroup label="Size" value={null} onChange={onChange} error="Choose a size">
        <ds.Radio value="r" label="Regular" />
        <ds.Radio value="l" label="Large" priceDeltaCents={250} />
        <ds.Radio value="f" label="Family" disabled disabledReason="Out of stock" />
      </ds.RadioGroup>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Size' });
    const alert = screen.getByRole('alert');
    expect(group).toContainElement(alert);
    expect(screen.getAllByRole('radio').every((r) => !r.hasAttribute('aria-describedby') || !r.getAttribute('aria-describedby')!.includes(alert.id))).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Large/ }));
    expect(onChange).toHaveBeenCalledWith('l', expect.objectContaining({ target: expect.anything() }));
    expect(screen.getByRole('radio', { name: 'Family' })).toHaveAccessibleDescription('Out of stock');
  });

  it('Switch holds its position while loading and ignores presses; state words are visible', () => {
    const onCheckedChange = vi.fn();
    const onChange = vi.fn();
    render(
      <ds.Switch
        label="Online for deliveries"
        stateLabel={{ on: 'Online', off: 'Offline' }}
        checked={false}
        loading
        onCheckedChange={onCheckedChange}
        onChange={onChange}
      />,
    );
    const sw = screen.getByRole('switch', { name: 'Online for deliveries' });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Offline')).toBeVisible();
  });

  it('Switch reports a missing stateLabel and still shows words', () => {
    const report = vi.fn();
    ds.setClientErrorReporter(report);
    render(<ds.Switch label="Flag" stateLabel={undefined as never} checked />);
    expect(report).toHaveBeenCalledWith('SWITCH_STATE_LABEL_MISSING', expect.anything());
    expect(screen.getByText('On')).toBeInTheDocument();
    ds.setClientErrorReporter(null);
  });

  it('SegmentedControl selects on arrow keys (selection follows focus) and never deselects', () => {
    function Seg() {
      const [v, setV] = useState('delivery');
      return (
        <ds.SegmentedControl
          label="Fulfilment"
          value={v}
          onChange={setV}
          options={[
            { value: 'delivery', label: 'Delivery' },
            { value: 'pickup', label: 'Pickup' },
          ]}
        />
      );
    }
    render(<Seg />);
    const delivery = screen.getByRole('radio', { name: 'Delivery' });
    fireEvent.click(delivery);
    expect(delivery).toHaveAttribute('aria-checked', 'true');
    act(() => screen.getByRole('radio', { name: 'Pickup' }).focus());
    expect(screen.getByRole('radio', { name: 'Pickup' })).toHaveAttribute('aria-checked', 'true');
  });

  it('FileDrop refuses a file of the wrong type or over the limit before onFileSelect, and says why', () => {
    const onFileSelect = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <ds.FileDrop
        label="business licence"
        accept={['application/pdf', '.jpg']}
        maxSizeBytes={10 * 1024 * 1024}
        acceptDescription="PDF or JPG, up to 10 MB."
        onFileSelect={onFileSelect}
        onReject={onReject}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const exe = new File(['x'], 'virus.exe', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [exe] } });
    expect(onReject).toHaveBeenLastCalledWith('FILE_TYPE_NOT_ACCEPTED', exe);
    expect(screen.getByRole('alert')).toHaveTextContent(/isn’t accepted/);
    const big = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(onReject).toHaveBeenLastCalledWith('FILE_TOO_LARGE', big);
    expect(screen.getByRole('alert')).toHaveTextContent('The limit is 10 MB.');
    const ok = new File(['x'], 'licence.JPG', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [ok] } });
    expect(onFileSelect).toHaveBeenCalledWith(ok);
    expect(onFileSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CheckboxGroup caps at max with a stated reason and keeps option order', async () => {
    function Group() {
      const [v, setV] = useState<string[]>(['b']);
      return (
        <proposed.CheckboxGroup
          label="Cuisines"
          min={1}
          max={2}
          value={v}
          onValueChange={setV}
          options={[
            { value: 'a', label: 'Afghan' },
            { value: 'b', label: 'Bangladeshi' },
            { value: 'c', label: 'Chinese' },
          ]}
        />
      );
    }
    render(<Group />);
    expect(screen.getByText('Choose 1 to 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Afghan' }));
    const chinese = screen.getByRole('checkbox', { name: 'Chinese' });
    expect(chinese).toHaveAttribute('aria-disabled', 'true');
    expect(chinese).toHaveAccessibleDescription('You can choose up to 2');
    fireEvent.click(chinese);
    await act(async () => {});
    expect(chinese).not.toBeChecked();
  });

  it('DateInput emits a date only when real and in range, and says what is wrong', () => {
    const onValueChange = vi.fn();
    render(<proposed.DateInput label="Expiry" value={null} min="2026-10-12" onValueChange={onValueChange} />);
    const day = screen.getByRole('textbox', { name: 'Day' });
    const month = screen.getByRole('textbox', { name: 'Month' });
    const year = screen.getByRole('textbox', { name: 'Year' });
    fireEvent.change(day, { target: { value: '31' } });
    fireEvent.change(month, { target: { value: '2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(year, { target: { value: '2027' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Feb 2027 has no day 31.');
    expect(day).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(day, { target: { value: '1' } });
    fireEvent.change(month, { target: { value: '1' } });
    fireEvent.change(year, { target: { value: '2026' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a date on or after 12 Oct 2026.');
    fireEvent.change(year, { target: { value: '2027' } });
    expect(onValueChange).toHaveBeenLastCalledWith('2027-01-01');
  });

  it('TimeField converts 12-hour entry to HH:mm and reads it back through the shared formatter', () => {
    const onValueChange = vi.fn();
    render(<proposed.TimeField label="Closes" value={null} minuteStep={15} onValueChange={onValueChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Hour' }), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Minute' }), { target: { value: '10' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Use 15-minute steps');
    fireEvent.change(screen.getByRole('textbox', { name: 'Minute' }), { target: { value: '45' } });
    expect(onValueChange).toHaveBeenLastCalledWith('00:45');
    fireEvent.click(screen.getByRole('radio', { name: 'pm' }));
    expect(onValueChange).toHaveBeenLastCalledWith('12:45');
    expect(proposed.formatClockTime('00:05')).toBe('12:05 am');
    expect(proposed.formatClockTime('13:30')).toBe('1:30 pm');
  });

  it('ErrorSummary takes focus and its links focus the field', () => {
    render(
      <>
        <proposed.ErrorSummary errors={[{ fieldId: 'name', message: 'Enter your name' }]} />
        <input id="name" aria-label="Name" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
    fireEvent.click(screen.getByRole('link', { name: 'Enter your name' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('InlineConfirm focuses the decisive button, cancels on Escape and returns focus', () => {
    function Host() {
      const [asking, setAsking] = useState(false);
      return (
        <>
          <button onClick={() => setAsking(true)}>Turn off new orders</button>
          {asking ? (
            <proposed.InlineConfirm prompt="Turn off new orders?" confirmLabel="Turn off" onConfirm={noop} onCancel={() => setAsking(false)} />
          ) : null}
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Turn off new orders' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Turn off' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Turn off new orders?' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Turn off new orders?' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Textarea keeps the pre-rebuild onChange(value, event) signature', () => {
    const onChange = vi.fn();
    render(<proposed.Textarea label="Reason" value="" onChange={onChange} minLength={10} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'abc' } });
    expect(onChange.mock.calls[0]?.[0]).toBe('abc');
    expect(onChange.mock.calls[0]?.[1]).toHaveProperty('target');
    expect(screen.getByText('10 more characters needed')).toBeInTheDocument();
  });
});
