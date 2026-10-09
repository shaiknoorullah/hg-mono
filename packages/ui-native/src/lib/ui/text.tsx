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

export const TextClassContext = React.createContext<string | undefined>(undefined);

export type TextProps = React.ComponentProps<typeof RNText> & {
  className?: string;
  asChild?: boolean;
};

export function Text({ className, asChild = false, ...props }: TextProps): React.ReactElement {
  const inherited = React.useContext(TextClassContext);
  const Component = (asChild ? Slot : RNText) as typeof RNText;
  return <Component className={cn('text-body-md text-foreground', inherited, className)} {...props} />;
}
