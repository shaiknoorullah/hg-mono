/**
 * shadcn/ui `Collapsible` on Radix. The trigger is a real button carrying `aria-expanded` and
 * `aria-controls`; the content is removed from the accessibility tree while closed.
 */

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** The open/closed state holder. */
export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/** The button that opens and closes the section: full width, 44px minimum, inset focus ring. */
export function CollapsibleTrigger({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      className={cn(
        'group/collapsible flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-start',
        'text-label-lg font-semibold text-fg-primary hover:bg-surface-subtle',
        'hg-focus hg-focus-inset',
        className,
      )}
      {...props}
    />
  );
}

/** The section body. */
export function CollapsibleContent(props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />;
}
