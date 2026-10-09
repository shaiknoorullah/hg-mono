/**
 * A react-native `View` that takes `className` (redesign, N5).
 *
 * Only files under `src/lib/` compile their JSX through NativeWind, so a component outside it
 * (the `/proposed` composites) lays itself out with this instead of a bare `View`, whose
 * `className` would be dropped.
 */
import * as React from 'react';
import { View as RNView } from 'react-native';

/** A react-native `View`'s props plus `className`. */
export type ViewProps = React.ComponentProps<typeof RNView> & { className?: string };

/** `View`, styled by NativeWind. */
export function View({ className, ...props }: ViewProps): React.ReactElement {
  return <RNView className={className} {...props} />;
}
