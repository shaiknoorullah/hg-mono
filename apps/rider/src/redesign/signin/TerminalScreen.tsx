/**
 * R03 terminal routes: the screens a rider cannot work past. Boards: SO `App-UpdateRequired`,
 * `Route-WrongRole`, `Route-WrongRole-NoSupport`, `SignIn-Deactivated`,
 * `SignIn-Deactivated-NoSupport`.
 *
 * - `update`: APP_UPDATE_REQUIRED, or a `next_route` this build does not know.
 * - `wrong-role`: a known route that belongs to another app; updating will not help.
 * - `closed`: DEACTIVATED with no delivery in hand, or 403 ACCOUNT_NOT_ACTIVE. Offers "Back to
 *   sign in", never "use a different number" (SO route note).
 *
 * Support hours are `PublicConfig.support_hours`, never hardcoded; with support off the button
 * is replaced by "Support isn't available right now. Try again later."
 */
import * as React from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { Button, space, typeStyle, useTheme } from '../ds';
import { callSupport, usePublicConfig, supportFrom } from '../data/config';
import type { ScreenProps } from '../nav/registry';
import { signOut } from '../session/signOut';
import { CALL_SUPPORT, TERMINAL } from './copy';
import { revokeSession } from './otp';

export interface TerminalScreenProps extends ScreenProps<'terminal'> {
  /** Signed out already (a closed answer from verify): go back to the phone step. */
  onBackToSignIn?: () => void;
}

/** The store page for this build's package (`app.config.js`: com.halalgoes.rider[.dev]). */
function storeUrl(): string {
  const pkg = Constants.expoConfig?.android?.package ?? 'com.halalgoes.rider';
  if (Platform.OS === 'ios') {
    const ios = (Constants.expoConfig?.ios as { appStoreUrl?: string } | undefined)?.appStoreUrl;
    if (ios) return ios;
  }
  return Platform.OS === 'android' ? `market://details?id=${pkg}` : `https://play.google.com/store/apps/details?id=${pkg}`;
}

export function TerminalScreen({ params, onBackToSignIn }: TerminalScreenProps): React.ReactElement {
  const theme = useTheme();
  const config = usePublicConfig();
  const support = supportFrom(config.data);
  const kind = params.kind;
  const h1 = typeStyle(theme, 'heading.xl');
  const body = typeStyle(theme, 'body.lg');

  const leave = () => {
    if (onBackToSignIn) {
      onBackToSignIn();
      return;
    }
    void revokeSession();
    signOut();
  };

  const title = kind === 'update' ? TERMINAL.updateTitle : kind === 'wrong-role' ? TERMINAL.wrongRoleTitle : TERMINAL.closedTitle;
  const text =
    kind === 'update'
      ? TERMINAL.updateBody
      : kind === 'wrong-role'
        ? support.phone
          ? TERMINAL.wrongRoleBody
          : TERMINAL.wrongRoleBodyNoSupport
        : support.phone
          ? TERMINAL.closedBody
          : TERMINAL.closedBodyNoSupport;

  return (
    <View testID={`terminal-${kind}`} style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space['5'], gap: space['4'] }}>
        {/* ds-request(native): Icon glyphs refresh, warning, lock — SO App-UpdateRequired, Route-WrongRole, SignIn-Deactivated (not in the icon set yet) */}
        <Text accessibilityRole="header" style={{ ...h1, color: theme.color.text.primary }}>
          {title}
        </Text>
        <Text style={{ ...body, color: theme.color.text.primary }}>{text}</Text>
        {kind !== 'update' && !support.phone && config.status !== 'loading' ? (
          <Text testID="no-support" style={{ ...body, color: theme.color.text.primary }}>
            {TERMINAL.noSupport}
          </Text>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: space['5'], paddingTop: space['4'], paddingBottom: space['6'], gap: space['3'] }}>
        {kind === 'update' ? (
          <Button testID="open-store" variant="primary" size="xl" fullWidth onPress={() => void Linking.openURL(storeUrl())}>
            {TERMINAL.openStore}
          </Button>
        ) : (
          <>
            {support.phone ? (
              <>
                <Button testID="call-support" variant="secondary" size="xl" fullWidth onPress={() => callSupport(support)}>
                  {CALL_SUPPORT}
                </Button>
                {support.hours ? (
                  <Text testID="support-hours" style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.secondary, textAlign: 'center' }}>
                    {TERMINAL.hours(support.hours)}
                  </Text>
                ) : null}
              </>
            ) : null}
            <Button testID="leave" variant="tertiary" size="xl" fullWidth onPress={leave}>
              {kind === 'closed' ? TERMINAL.backToSignIn : TERMINAL.signOut}
            </Button>
          </>
        )}
      </View>
    </View>
  );
}
