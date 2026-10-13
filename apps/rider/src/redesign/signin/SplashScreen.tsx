/**
 * R03 opening: the routing gate while `getRiderMe` loads. Boards: SO `Route-Splash`,
 * `Route-Timeout`, `Route-Error`.
 *
 * `SessionGate` owns the phases (loading → "slow" after 10 s → error on failure) and hands the
 * retry in; this screen only draws them. "Sign out" revokes the session on the server (best
 * effort) and signs out on purpose, so the rider lands on the plain sign-in screen.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button, Skeleton, Wordmark, space, typeStyle, useTheme } from '../ds';
import { callSupport, supportFrom, usePublicConfig } from '../data/config';
import type { ScreenProps } from '../nav/registry';
import { signOut } from '../session/signOut';
import { CALL_SUPPORT, SPLASH } from './copy';
import { revokeSession } from './otp';

export function SplashScreen({ params }: ScreenProps<'splash'>): React.ReactElement {
  const theme = useTheme();
  const { phase, retry } = params;
  const config = usePublicConfig();
  const support = supportFrom(config.data);
  const h1 = typeStyle(theme, 'heading.xl');
  const body = typeStyle(theme, 'body.lg');

  const leave = () => {
    void revokeSession();
    signOut();
  };

  return (
    <View testID={`splash-${phase}`} style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space['5'], gap: space['5'] }}
      >
        {phase === 'error' ? (
          // ds-request(native): ErrorState size field with an `error` glyph and footer actions — SO Route-Error
          <View style={{ gap: space['2'] }}>
            <Text accessibilityRole="header" style={{ ...h1, color: theme.color.text.primary }}>
              {SPLASH.errorTitle}
            </Text>
            <Text style={{ ...body, color: theme.color.text.primary }}>{SPLASH.errorBody}</Text>
          </View>
        ) : (
          <>
            <Wordmark height={44} />
            {/* Proposed Skeleton composite (SO Route-Splash): three lines stand in for the account */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: space['3'] }}>
              <Skeleton variant="text" lines={3} />
            </View>
            {phase === 'slow' ? (
              <View style={{ gap: space['2'] }}>
                <Text accessibilityRole="header" style={{ ...h1, color: theme.color.text.primary }}>
                  {SPLASH.slowTitle}
                </Text>
                <Text accessibilityLiveRegion="polite" style={{ ...body, color: theme.color.text.primary }}>
                  {SPLASH.slowBody}
                </Text>
              </View>
            ) : (
              <Text accessibilityLiveRegion="polite" style={{ ...body, color: theme.color.text.primary }}>
                {SPLASH.loading}
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {phase === 'loading' ? null : (
        <View style={{ paddingHorizontal: space['5'], paddingTop: space['4'], paddingBottom: space['6'], gap: space['3'] }}>
          <Button testID="retry" variant="primary" size="xl" fullWidth onPress={retry}>
            {SPLASH.tryAgain}
          </Button>
          <Button testID="sign-out" variant="tertiary" size="xl" fullWidth onPress={leave}>
            {SPLASH.signOut}
          </Button>
          {phase === 'error' ? (
            support.phone ? (
              <Button testID="call-support" variant="ghost" size="xl" onPress={() => callSupport(support)}>
                {CALL_SUPPORT}
              </Button>
            ) : config.status !== 'loading' ? (
              <Text testID="no-support" style={{ ...body, color: theme.color.text.primary, textAlign: 'center' }}>
                {SPLASH.noSupportShort}
              </Text>
            ) : null
          ) : null}
        </View>
      )}
    </View>
  );
}
