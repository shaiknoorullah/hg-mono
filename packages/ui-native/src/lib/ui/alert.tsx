/**
 * RNR `Alert`, adapted (redesign, N5): the plate under `Banner`, `InlineAlert` and `ErrorState`.
 *
 * Adaptations from the RNR template, all deliberate:
 *   - tones are the generated feedback roles (`bg-feedback-<tone>-tint`, `--hg-feedback-*` in
 *     `global.<theme>.css`), never a ramp step;
 *   - there is a `slate` tone, for halal messages (invariant 9: never red for a halal state), and
 *     no `success` tone (invariant 10: no solid green outside `color.halal.*`; success is a Toast);
 *   - `placement` is the one difference between Banner (`page`: full-bleed bar, edge rule) and
 *     InlineAlert (`inline`: a rounded plate inside the content);
 *   - `field` is the rider register: one type step up and 56pt targets;
 *   - the glyph is our Solar set (`Glyph`), not lucide.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { cva } from 'class-variance-authority';

import type { AnyIconName } from '../../ds/shared';
import { cn } from '../utils';
import { icon as iconSize } from '../../tokens';
import { Glyph } from './icon';
import { Text } from './text';

/** Every tone a feedback plate can take. `slate` is for halal messages; there is no `success`. */
export type AlertTone = 'neutral' | 'info' | 'warning' | 'danger' | 'slate';
/** `page`: a full-width bar at the top of a region. `inline`: a plate inside the content. */
export type AlertPlacement = 'page' | 'inline';

/** Plate classes per tone × placement. */
export const alertVariants = cva('flex-row items-start gap-3', {
  variants: {
    tone: {
      neutral: 'bg-feedback-neutral-tint border-feedback-neutral-border',
      info: 'bg-feedback-info-tint border-feedback-info-border',
      warning: 'bg-feedback-warning-tint border-feedback-warning-border',
      danger: 'bg-feedback-danger-tint border-feedback-danger-border',
      slate: 'bg-feedback-slate-tint border-feedback-slate-border',
    },
    placement: {
      page: 'w-full border-b px-4 py-3',
      inline: 'rounded-md border p-4',
    },
  },
  defaultVariants: { tone: 'info', placement: 'inline' },
});

/** Glyph colour per tone. */
export const alertIconVariants = cva('', {
  variants: {
    tone: {
      neutral: 'text-feedback-neutral-icon',
      info: 'text-feedback-info-icon',
      warning: 'text-feedback-warning-icon',
      danger: 'text-feedback-danger-icon',
      slate: 'text-feedback-slate-icon',
    },
  },
  defaultVariants: { tone: 'info' },
});

/** The default glyph of each tone: a shape that carries the severity, never colour alone. */
export const ALERT_ICON: Record<AlertTone, AnyIconName> = {
  neutral: 'info',
  info: 'info',
  warning: 'warning',
  danger: 'error',
  slate: 'info',
};

type AlertContextValue = { tone: AlertTone; field: boolean };
const AlertContext = React.createContext<AlertContextValue>({ tone: 'info', field: false });

/** Props of the plate: a `View` plus tone, placement, register and `className`. */
export type AlertProps = React.ComponentProps<typeof View> & {
  tone?: AlertTone;
  placement?: AlertPlacement;
  /** The rider field register: one type step up, 56pt targets. */
  field?: boolean;
  className?: string;
};

/** The tinted plate; its parts read the tone and register from it. */
export function Alert({
  tone = 'info',
  placement = 'inline',
  field = false,
  className,
  ...props
}: AlertProps): React.ReactElement {
  return (
    <AlertContext.Provider value={{ tone, field }}>
      <View className={cn(alertVariants({ tone, placement }), field && 'gap-4', className)} {...props} />
    </AlertContext.Provider>
  );
}

/** The tone's glyph (or `name`), hidden from assistive tech: the words carry the meaning. */
export function AlertIcon({ name, className }: { name?: AnyIconName; className?: string }): React.ReactElement {
  const { tone, field } = React.useContext(AlertContext);
  return (
    <View className="mt-0.5">
      <Glyph
        name={name ?? ALERT_ICON[tone]}
        size={field ? iconSize.lg : iconSize.md}
        className={cn(alertIconVariants({ tone }), className)}
      />
    </View>
  );
}

/** The column holding title, description and actions. */
export function AlertContent({ className, ...props }: React.ComponentProps<typeof View> & { className?: string }) {
  return <View className={cn('flex-1 gap-1', className)} {...props} />;
}

/** The plate's heading line. */
export function AlertTitle({ className, ...props }: React.ComponentProps<typeof Text>): React.ReactElement {
  const { field } = React.useContext(AlertContext);
  return (
    <Text
      className={cn('font-sans-semibold', field ? 'text-heading-md' : 'text-heading-sm', className)}
      {...props}
    />
  );
}

/** The plate's body: cause, then what to do. */
export function AlertDescription({ className, ...props }: React.ComponentProps<typeof Text>): React.ReactElement {
  const { field } = React.useContext(AlertContext);
  return <Text className={cn(field ? 'text-body-lg' : 'text-body-md', className)} {...props} />;
}

/** The close control: a 44pt (56pt field) target named "Dismiss: {title}". */
export function AlertDismiss({
  accessibilityLabel,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  const { field } = React.useContext(AlertContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      className={cn(
        '-my-2 items-center justify-center rounded-md active:opacity-70',
        field ? 'min-h-target-field min-w-target-field' : 'min-h-target-min min-w-target-min',
      )}
    >
      <Glyph name="close" size={field ? iconSize.lg : iconSize.md} className="text-fg-secondary" />
    </Pressable>
  );
}
