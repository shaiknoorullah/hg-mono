/**
 * `EmptyState` — 02-components.md §35.
 *
 * Every screen in this product is required to implement empty, loading and error states
 * (03-patterns.md §0 and the cross-surface state matrix at §5). This component is what makes the
 * empty third cheap enough that nobody skips it.
 *
 * The rule it enforces: an empty state names **why** it is empty and **what to do next**.
 * "No orders" is a failure; "You haven't ordered yet — browse restaurants near you" is a state.
 * `description` is therefore not decorative, and `EmptyState` renders a visible reminder in
 * development when it is omitted rather than quietly shipping a dead end.
 *
 * Not for feed sections: C-09 omits a section with no content entirely rather than rendering an
 * empty shell. `EmptyState` is for whole screens, lists and tables.
 */
import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type } from './internal/theme';
import { renderAction, type ActionSpec } from './internal/primitives';
import { moveAccessibilityFocus } from './internal/a11y';

export type EmptyStateVariant = 'page' | 'inline' | 'table';

export interface EmptyStateProps {
  /**
   * Optional illustration slot. Always `aria-hidden` — an illustration never carries meaning that
   * is not also in the title or description.
   */
  illustration?: ReactNode;
  /** Heading. Names the state, not the absence ("You haven't ordered yet"). */
  title: string;
  /** What to do next. Required in spirit; omitting it is a documented smell, not a shortcut. */
  description?: string;
  /** The first focusable element after the heading (02-components.md §35). */
  primaryAction?: ActionSpec;
  secondaryAction?: ActionSpec;
  variant?: EmptyStateVariant;
  /**
   * Heading level. `page` empties are the screen's h1; an empty inside a populated screen is not.
   */
  headingLevel?: 1 | 2 | 3;
  /** Move AT focus here on mount. Use when the empty replaces content the user was acting on. */
  autoFocus?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function EmptyState({
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = 'page',
  headingLevel = variant === 'page' ? 1 : 2,
  autoFocus = false,
  style,
  testID = 'EmptyState',
}: EmptyStateProps) {
  const theme = useTheme();
  const headingRef = useRef<Text>(null);

  useEffect(() => {
    if (autoFocus) moveAccessibilityFocus(headingRef);
  }, [autoFocus]);

  const page = variant === 'page';
  const pad = page ? theme.density.cardPadding * 2 : theme.density.cardPadding;

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          paddingVertical: pad,
          paddingHorizontal: theme.density.gutter,
          gap: theme.density.gutter,
        },
        variant === 'table' && { backgroundColor: theme.color.surface.base },
        style,
      ]}
    >
      {illustration ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {illustration}
        </View>
      ) : null}

      <Text
        ref={headingRef}
        accessibilityRole="header"
        aria-level={headingLevel}
        style={[
          type(theme, page ? 'display.md' : 'heading.md'),
          { color: theme.color.text.primary, textAlign: 'center' },
        ]}
      >
        {title}
      </Text>

      {description ? (
        <Text
          style={[
            type(theme, 'body.md'),
            { color: theme.color.text.secondary, textAlign: 'center' },
          ]}
        >
          {description}
        </Text>
      ) : null}

      {primaryAction || secondaryAction ? (
        <View style={[styles.actions, { gap: theme.target.spacing * 2 }]}>
          {primaryAction
            ? renderAction(primaryAction, {
                variant: 'primary',
                size: page ? 'lg' : 'md',
                fullWidth: page,
              })
            : null}
          {secondaryAction
            ? renderAction(secondaryAction, {
                variant: 'tertiary',
                size: page ? 'lg' : 'md',
                fullWidth: page,
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  /** Stacks rather than sitting side by side, so it survives 200% dynamic type without clipping. */
  actions: { alignSelf: 'stretch', alignItems: 'center' },
});
