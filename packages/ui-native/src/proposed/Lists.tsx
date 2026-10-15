/**
 * Lists and content on React Native Reusables (proposed, #192 #193 #195; N6): `ListRow` (and
 * the customer `ListItem`, the same row), `Disclosure`, `MediaFrame`, `FilterChip`,
 * `FilterChipGroup` and `JumpLinks` (tabs as jump links).
 *
 * Each is the `@hg/ui-native/lib` part with the register resolved from the theme: the rider
 * theme gets 56-point targets and one type step up, without the caller passing it.
 */
import * as React from 'react';

import {
  Disclosure as LibDisclosure,
  type DisclosureProps as LibDisclosureProps,
} from '../lib/ui/disclosure';
import {
  FilterChip as LibFilterChip,
  FilterChipGroup as LibFilterChipGroup,
  JumpLinks as LibJumpLinks,
  type FilterChipGroupProps as LibFilterChipGroupProps,
  type FilterChipProps as LibFilterChipProps,
  type JumpLinksProps as LibJumpLinksProps,
} from '../lib/ui/filter-chip';
import { ListRow as LibListRow, type ListRowProps as LibListRowProps } from '../lib/ui/list-row';
import { useFieldRegister } from './feedback/shared';

export { MediaFrame } from '../lib/ui/media-frame';
export type { MediaFrameProps, MediaFrameRadius } from '../lib/ui/media-frame';
export type { FilterChipOption, JumpLink } from '../lib/ui/filter-chip';
export type { ListRowHeight } from '../lib/ui/list-row';

/** Props of `ListRow`: the lib row's, with the register taken from the theme. */
export type ListRowProps = Omit<LibListRowProps, 'field'>;

/**
 * A full-width row: one press target with one name; chevron, value or switch at the end;
 * pressed, focused and selected as an inset fill. Every height (56, 64, 72) clears the rider's 56pt floor.
 */
export function ListRow(props: ListRowProps) {
  const field = useFieldRegister();
  return <LibListRow {...props} field={field} />;
}

/** The customer GetHelp sheet's name for the same row. Do not build a second one. */
export const ListItem = ListRow;
/** Props of `ListItem` (= `ListRowProps`). */
export type ListItemProps = ListRowProps;

/** Props of `Disclosure`: the lib section's, with the register taken from the theme. */
export type DisclosureProps = Omit<LibDisclosureProps, 'field'>;

/** A collapsible section: a header button that says `expanded`, and its content. */
export function Disclosure(props: DisclosureProps) {
  return <LibDisclosure {...props} field={useFieldRegister()} />;
}

/** Props of `FilterChip`. */
export type FilterChipProps = Omit<LibFilterChipProps, 'field'> & {
  /** @deprecated The legacy chip's size; the register sets the height now. Ignored; kept for one release. */
  size?: 'sm' | 'md';
};

/** A filter toggle: a filled tile, a bold check when selected; 44pt, 56pt on the rider theme. */
export function FilterChip({ size: _size, ...props }: FilterChipProps) {
  return <LibFilterChip {...props} field={useFieldRegister()} />;
}

/** Props of `FilterChipGroup`. */
export type FilterChipGroupProps = Omit<LibFilterChipGroupProps, 'field'>;

/** A named, horizontally scrolling group of filter chips (multi-select, or `single`). */
export function FilterChipGroup(props: FilterChipGroupProps) {
  return <LibFilterChipGroup {...props} field={useFieldRegister()} />;
}

/** Props of `JumpLinks`. */
export type JumpLinksProps = Omit<LibJumpLinksProps, 'field'>;

/** Tabs as jump links: a horizontal scroll of section links, the current one filled. */
export function JumpLinks(props: JumpLinksProps) {
  return <LibJumpLinks {...props} field={useFieldRegister()} />;
}
