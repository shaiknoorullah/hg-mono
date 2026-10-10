/**
 * shadcn/ui `Card`, restyled to HalalGoes roles: the white plate raised above the cream page.
 *
 * Upstream shadcn has no pressable card. Ours adds two, here in the library layer because they
 * are raw interactive elements: `CardPressable` (`role="button"`, Enter and Space) and
 * `CardLink` (an `<a>`). Either is ONE tab stop with ONE accessible name; nothing interactive
 * may be nested inside.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';

import { cn } from '../utils.js';

/** Class recipe for the card surface. */
export const cardVariants = cva(
  'flex flex-col overflow-hidden border text-start text-fg-primary no-underline',
  {
    variants: {
      variant: {
        elevated: 'bg-surface-raised border-transparent shadow-e1',
        outlined: 'bg-surface-raised border-line-decorative',
        filled: 'bg-surface-subtle border-transparent',
        interactive: [
          'hg-focus cursor-pointer bg-surface-raised border-transparent shadow-e1',
          'transition-[box-shadow,transform] duration-(--hg-duration-instant) ease-standard',
          'hover:shadow-e2 active:scale-[0.99] data-pressed:scale-[0.99]',
          'motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:data-pressed:scale-100',
        ],
      },
      radius: { md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' },
    },
    defaultVariants: { variant: 'elevated', radius: 'lg' },
  },
);

/** The variant props `cardVariants` takes. */
export type CardVariantProps = VariantProps<typeof cardVariants>;

/** Props of the static card surface. */
export interface LibCardProps extends HTMLAttributes<HTMLDivElement>, CardVariantProps {}

/** shadcn `Card`: a static surface. */
export const Card = forwardRef<HTMLDivElement, LibCardProps>(function Card(
  { className, variant, radius, ...props },
  ref,
) {
  return <div ref={ref} data-slot="card" className={cn(cardVariants({ variant, radius }), className)} {...props} />;
});

/** Props of a pressable card. */
export interface CardPressableProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'>, CardVariantProps {
  onPress: (e: SyntheticEvent) => void;
}

/** A card that is one button: `role="button"`, Enter activates on key down, Space on key up. */
export const CardPressable = forwardRef<HTMLDivElement, CardPressableProps>(function CardPressable(
  { className, variant = 'interactive', radius, onPress, onKeyDown, onKeyUp, onBlur, ...props },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-slot="card"
      data-pressed={pressed ? '' : undefined}
      className={cn(cardVariants({ variant, radius }), className)}
      onClick={onPress}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setPressed(true);
          if (e.key === 'Enter' && !e.repeat) onPress(e);
        }
      }}
      onKeyUp={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyUp?.(e);
        if (e.key === 'Enter' || e.key === ' ') setPressed(false);
        if (e.key === ' ') onPress(e);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        setPressed(false);
      }}
      {...props}
    />
  );
});

/** Props of a card that is a link. */
export interface CardLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, CardVariantProps {}

/** A card that is one link. */
export const CardLink = forwardRef<HTMLAnchorElement, CardLinkProps>(function CardLink(
  { className, variant = 'interactive', radius, ...props },
  ref,
) {
  return <a ref={ref} data-slot="card" className={cn(cardVariants({ variant, radius }), className)} {...props} />;
});

/** The card's heading area. */
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

/** The card's body. */
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn('flex flex-col gap-2', className)} {...props} />;
}

/** The card's action or summary row. */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-2', className)} {...props} />;
}
