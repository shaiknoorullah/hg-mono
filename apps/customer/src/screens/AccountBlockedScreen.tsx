/**
 * The full-screen routes the server can force at sign-in (Sign-in canvas, "Routes the server can
 * force"): an account on hold, a closed account, an account that isn't available, and an app too
 * old to use. Full screen, no BottomNav, nothing behind it.
 *
 * `verifyOtp` routes here by `next_route`: `SUSPENDED` with `principal.status` SUSPENDED (on hold),
 * BANNED (closed) or anything else (the neutral fallback), which a 403 from verify also opens;
 * `APP_UPDATE_REQUIRED` and any route this app doesn't know show the update screen. Suspended and
 * banned give no reason because the contract returns none.
 *
 * With the phone line open: Call support, the hours, and "Use a different number". With it closed
 * (`support_enabled` false) there is one exit, Sign out, never "try again later".
 */
import * as React from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Button, tokens, useTheme, useTypeStyle } from '@hg/ui-native';

import { FlowLayout } from '../components/FlowLayout';
import { callSupport, useSupport } from '../api/support';

export type BlockedReason = 'suspended' | 'banned' | 'unavailable' | 'update';

const COPY: Record<BlockedReason, { title: string; body: string; more: string }> = {
  suspended: {
    title: 'Your account is on hold',
    body: "You can't place orders while your account is on hold.",
    more: 'If you think this is a mistake, or you have a question about an order or refund, call support.',
  },
  banned: {
    title: "This account can't be used",
    body: 'HalalGoes has closed this account.',
    more: 'If you have a question about a past order or a refund, call support and give them your phone number.',
  },
  unavailable: {
    title: "This account isn't available",
    body: "You can't sign in to this account right now.",
    more: 'Call support if you have a question about a past order or refund.',
  },
  update: {
    title: 'Update HalalGoes to keep ordering',
    body: 'This version of the app is no longer supported.',
    more: 'Get the latest version from the App Store or Google Play. Your addresses are saved to your account, so nothing is lost.',
  },
};

/** The store page for this build, where one is known. */
function storeUrl(): string | null {
  const id = Constants.expoConfig?.android?.package;
  if (Platform.OS === 'android' && id) return `market://details?id=${id}`;
  if (Platform.OS === 'ios') return 'itms-apps://apps.apple.com/ca/search?term=HalalGoes';
  return null;
}

export function AccountBlockedScreen({
  reason,
  onSignOut,
}: {
  reason: BlockedReason;
  /** Back to the phone step ("Use a different number" and "Sign out" both land there). */
  onSignOut: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const support = useSupport();
  const copy = COPY[reason];
  const update = reason === 'update';
  const phone = support?.phoneE164 ?? null;
  const closedLine =
    !update && support && !phone
      ? `Our phone line is closed right now.${support.hours ? ` It's open ${support.hours}.` : ''} Sign out to use HalalGoes with a different number.`
      : null;
  const store = update ? storeUrl() : null;

  return (
    <FlowLayout
      wordmark
      centerBody
      testID="AccountBlockedScreen"
      footer={
        update ? (
          store ? (
            <Button variant="primary" size="lg" fullWidth onPress={() => void Linking.openURL(store)}>
              Update the app
            </Button>
          ) : null
        ) : phone ? (
          <>
            <Button variant="primary" size="lg" fullWidth onPress={() => callSupport(phone)}>
              Call support
            </Button>
            {support?.hours ? (
              <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
                Support hours: {support.hours}
              </Text>
            ) : null}
            <Button variant="tertiary" size="lg" fullWidth onPress={onSignOut}>
              Use a different number
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" fullWidth onPress={onSignOut}>
            Sign out
          </Button>
        )
      }
    >
      {/* The Solar set has no user-block or download glyph yet: the slot stays empty rather than
          borrow one (Sign-in canvas, icon gap register). */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 64,
          height: 64,
          borderRadius: tokens.radius.full,
          backgroundColor: theme.color.surface.sunken,
        }}
      />
      <Text accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
        {copy.title}
      </Text>
      <Text style={[body, { color: theme.color.text.primary }]}>{copy.body}</Text>
      <Text style={[body, { color: theme.color.text.secondary }]}>{closedLine ?? copy.more}</Text>
      {update ? (
        <Text style={[small, { color: theme.color.text.secondary }]}>
          Your version: {Constants.expoConfig?.version ?? 'unknown'}
        </Text>
      ) : null}
    </FlowLayout>
  );
}
