/**
 * The full-screen layout the Sign-in canvas draws every pre-app screen with: the cream page
 * (`surface.base`), a scrolling body with 16 px gutters, and a footer that holds the primary
 * action and stays above the keyboard. No BottomNav: nothing here is a tab.
 *
 * `top` is either the wordmark (Sign in, the forced routes, the address step) or an AppBar
 * (Enter the code, Your details).
 */
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens, useTheme, Wordmark } from '@hg/ui-native';

export function FlowLayout({
  appBar,
  wordmark = false,
  bodyGap = tokens.space['6'],
  footer,
  centerBody = false,
  children,
  testID,
}: {
  /** An `AppBar` (tone cream). Without one the page starts 48 px down, as the canvas draws it. */
  appBar?: React.ReactNode;
  wordmark?: boolean;
  bodyGap?: number;
  footer?: React.ReactNode;
  /** Centre the body vertically (the full-screen empty-state screens). */
  centerBody?: boolean;
  children: React.ReactNode;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.color.surface.base }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {appBar ?? <View style={{ height: insets.top }} />}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          gap: bodyGap,
          paddingHorizontal: tokens.space['4'],
          paddingTop: appBar ? tokens.space['2'] : tokens.space['12'],
          paddingBottom: tokens.space['4'],
        }}
      >
        {wordmark ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Wordmark height={32} />
          </View>
        ) : null}
        {centerBody ? (
          <View style={{ flexGrow: 1, justifyContent: 'center', gap: tokens.space['4'] }}>{children}</View>
        ) : (
          children
        )}
      </ScrollView>
      {footer ? (
        <View
          style={{
            gap: tokens.space['2'],
            paddingTop: tokens.space['3'],
            paddingHorizontal: tokens.space['4'],
            paddingBottom: tokens.space['6'] + insets.bottom,
            backgroundColor: theme.color.surface.base,
          }}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
