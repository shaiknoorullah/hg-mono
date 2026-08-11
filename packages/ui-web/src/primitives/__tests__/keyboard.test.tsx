import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from '../Button.js';
import { Input } from '../Input.js';
import { Select } from '../Select.js';
import { Checkbox } from '../Checkbox.js';
import { RadioGroup } from '../Radio.js';
import { Switch } from '../Switch.js';
import { Chip } from '../Chip.js';
import { Popover } from '../Popover.js';
import { Tooltip, TooltipProvider } from '../Tooltip.js';
import { ToastProvider, useToast } from '../Toast.js';

/**
 * One render + keyboard test per interactive primitive.
 *
 * 04-accessibility.md §2: "Pointer surfaces (restaurant web, admin) must be
 * FULLY OPERABLE BY KEYBOARD ALONE; no action is hover-only." These tests are
 * the standing proof of that claim. Each one drives the control the way a
 * keyboard user would — Tab to it, then the key that activates it — rather
 * than clicking, because a click test passes on a control that no keyboard can
 * reach.
 */

describe('Button', () => {
  it('is reachable by Tab and activates on Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Accept order</Button>);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Accept order' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('while loading, keeps its label and blocks re-entry', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Accept order
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Accept order/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    // Loading is not disabled: it stays focusable and keeps its name.
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when disabled, stays in the tab order so it can explain itself', async () => {
    const user = userEvent.setup();
    render(<Button disabled>Go offline</Button>);
    await user.tab();
    // aria-disabled, not the disabled attribute (04-accessibility.md §5).
    expect(screen.getByRole('button', { name: 'Go offline' })).toHaveFocus();
  });
});

describe('Input', () => {
  it('types from the keyboard and links label, error and description', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState('');
      return (
        <Input
          label="Delivery instructions"
          value={value}
          onChange={setValue}
          errorText={value.length > 5 ? 'Too long' : undefined}
        />
      );
    }
    render(<Harness />);

    await user.tab();
    const field = screen.getByLabelText('Delivery instructions');
    expect(field).toHaveFocus();

    await user.keyboard('Buzz 4');
    expect(field).toHaveValue('Buzz 4');
    expect(field).toHaveAttribute('aria-invalid', 'true');

    // The error is announced, is linked, and is never colour-only.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Too long');
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
  });
});

describe('Select', () => {
  const options = [
    { value: 'hma', label: 'Halal Monitoring Authority' },
    { value: 'isna', label: 'ISNA Canada' },
    { value: 'hfa', label: 'Halal Food Authority' },
  ];

  it('native variant: reachable by Tab and settable from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Certifying body" options={options} onChange={onChange} />);

    await user.tab();
    const select = screen.getByLabelText('Certifying body');
    expect(select).toHaveFocus();

    await user.selectOptions(select, 'isna');
    expect(onChange).toHaveBeenCalledWith('isna');
  });

  it('listbox variant: opens from the keyboard and Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Select variant="listbox" label="Certifying body" options={options} />);

    await user.tab();
    const trigger = screen.getByTestId('hg-select');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // 04-accessibility.md §4.2 — focus returns to the trigger on close.
    expect(trigger).toHaveFocus();
  });
});

describe('Checkbox', () => {
  it('toggles on Space and exposes checked state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox
          label="Extra cheese"
          checked={checked}
          onChange={(next) => {
            setChecked(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);

    await user.tab();
    const box = screen.getByRole('checkbox', { name: 'Extra cheese' });
    expect(box).toHaveFocus();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
    expect(box).toBeChecked();
  });
});

describe('RadioGroup', () => {
  it('is one tab stop and moves selection with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup
        label="Refund reason"
        defaultValue="missing"
        onChange={onChange}
        options={[
          { value: 'missing', label: 'Item missing' },
          { value: 'late', label: 'Arrived late' },
          { value: 'cold', label: 'Arrived cold' },
        ]}
      />,
    );

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Item missing' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenCalledWith('late');
    expect(screen.getByRole('radio', { name: 'Arrived late' })).toBeChecked();

    // A single tab stop: Tab leaves the group rather than walking it.
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Arrived late' })).not.toHaveFocus();
  });
});

describe('Switch', () => {
  it('toggles from the keyboard and carries a word, not just a position', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Switch
        label="Accepting orders"
        checked={false}
        stateLabel={{ on: 'Online', off: 'Offline' }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Offline')).toBeInTheDocument();

    await user.tab();
    const control = screen.getByRole('switch');
    expect(control).toHaveFocus();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('while loading, stays in the old position and refuses the toggle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Switch
        label="Accepting orders"
        checked
        loading
        stateLabel={{ on: 'Online', off: 'Offline' }}
        onChange={onChange}
      />,
    );

    const control = screen.getByRole('switch');
    expect(control).toBeChecked();
    expect(control).toHaveAttribute('aria-busy', 'true');

    await user.keyboard('{Tab} ');
    expect(onChange).not.toHaveBeenCalled();
    // The server has not confirmed, so the switch has not moved.
    expect(control).toBeChecked();
  });
});

describe('Chip', () => {
  it('filter variant toggles from the keyboard and reports aria-pressed', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Chip variant="filter" label="Biryani" selected={false} onPress={onPress} />);

    await user.tab();
    const chip = screen.getByRole('button', { name: /Biryani/ });
    expect(chip).toHaveFocus();
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Popover', () => {
  it('opens from the keyboard, traps focus, and Escape returns it to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Popover title="Certificate" content={<button type="button">View certificate</button>}>
        <button type="button">Details</button>
      </Popover>,
    );

    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Certificate' });
    expect(within(dialog).getByRole('button', { name: 'View certificate' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Tooltip', () => {
  it('opens on keyboard focus, not only on hover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Certification expires 14 March 2027">
          <button type="button">Expiry</button>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Expiry' })).toHaveFocus();
    expect(await screen.findByText('Certification expires 14 March 2027')).toBeInTheDocument();
  });
});

describe('Toast', () => {
  it('announces without stealing focus and is dismissible from the keyboard', async () => {
    const user = userEvent.setup();

    function Raise() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() => show({ variant: 'danger', title: 'Could not go offline' })}
        >
          Go offline
        </button>
      );
    }

    render(
      <ToastProvider>
        <Raise />
      </ToastProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Go offline' });
    await user.click(trigger);

    const toast = await screen.findByTestId('hg-toast');
    expect(toast).toHaveTextContent('Could not go offline');
    // Toasts announce; they never take focus (04-accessibility.md §4.2).
    expect(toast).not.toHaveFocus();

    const dismiss = within(toast).getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('hg-toast')).not.toBeInTheDocument();
  });
});
