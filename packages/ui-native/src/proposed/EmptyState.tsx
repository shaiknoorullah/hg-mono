/**
 * `EmptyState` on React Native Reusables (proposed, #191; N5). Every screen's empty third.
 *
 * It names WHY the place is empty and WHAT to do next: "You haven't ordered yet", then "Browse
 * restaurants near you", then the button. The illustration slot is decorative and hidden from
 * assistive tech. `page` is the screen's own heading (level 1); `inline` sits inside a populated
 * screen (level 2). In the rider register the actions sit in the bottom third, in thumb reach.
 *
 * Not for feed sections: a section with nothing in it is omitted, not shown empty.
 */
import * as React from 'react';
import { View as FocusTarget } from 'react-native';

import { moveAccessibilityFocus } from '../feedback/internal/a11y';
import { Text } from '../lib/ui/text';
import { View } from '../lib/ui/view';
import { FeedbackAction } from './feedback/action';
import { type ActionSpec, resolveTestId, useFieldRegister } from './feedback/shared';

export interface EmptyStateProps {
  /** Names the state, not the absence ("You haven't ordered yet"). */
  title: string;
  /** What to do next. */
  description?: string;
  primaryAction?: ActionSpec;
  secondaryAction?: ActionSpec;
  /** Decorative; hidden from assistive tech. */
  illustration?: React.ReactNode;
  /** `page` (default): the whole screen. `inline`: a list or region inside a screen. */
  placement?: 'page' | 'inline';
  /** @deprecated Use `placement`. Kept for one release; the legacy `table` reads as `inline`. */
  variant?: 'page' | 'inline' | 'table';
  /** Heading level: 1 for `page`, 2 for `inline` by default. */
  headingLevel?: 1 | 2 | 3;
  /** Move screen-reader focus to the heading on mount (when the empty replaced content). */
  autoFocus?: boolean;
  /** 44pt (`default`) or the rider's 56pt (`field`). Defaults to the theme's register. */
  size?: 'default' | 'field';
  testId?: string;
  testID?: string;
}

/** The empty state of a screen or of a list within it. */
export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { title, description, primaryAction, secondaryAction, illustration, autoFocus = false } = props;
  const placement = props.placement ?? (props.variant && props.variant !== 'page' ? 'inline' : 'page');
  const page = placement === 'page';
  const headingLevel = props.headingLevel ?? (page ? 1 : 2);
  const themeField = useFieldRegister();
  const field = props.size ? props.size === 'field' : themeField;
  const testID = resolveTestId(props, 'EmptyState');
  const headingRef = React.useRef(null);

  React.useEffect(() => {
    if (autoFocus) moveAccessibilityFocus(headingRef);
  }, [autoFocus]);

  const actions =
    primaryAction || secondaryAction ? (
      <View className={field && page ? 'mt-auto w-full gap-3' : 'w-full items-center gap-3'}>
        {primaryAction ? <FeedbackAction action={primaryAction} field={field} fullWidth={page || field} /> : null}
        {secondaryAction ? (
          <FeedbackAction action={secondaryAction} variant="outline" field={field} fullWidth={page || field} />
        ) : null}
      </View>
    ) : null;

  return (
    <View testID={testID} className={page ? (field ? 'flex-1 gap-6 p-6' : 'items-center gap-4 p-8') : 'items-center gap-3 p-4'}>
      <View className="items-center gap-3">
        {illustration ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {illustration}
          </View>
        ) : null}
        <FocusTarget ref={headingRef} accessible accessibilityRole="header" aria-level={headingLevel}>
          <Text
            className={
              page
                ? 'text-center font-sans-bold text-display-md'
                : cnHeading(field)
            }
          >
            {title}
          </Text>
        </FocusTarget>
        {description ? (
          <Text className={field ? 'text-center text-body-lg' : 'text-center text-fg-secondary'}>{description}</Text>
        ) : null}
      </View>
      {actions}
    </View>
  );
}

function cnHeading(field: boolean): string {
  return field ? 'text-center font-sans-semibold text-heading-lg' : 'text-center font-sans-semibold text-heading-md';
}
