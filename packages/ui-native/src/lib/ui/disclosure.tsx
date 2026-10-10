/**
 * `Disclosure` for the className tier (redesign N6, #192): a collapsible section, the RNR
 * `Collapsible` pattern without a new `@rn-primitives` package.
 *
 * The header is one button that says `accessibilityState.expanded`; the chevron turns with it
 * and is decorative. Collapsed content is not rendered, so a screen reader does not walk into
 * hidden text. Pressed and focused are an inset `bg-muted` fill, never an edge. Controlled
 * (`expanded` + `onExpandedChange`) or not (`defaultExpanded`).
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** Props of `Disclosure`. */
export interface DisclosureProps {
  /** The header's words ("Opening hours", "For support"); the button's name. */
  title: string;
  /** A short summary beside the title while collapsed ("Open until 11 pm"). */
  summary?: string;
  children?: React.ReactNode;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** The rider field register: 56pt header, one type step up. */
  field?: boolean;
  testID?: string;
}

/** A header button that shows or hides the content below it. */
export function Disclosure({
  title,
  summary,
  children,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  field = false,
  testID = 'Disclosure',
}: DisclosureProps): React.ReactElement {
  const [own, setOwn] = React.useState(defaultExpanded);
  const [pressed, setPressed] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const open = expanded ?? own;
  const toggle = () => {
    if (expanded === undefined) setOwn(!open);
    onExpandedChange?.(!open);
  };
  return (
    <View testID={testID}>
      <Pressable
        testID={`${testID}-header`}
        accessibilityRole="button"
        accessibilityLabel={summary && !open ? `${title}, ${summary}` : title}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn('py-1', field ? 'min-h-target-field' : 'min-h-target-min')}
      >
        <View className={cn('flex-1 flex-row items-center gap-3 rounded-md px-3', (pressed || focused) && 'bg-muted')}>
          <Text className={cn('flex-1 font-sans-semibold', field ? 'text-heading-md' : 'text-heading-sm')}>{title}</Text>
          {summary && !open ? <Text className={cn(field ? 'text-body-lg' : 'text-body-md', 'text-muted-foreground')}>{summary}</Text> : null}
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Glyph name="chevron-down" size={field ? 24 : 20} className="text-muted-foreground" />
          </View>
        </View>
      </Pressable>
      {open ? (
        <View testID={`${testID}-content`} className="px-3 pb-3 pt-1">
          {children}
        </View>
      ) : null}
    </View>
  );
}
