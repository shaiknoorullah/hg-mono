/**
 * RNR `Text`, adapted (redesign N0, type scale N1).
 *
 * A parent (Button) publishes its label classes through `TextClassContext`; a `Text` inside it
 * merges them under its own. `asChild` hands the classes to the child through
 * `@rn-primitives/slot` instead of rendering another `Text`.
 *
 * `variant` is a step of the generated type scale, named as `tokens.typography` names it
 * (`'body.md'`, `'heading.lg'`): the size, line height and tracking come from the preset's
 * `text-<step>` utility, the face from the preset's Plus Jakarta Sans weights (React Native takes
 * one static face per weight and has no fallback chain). `tone` is a text ROLE, never a ramp
 * step. Font scaling stays on: no `maxFontSizeMultiplier`, so text follows Dynamic Type.
 *
 * Colour comes from the generated aliases (`text-foreground` → `--foreground` →
 * `theme.text.primary`), never from a hex or `hsl()`.
 */
import * as React from 'react';
import { Text as RNText } from 'react-native';
import { Slot } from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../utils';

/** Classes a parent (e.g. `Button`) hands to every `Text` beneath it; merged under the child's own. */
export const TextClassContext = React.createContext<string | undefined>(undefined);

/**
 * One class string per type-scale step and per text role.
 *
 * The weights follow `tokens.typography`: display and `heading.xl` are bold, the other headings
 * and every label are semibold, body and caption are regular. The two mono steps keep the
 * regular UI face: IBM Plex Mono is not bundled yet, and an unknown family is an error on iOS.
 */
export const textVariants = cva('', {
  variants: {
    variant: {
      'display.lg': 'font-sans-bold text-display-lg',
      'display.md': 'font-sans-bold text-display-md',
      'heading.xl': 'font-sans-bold text-heading-xl',
      'heading.lg': 'font-sans-semibold text-heading-lg',
      'heading.md': 'font-sans-semibold text-heading-md',
      'heading.sm': 'font-sans-semibold text-heading-sm',
      'body.lg': 'font-sans text-body-lg',
      'body.md': 'font-sans text-body-md',
      'body.sm': 'font-sans text-body-sm',
      'label.lg': 'font-sans-semibold text-label-lg',
      'label.md': 'font-sans-semibold text-label-md',
      'label.sm': 'font-sans-semibold text-label-sm',
      caption: 'font-sans text-caption',
      'mono.md': 'font-sans text-mono-md',
      'mono.sm': 'font-sans text-mono-sm',
    },
    tone: {
      primary: 'text-foreground',
      secondary: 'text-muted-foreground',
      tertiary: 'text-fg-tertiary',
      disabled: 'text-fg-disabled',
      link: 'text-fg-link',
      'on-brand': 'text-primary-foreground',
      'on-accent': 'text-fg-on-accent',
      'on-inverse': 'text-fg-on-inverse',
    },
  },
});

/** A type-scale step, as `tokens.typography` names it. */
export type TextVariant = NonNullable<VariantProps<typeof textVariants>['variant']>;
/** A text colour role. */
export type TextTone = NonNullable<VariantProps<typeof textVariants>['tone']>;

/** A react-native `Text`'s props plus `className`, `asChild`, a type-scale `variant` and a `tone`. */
export type TextProps = React.ComponentProps<typeof RNText> & {
  className?: string;
  asChild?: boolean;
  variant?: TextVariant;
  tone?: TextTone;
};

/**
 * Body text in the foreground colour and Plus Jakarta Sans, overridable by context, then by
 * `variant` and `tone`, then by `className`.
 */
export function Text({ className, asChild = false, variant, tone, ...props }: TextProps): React.ReactElement {
  const inherited = React.useContext(TextClassContext);
  const Component = (asChild ? Slot : RNText) as typeof RNText;
  return (
    <Component
      className={cn('font-sans text-body-md text-foreground', inherited, textVariants({ variant, tone }), className)}
      {...props}
    />
  );
}
