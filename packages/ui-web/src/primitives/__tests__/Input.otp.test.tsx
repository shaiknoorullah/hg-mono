import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Input } from '../Input.js';

function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form data-testid="form">
      <Input
        label="Authenticator code"
        variant="otp"
        name="totp"
        value={v}
        onChange={(next) => {
          setV(next);
          onValue?.(next);
        }}
      />
    </form>
  );
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const digits = () => boxes().map((b) => b.value);

describe('Input variant="otp" — six one-digit boxes', () => {
  it('renders six boxes that hold one digit each, with one-time-code autofill', () => {
    render(<Harness />);
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0]?.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('typing fills the current box and moves focus to the next', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.keyboard('309');
    expect(digits()).toEqual(['3', '0', '9', '', '', '']);
    expect(document.activeElement).toBe(boxes()[3]);
  });

  it('pasting six digits spreads them across all six boxes', async () => {
    render(<Harness />);
    fireEvent.paste(boxes()[2]!, { clipboardData: { getData: () => '309575' } });
    expect(digits()).toEqual(['3', '0', '9', '5', '7', '5']);
  });

  it('OS one-time-code autofill (a whole code in one change event) spreads too', () => {
    render(<Harness />);
    fireEvent.change(boxes()[0]!, { target: { value: '309575' } });
    expect(digits()).toEqual(['3', '0', '9', '5', '7', '5']);
  });

  it('Backspace clears the box, and steps back from an empty one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.keyboard('12');
    // Focus is on box 3 (empty): Backspace clears box 2 and moves back to it.
    await user.keyboard('{Backspace}');
    expect(digits()).toEqual(['1', '', '', '', '', '']);
    expect(document.activeElement).toBe(boxes()[1]);
    // Box 2 is empty: Backspace clears box 1 and moves back.
    await user.keyboard('{Backspace}');
    expect(digits()).toEqual(['', '', '', '', '', '']);
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it('arrow keys move between boxes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[2]!);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(boxes()[3]);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(boxes()[1]);
  });

  it('rejects anything that is not a digit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]!);
    await user.keyboard('a-%');
    expect(digits()).toEqual(['', '', '', '', '', '']);
    fireEvent.paste(boxes()[0]!, { clipboardData: { getData: () => '12ab34' } });
    expect(digits()).toEqual(['1', '2', '3', '4', '', '']);
  });

  it('reports the joined digits and submits them under `name`', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(boxes()[0]!);
    await user.keyboard('309575');
    expect(onValue).toHaveBeenLastCalledWith('309575');
    const data = new FormData(screen.getByTestId('form') as HTMLFormElement);
    expect(data.get('totp')).toBe('309575');
  });
});
