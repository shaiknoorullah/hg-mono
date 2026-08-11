/**
 * `QuantityStepper` — component 22, `02-components.md` Tier 3.
 *
 * `loading` freezes the value and blocks both buttons rather than moving optimistically. Cart
 * mutations are server-authoritative, and a stepper that shows 3 and then snaps back to 2 is
 * worse than a 200 ms wait: the customer no longer knows what is in the basket.
 *
 * At the bounds the `−` and `+` disable **individually**, each with the reason available, and
 * `removeAtZero` turns `−` into a remove affordance at 1 so the last decrement announces what it
 * actually does.
 */
import { cx, FOCUS_RING, HIT_AREA_STYLE, ICON } from '../certification/internal/token-style';

export type QuantityStepperSize = 'sm' | 'md' | 'lg';

export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  size?: QuantityStepperSize;
  loading?: boolean;
  disabled?: boolean;
  /** At `value === 1` the decrement becomes "Remove {itemName}". */
  removeAtZero?: boolean;
  /** Names the group and the remove action: "Quantity for Chicken Biryani". */
  itemName?: string;
  /** Explains a disabled bound, e.g. "Maximum 10 per order". */
  maxReason?: string;
  className?: string;
}

const SIZE_CLASS: Readonly<Record<QuantityStepperSize, string>> = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
};

export function QuantityStepper({
  value,
  min = 0,
  max,
  onChange,
  size = 'md',
  loading = false,
  disabled = false,
  removeAtZero = false,
  itemName,
  maxReason,
  className,
}: QuantityStepperProps): React.JSX.Element {
  const groupName = itemName ? `Quantity for ${itemName}` : 'Quantity';
  const atMin = value <= min;
  const atMax = max != null && value >= max;
  const removing = removeAtZero && value === 1;

  const decrementLabel = removing
    ? `Remove ${itemName ?? 'item'}`
    : 'Decrease quantity';

  return (
    <div
      role="group"
      aria-label={groupName}
      data-testid="QuantityStepper"
      className={cx(
        'inline-flex items-center gap-1 rounded-full border border-control-border bg-control-bg',
        SIZE_CLASS[size],
        disabled && 'opacity-60',
        className,
      )}
    >
      <StepButton
        label={decrementLabel}
        testId="QuantityStepper-decrement"
        disabled={disabled || loading || (atMin && !removing)}
        onPress={() => onChange(value - 1)}
      >
        {removing ? <TrashGlyph /> : <MinusGlyph />}
      </StepButton>

      {loading ? (
        <span
          data-testid="QuantityStepper-loading"
          aria-busy="true"
          aria-label="Updating quantity"
          className="inline-flex min-w-8 justify-center text-label-md text-fg-secondary"
        >
          <Spinner />
        </span>
      ) : (
        // On web the numeral is itself a spinbutton, so direct entry works and the value is
        // announced on change without the buttons announcing twice.
        <span
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={groupName}
          aria-live="polite"
          data-testid="QuantityStepper-value"
          className={cx(
            'inline-flex min-w-8 justify-center rounded-sm text-label-lg text-fg-primary',
            FOCUS_RING,
          )}
          style={{ fontVariantNumeric: 'tabular-nums' }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowUp' && !atMax) {
              e.preventDefault();
              onChange(value + 1);
            }
            if (e.key === 'ArrowDown' && !atMin) {
              e.preventDefault();
              onChange(value - 1);
            }
          }}
        >
          {value}
        </span>
      )}

      <StepButton
        label="Increase quantity"
        testId="QuantityStepper-increment"
        disabled={disabled || loading || atMax}
        describedBy={atMax && maxReason ? 'hg-stepper-max-reason' : undefined}
        onPress={() => onChange(value + 1)}
      >
        <PlusGlyph />
      </StepButton>

      {atMax && maxReason ? (
        <span id="hg-stepper-max-reason" className="sr-only">
          {maxReason}
        </span>
      ) : null}
    </div>
  );
}

function StepButton(props: {
  label: string;
  testId: string;
  disabled: boolean;
  describedBy?: string | undefined;
  onPress: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { label, testId, disabled, describedBy, onPress, children } = props;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-describedby={describedBy}
      // `aria-disabled` rather than `disabled`: a disabled button is not focusable and so cannot
      // explain itself (`02-components.md` §1).
      aria-disabled={disabled || undefined}
      className={cx(
        'relative inline-flex items-center justify-center rounded-full px-2 text-fg-primary',
        disabled && 'opacity-60',
        FOCUS_RING,
      )}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      {children}
      {/* Each button is ≥44 to the finger even when the glyph is 20px. */}
      <span aria-hidden="true" style={HIT_AREA_STYLE} />
    </button>
  );
}

const glyphProps = {
  viewBox: '0 0 24 24',
  width: ICON.md,
  height: ICON.md,
  'aria-hidden': true as const,
  focusable: 'false' as const,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function MinusGlyph(): React.JSX.Element {
  return (
    <svg {...glyphProps}>
      <path d="M6 12h12" />
    </svg>
  );
}

function PlusGlyph(): React.JSX.Element {
  return (
    <svg {...glyphProps}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

function TrashGlyph(): React.JSX.Element {
  return (
    <svg {...glyphProps}>
      <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4A1.5 1.5 0 0 0 16.2 19L17 7" />
    </svg>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <svg {...glyphProps} role="presentation" className="motion-safe:animate-spin">
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  );
}
