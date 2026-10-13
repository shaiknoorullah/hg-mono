/**
 * RNR `Text`, adapted (redesign, N0 spike).
 *
 * A parent (Button) publishes its label classes through `TextClassContext`; a `Text` inside it
 * merges them under its own. `asChild` hands the classes to the child through
 * `@rn-primitives/slot` instead of rendering another `Text`.
 *
 * Colour comes from the generated aliases (`text-foreground` → `--foreground` →
 * `theme.text.primary`), never from a hex or `hsl()`.
 */
import * as React from 'react';
import { Text as RNText } from 'react-native';
import { Slot } from '@rn-primitives/slot';

import { cn } from '../utils';

/** Classes a parent (e.g. `Button`) hands to every `Text` beneath it; merged under the child's own. */
export const TextClassContext = React.createContext<string | undefined>(undefined);

/** A react-native `Text`'s props plus `className` and `asChild` (style the child via Slot). */
export type TextProps = React.ComponentProps<typeof RNText> & {
  className?: string;
  asChild?: boolean;
};

/** Body text in the foreground colour and Plus Jakarta Sans, overridable by context and `className`. */
export function Text({ className, asChild = false, ...props }: TextProps): React.ReactElement {
  const inherited = React.useContext(TextClassContext);
  const Component = (asChild ? Slot : RNText) as typeof RNText;
  return <Component className={cn('font-sans text-body-md text-foreground', inherited, className)} {...props} />;
}
