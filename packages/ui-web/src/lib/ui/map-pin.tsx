/**
 * Map pins drawn on the approved boards (`admin/orders/LiveMapPane`, `restaurant/onboarding/
 * ProfilePanes`): a label chip with a 28px glyph tile, and the 44px draggable pin of the
 * address picker.
 *
 * Colours come from `color.map.*` only. The rider tile is `map-pin-rider`, the one registered
 * exception to "solid green is reserved for halal" (lint L-4): a rider carries no certification
 * claim. Places carry no halal state, so no pin here can imply one.
 *
 * TODO(packet T5a-T5c): the dark map-pin values are approved in principle but have no tokens
 * yet; these read the light `map-pin-*` roles in both themes until T5 lands.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Icon, type DsIconName } from '../../ds/Icon.js';
import { cn } from '../utils.js';

/** What a pin stands for. */
export type MapPinKind = 'restaurant' | 'customer' | 'rider';

const TILE: Record<MapPinKind, string> = {
  restaurant: 'rounded-sm bg-map-pin-restaurant text-fg-on-brand',
  customer: 'rounded-sm bg-map-pin-customer text-fg-on-accent',
  rider: 'rounded-full bg-map-pin-rider text-fg-on-accent',
};

const GLYPH: Record<MapPinKind, DsIconName> = { restaurant: 'orders', customer: 'home', rider: 'profile' };

/** Props of `MapPinMarker`. */
export interface MapPinMarkerProps {
  kind: MapPinKind;
  label: string;
  /** Stale position: dashed outline (full opacity, per the board) and a trailing note. */
  stale?: boolean;
  /** Text after the label when stale, e.g. a "Stale" badge. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The label chip that marks a place or a rider on the map. Decorative to assistive technology:
 * the map's text equivalent carries the same facts.
 */
export function MapPinMarker({ kind, label, stale = false, trailing, className }: MapPinMarkerProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="map-pin"
      data-kind={kind}
      data-stale={stale || undefined}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-md border bg-surface-raised py-1 ps-1 pe-3 shadow-e2',
        'font-ui text-label-md font-semibold text-fg-primary',
        stale ? 'border-dashed border-line-strong' : 'border-line-decorative',
        className,
      )}
    >
      <span className={cn('inline-flex size-7 items-center justify-center', TILE[kind])}>
        <Icon name={GLYPH[kind]} size="sm" />
      </span>
      {label}
      {trailing}
    </span>
  );
}

/** Props of `MapPinHandle`: a button; `aria-label` says where it is and how to move it. */
export type MapPinHandleProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The draggable pin of the address picker: a 44px circle with the map glyph and the brand ring.
 * Focusable; the caller moves it with the arrow keys (`onKeyDown`) and by dragging.
 */
export const MapPinHandle = forwardRef<HTMLButtonElement, MapPinHandleProps>(function MapPinHandle(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="map-pin-handle"
      className={cn(
        'hg-focus inline-flex size-11 cursor-grab items-center justify-center rounded-full border-2 border-line-brand',
        'bg-surface-raised p-0 text-fg-primary shadow-e2 active:cursor-grabbing',
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-(--hg-state-disabled-opacity)',
        className,
      )}
      {...props}
    >
      <Icon name="map" size="lg" />
    </button>
  );
});
