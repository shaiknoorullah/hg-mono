/**
 * Forced full-screen routes (manifest S5; boards `SI/Blocked` and every `SI/Blocked-*`): no bottom
 * navigation, replacing whatever was open. Suspended and banned give no reason.
 *
 * Layout, from the wrapper board: the wordmark, then a 64 px icon circle, the h1, the body (primary
 * text) and the "more" paragraph (secondary text); the footer holds the actions.
 *
 * - Account kinds (on hold, closed, unavailable) lead with Call support and its hours, then "Use a
 *   different number". With the phone line closed or off (`-nosupport` boards) there is no Call
 *   support and one way out: Sign out.
 * - Session kinds (security, revoked) lead with Sign in again; while the line is open, Call support
 *   and its hours follow. Expired is Sign in only. Update is Update the app, with the version.
 * - Mid-checkout (the 403 came from quote or createOrder) adds "That order wasn't placed." Nothing
 *   else is said about the cart or an order in progress (manifest §5 G41).
 *
 * Focus moves to the h1 on arrival (`SI/Blocked-*-focus`), then reads body, more and the footer in
 * order. Icons the design system lacks (user-block, download, lock) leave the circle empty, never a
 * borrowed glyph (Sign-in canvas, icon gap register).
 */
import * as React from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { logout, signOut } from '../api/auth';
import { callSupport, useSupport, type Support } from '../api/config';
import { Button, Icon, Wordmark, tokens, useTheme, useTypeStyle } from '../ds';
import { useFocusOnMount } from '../signin/a11y';
import { clearForced, type ForcedKind, type ForcedRoute } from './forced';

/** Copy from the `SI/Blocked` wrapper board's `renderVals`, verbatim. */
interface BlockedCopy {
  title: string;
  body: string;
  /** Shown when support is open (or for kinds that do not depend on support). */
  more: string;
  /** Shown instead of `more` when the phone line is closed or off (`-nosupport` boards). */
  moreNoSupport: string;
  /** Account kinds lead with Call support; session kinds lead with signing in again. */
  leadsWithSupport: boolean;
  /** The way out that does not need support. */
  exit: 'Sign out' | 'Sign in again' | 'Sign in' | 'Update the app';
  /** Session kinds offer Call support after the exit while the line is open. */
  offersSupport: boolean;
  /** The circle's icon; null where the Solar icon is missing from the design system. */
  icon: 'clock' | null;
}

const NO_SUPPORT_ACCOUNT =
  "Our phone line is closed right now. It's open [support_hours]. Sign out to use HalalGoes with a different number.";

export const BLOCKED_COPY: Record<ForcedKind, BlockedCopy> = {
  'on-hold': {
    title: 'Your account is on hold',
    body: "You can't place orders while your account is on hold.",
    more: 'If you think this is a mistake, or you have a question about an order or refund, call support.',
    moreNoSupport: NO_SUPPORT_ACCOUNT,
    leadsWithSupport: true,
    exit: 'Sign out',
    offersSupport: true,
    icon: null,
  },
  banned: {
    title: "This account can't be used",
    body: 'HalalGoes has closed this account.',
    more: 'If you have a question about a past order or a refund, call support and give them your phone number.',
    moreNoSupport: NO_SUPPORT_ACCOUNT,
    leadsWithSupport: true,
    exit: 'Sign out',
    offersSupport: true,
    icon: null,
  },
  unavailable: {
    title: "This account isn't available",
    body: "You can't sign in to this account right now.",
    more: 'Call support if you have a question about a past order or refund.',
    moreNoSupport: NO_SUPPORT_ACCOUNT,
    leadsWithSupport: true,
    exit: 'Sign out',
    offersSupport: true,
    icon: null,
  },
  update: {
    title: 'Update HalalGoes to keep ordering',
    body: 'This version of the app is no longer supported.',
    more: 'Get the latest version from the App Store or Google Play. Your addresses are saved to your account, so nothing is lost.',
    moreNoSupport:
      'Get the latest version from the App Store or Google Play. Your addresses are saved to your account, so nothing is lost.',
    leadsWithSupport: false,
    exit: 'Update the app',
    offersSupport: false,
    icon: null,
  },
  security: {
    title: 'We signed you out to keep your account safe',
    body: 'Your sign-in was used from two places at the same time, so we signed you out everywhere.',
    more: "Sign in again with your phone. If you didn't expect this, call support.",
    moreNoSupport: 'Sign in again with your phone.',
    leadsWithSupport: false,
    exit: 'Sign in again',
    offersSupport: true,
    icon: null,
  },
  revoked: {
    title: "You've been signed out",
    body: 'This phone is no longer signed in to your account.',
    more: "Sign in again with your number to keep ordering. If you didn't expect this, call support during its hours.",
    moreNoSupport: 'Sign in again with your number to keep ordering.',
    leadsWithSupport: false,
    exit: 'Sign in again',
    offersSupport: true,
    icon: null,
  },
  expired: {
    title: 'Please sign in again',
    body: "It's been a while since you last used HalalGoes on this phone, so your sign-in has run out.",
    more: 'Your addresses are saved to your account. Sign in with your number to pick up where you left off.',
    moreNoSupport: 'Your addresses are saved to your account. Sign in with your number to pick up where you left off.',
    leadsWithSupport: false,
    exit: 'Sign in',
    offersSupport: false,
    icon: 'clock',
  },
};

/** Added to the body only when the 403 came from the checkout call itself (`SI/Blocked-midcheckout`). */
export const MID_CHECKOUT_LINE = "That order wasn't placed.";

const STORE_URL = Platform.select({
  android: 'market://details?id=com.halalgoes.customer',
  default: 'https://apps.apple.com/app/halalgoes',
});

/** The screen's three texts for a forced route and the support line as it is now. */
export function blockedParts(forced: ForcedRoute, support: Support | null): { title: string; body: string; more: string } {
  const copy = BLOCKED_COPY[forced.kind];
  const body = forced.midCheckout ? `${copy.body} ${MID_CHECKOUT_LINE}` : copy.body;
  let more = copy.more;
  if (support?.kind !== 'open') {
    more =
      support?.kind === 'closed'
        ? copy.moreNoSupport.replace('[support_hours]', support.hours)
        : // support_enabled false with no hours: the hours sentence drops.
          copy.moreNoSupport.replace(" It's open [support_hours].", '').replace('Our phone line is closed right now. ', '');
  }
  return { title: copy.title, body, more };
}

export function blockedText(forced: ForcedRoute, support: Support | null): { title: string; description: string } {
  const { title, body, more } = blockedParts(forced, support);
  return { title, description: `${body}\n\n${more}` };
}

function appVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

export function BlockedScreen({ forced }: { forced: ForcedRoute }): React.ReactElement {
  const theme = useTheme();
  const support = useSupport();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const mono = useTypeStyle('mono.sm');
  const heading = React.useRef<Text>(null);
  // The update screen focuses its primary action on the board; DS Button takes no ref, so it
  // keeps the reading order from the top instead (ds-request: Button focus).
  useFocusOnMount(heading, forced.kind, forced.kind !== 'update');

  const copy = BLOCKED_COPY[forced.kind];
  const text = blockedParts(forced, support);
  const open = support?.kind === 'open' ? support : null;
  const version = forced.kind === 'update' ? appVersion() : null;

  const leave = (action: () => void) => () => {
    clearForced();
    action();
  };
  const exitPress =
    copy.exit === 'Update the app'
      ? () => void Linking.openURL(STORE_URL).catch(() => {})
      : copy.exit === 'Sign out'
        ? leave(() => signOut('signedOut'))
        : leave(logout);
  const hours = open?.hours ? (
    <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>Support hours: {open.hours}</Text>
  ) : null;
  const callButton = (variant: 'primary' | 'ghost') =>
    open ? (
      <Button variant={variant} size="lg" fullWidth onPress={() => callSupport(open.phoneE164)} testID="Blocked-call">
        Call support
      </Button>
    ) : null;

  let footer: React.ReactNode;
  if (copy.leadsWithSupport && open) {
    footer = (
      <>
        {callButton('primary')}
        {hours}
        <Button variant="tertiary" size="lg" fullWidth onPress={leave(logout)} testID="Blocked-exit">
          Use a different number
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="primary" size="lg" fullWidth onPress={exitPress} testID="Blocked-exit">
          {copy.exit}
        </Button>
        {copy.offersSupport && !copy.leadsWithSupport && open ? (
          <>
            {callButton('ghost')}
            {hours}
          </>
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID={`Blocked-${forced.kind}`}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: tokens.space['4'],
          paddingTop: tokens.space['12'],
          paddingBottom: tokens.space['4'],
          gap: tokens.space['6'],
        }}
      >
        <Wordmark height={32} />
        <View style={[styles.grow, { gap: tokens.space['4'] }]}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.circle, { backgroundColor: theme.color.surface.sunken }]}
            testID="Blocked-icon"
          >
            {copy.icon ? <Icon name={copy.icon} size={32} color={theme.color.text.secondary} /> : null}
          </View>
          <Text ref={heading} accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
            {text.title}
          </Text>
          <Text style={[body, { color: theme.color.text.primary }]}>{text.body}</Text>
          <Text style={[body, { color: theme.color.text.secondary }]}>{text.more}</Text>
          {version ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>
              Your version: <Text style={mono}>{version}</Text>
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: tokens.space['4'], paddingBottom: tokens.space['4'], gap: tokens.space['3'] }}>{footer}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1, justifyContent: 'center' },
  center: { textAlign: 'center' },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
