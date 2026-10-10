/**
 * ADAPTER: live design-system `Switch` -> `@hg/ui-web` `Switch`.
 *
 * Live differences handled here: `onCheckedChange(checked)` and `onChange(checked, e)` (the
 * click event is captured around the legacy control and handed over). The switch stays in its
 * old position while `loading` until the server confirms: that is the legacy behaviour.
 */
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Switch as LegacySwitch } from '@hg/ui-web';

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  /** REQUIRED visible state words, e.g. {on:'Online', off:'Offline'}. */
  stateLabel: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean, e: MouseEvent) => void;
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  name?: string;
  /** Accepted for parity; legacy has one size. */
  size?: 'sm' | 'md';
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export function Switch({ onCheckedChange, onChange, testId = 'Switch', style, size: _size, ...rest }: SwitchProps): React.JSX.Element {
  let last: MouseEvent | null = null;
  return (
    <div
      data-testid={testId}
      style={style}
      className="contents"
      onClickCapture={(e) => {
        last = e;
      }}
    >
      <LegacySwitch
        {...rest}
        onChange={(checked) => {
          onCheckedChange?.(checked);
          if (onChange) onChange(checked, (last ?? ({} as MouseEvent)) as MouseEvent);
        }}
      />
    </div>
  );
}
