/**
 * Primitive adapter for the navigation and feedback tiers.
 *
 * `src/primitives` is owned by another agent. Every use of a primitive from these two tiers goes
 * through this file for the same reason the token reads do: if `Button`'s prop names differ from
 * what 02-components.md §1 documents, this is the only file that changes.
 *
 * The assumed contracts, straight from 02-components.md:
 *   Button       children = visible label; `variant` primary|secondary|tertiary|ghost|danger
 *                (no `success` — RULE H-1); `size` sm|md|lg|xl; `fullWidth`, `loading`,
 *                `disabled`, `destructive`, `onPress`, `accessibilityLabel`.
 *   IconButton   `icon` node, `accessibilityLabel` REQUIRED, `variant` plain|filled|tonal,
 *                `size` sm|md|lg.
 *   Skeleton     `variant` text|circle|rect|card, `width`, `height`, `lines`.
 *   Badge        `variant`, `style` solid|tint|dot, `size`, `label`, `max`.
 */
import { View } from 'react-native';
import type { ReactNode } from 'react';

import { Badge, Button, IconButton, Skeleton } from '../../primitives';
import { useTheme } from './theme';
import { DotGlyph } from './glyphs';

export { Badge, Button, IconButton, Skeleton };

/**
 * One action, as every component in these tiers accepts it. `EmptyState`, `ErrorState`, `Banner`,
 * `Sheet` and `Modal` all take actions in this shape so an app writes the same object everywhere.
 */
export interface ActionSpec {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Only when the visible label is not a sufficient name on its own. */
  accessibilityLabel?: string;
  /** The label must still carry the verb ("Cancel order", never "Confirm") — 02-components.md §1. */
  destructive?: boolean;
  testID?: string;
}

export type ActionVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
export type ActionSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * `loading` is not `disabled` (02-components.md §0 rule 4): a loading action keeps its accessible
 * name and blocks re-entry by ignoring the press, it does not go grey and lose its label.
 */
export function renderAction(
  action: ActionSpec,
  opts: { variant?: ActionVariant; size?: ActionSize; fullWidth?: boolean } = {},
): ReactNode {
  const variant: ActionVariant = opts.variant ?? (action.destructive ? 'danger' : 'primary');
  return (
    <Button
      variant={variant}
      size={opts.size ?? 'md'}
      fullWidth={opts.fullWidth ?? false}
      loading={action.loading ?? false}
      disabled={action.disabled ?? false}
      destructive={action.destructive ?? false}
      onPress={action.loading ? () => undefined : action.onPress}
      accessibilityLabel={action.accessibilityLabel}
      testID={action.testID}
    >
      {action.label}
    </Button>
  );
}

/**
 * A badge rendered for the eye only. Counts must live inside the parent control's accessible name
 * ("Orders, 2 active"), never as a separate node (02-components.md §§9, 28).
 *
 * A bare dot is drawn rather than delegated: `Badge` always renders a label, and a `Badge` with an
 * empty label is a badge that says nothing in a box.
 */
export function MutedBadge({
  count,
  dot = false,
  variant = 'danger',
}: {
  count?: number | undefined;
  dot?: boolean;
  variant?: 'danger' | 'brand' | 'neutral';
}) {
  const theme = useTheme();
  if (!dot && (count == null || count <= 0)) return null;

  const colour =
    variant === 'brand'
      ? theme.color.action.primary
      : variant === 'neutral'
        ? theme.color.border.strong
        : theme.color.feedback.danger.icon;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dot || count == null ? (
        <DotGlyph size={8} color={colour} />
      ) : (
        <Badge variant={variant} style="solid" size="sm" label={String(count)} max={99} />
      )}
    </View>
  );
}
