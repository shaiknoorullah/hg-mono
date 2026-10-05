/**
 * The canvases' centred empty and error states (Claude Design "Proposed component: EmptyState /
 * ErrorState"): a Solar glyph in a 56 px disc, a heading, a sentence, then the actions. An error
 * disc is the warning tint, never red; an empty one is the sunken surface.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Button, Icon, tokens, useTheme, useTypeStyle } from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

export function StateMessage({
  icon,
  tone,
  title,
  description,
  onRetry,
  children,
  testID,
}: {
  icon: IconName;
  tone: 'empty' | 'error';
  title: string;
  description: string;
  /** Adds the canvas's "Try again" (secondary, with the refresh glyph). */
  onRetry?: () => void;
  children?: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const error = tone === 'error';
  return (
    <View
      testID={testID}
      accessibilityRole={error ? 'alert' : undefined}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space['3'],
        paddingHorizontal: tokens.space['5'],
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 56,
          height: 56,
          borderRadius: tokens.radius.full,
          backgroundColor: error ? theme.color.feedback.warning.tint : theme.color.surface.sunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon
          name={icon}
          size={28}
          color={error ? theme.color.feedback.warning.icon : theme.color.text.secondary}
        />
      </View>
      <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text style={[body, { color: theme.color.text.secondary, textAlign: 'center', maxWidth: 320 }]}>
        {description}
      </Text>
      {/* A Button sizes to its label and aligns itself to the start; centre it like the text. */}
      {onRetry ? (
        <View style={{ alignSelf: 'center' }}>
          <Button
            variant="secondary"
            iconStart={<Icon name="refresh" size={20} color={theme.color.text.onAccent} />}
            onPress={onRetry}
          >
            Try again
          </Button>
        </View>
      ) : null}
      {children ? <View style={{ alignSelf: 'center' }}>{children}</View> : null}
    </View>
  );
}
