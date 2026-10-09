/**
 * Forced full-screen routes (manifest S5; boards `SI/Blocked-*`): no bottom navigation, replacing
 * whatever was open. Suspended and banned give no reason. With support closed or unavailable there
 * is no "Call support", only one way out.
 *
 * WP0 ships the routing and the drawn copy; WP1 (#656) finishes the board details (icons, focus
 * order per `SI/Blocked-*-focus`, the update screen's store link).
 */
import * as React from 'react';
import { Linking, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setToken } from '../../api/token';
import { EmptyState, useTheme } from '../ds';
import { callSupport, useSupport, type Support } from '../api/config';
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
}

const NO_SUPPORT_ACCOUNT =
  "Our phone line is closed right now. It's open [support_hours]. Sign out to use HalalGoes with a different number.";

const ON_HOLD: BlockedCopy = {
  title: 'Your account is on hold',
  body: "You can't place orders while your account is on hold.",
  more: 'If you think this is a mistake, or you have a question about an order or refund, call support.',
  moreNoSupport: NO_SUPPORT_ACCOUNT,
  leadsWithSupport: true,
  exit: 'Sign out',
};

export const BLOCKED_COPY: Record<ForcedKind, BlockedCopy> = {
  'on-hold': ON_HOLD,
  banned: {
    title: "This account can't be used",
    body: 'HalalGoes has closed this account.',
    more: 'If you have a question about a past order or a refund, call support and give them your phone number.',
    moreNoSupport: NO_SUPPORT_ACCOUNT,
    leadsWithSupport: true,
    exit: 'Sign out',
  },
  unavailable: {
    title: "This account isn't available",
    body: "You can't sign in to this account right now.",
    more: 'Call support if you have a question about a past order or refund.',
    moreNoSupport: NO_SUPPORT_ACCOUNT,
    leadsWithSupport: true,
    exit: 'Sign out',
  },
  update: {
    title: 'Update HalalGoes to keep ordering',
    body: 'This version of the app is no longer supported.',
    more: 'Get the latest version from the App Store or Google Play. Your addresses are saved to your account, so nothing is lost.',
    moreNoSupport: 'Get the latest version from the App Store or Google Play. Your addresses are saved to your account, so nothing is lost.',
    leadsWithSupport: false,
    exit: 'Update the app',
  },
  security: {
    title: 'We signed you out to keep your account safe',
    body: 'Your sign-in was used from two places at the same time, so we signed you out everywhere.',
    more: "Sign in again with your phone. If you didn't expect this, call support.",
    moreNoSupport: 'Sign in again with your phone.',
    leadsWithSupport: false,
    exit: 'Sign in again',
  },
  revoked: {
    title: "You've been signed out",
    body: 'This phone is no longer signed in to your account.',
    more: "Sign in again with your number to keep ordering. If you didn't expect this, call support during its hours.",
    moreNoSupport: 'Sign in again with your number to keep ordering.',
    leadsWithSupport: false,
    exit: 'Sign in again',
  },
  expired: {
    title: 'Please sign in again',
    body: "It's been a while since you last used HalalGoes on this phone, so your sign-in has run out.",
    more: 'Your addresses are saved to your account. Sign in with your number to pick up where you left off.',
    moreNoSupport: 'Your addresses are saved to your account. Sign in with your number to pick up where you left off.',
    leadsWithSupport: false,
    exit: 'Sign in',
  },
};

/** Added to the body only when the 403 came from the checkout call itself (`SI/Blocked-midcheckout`). */
export const MID_CHECKOUT_LINE = "That order wasn't placed.";

const STORE_URL = Platform.select({
  android: 'market://details?id=com.halalgoes.customer',
  default: 'https://apps.apple.com/app/halalgoes',
});

export function blockedText(forced: ForcedRoute, support: Support | null): { title: string; description: string } {
  const copy = BLOCKED_COPY[forced.kind];
  const body = forced.midCheckout ? `${copy.body} ${MID_CHECKOUT_LINE}` : copy.body;
  let more = copy.more;
  if (support?.kind !== 'open') {
    more =
      support?.kind === 'closed'
        ? copy.moreNoSupport.replace('[support_hours]', support.hours)
        : // support_enabled false with no hours: the hours sentence drops.
          copy.moreNoSupport.replace(" It's open [support_hours].", '').replace("Our phone line is closed right now. ", '');
  }
  return { title: copy.title, description: `${body}\n\n${more}` };
}

export function BlockedScreen({ forced }: { forced: ForcedRoute }): React.ReactElement {
  const theme = useTheme();
  const support = useSupport();
  const copy = BLOCKED_COPY[forced.kind];
  const { title, description } = blockedText(forced, support);
  const exit = (): void => {
    if (forced.kind === 'update') {
      void Linking.openURL(STORE_URL).catch(() => {});
      return;
    }
    clearForced();
    setToken(null);
  };
  const call = support?.kind === 'open' && forced.kind !== 'update' && forced.kind !== 'expired' ? support : null;
  const exitAction = { label: copy.exit, onPress: exit, testID: 'Blocked-exit' };
  const callAction = call ? { label: 'Call support', onPress: () => callSupport(call.phoneE164), testID: 'Blocked-call' } : undefined;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID={`Blocked-${forced.kind}`}>
      <ScrollView contentContainerStyle={styles.center}>
        <EmptyState
          variant="page"
          headingLevel={1}
          autoFocus={forced.kind !== 'update'}
          title={title}
          description={description}
          primaryAction={copy.leadsWithSupport && callAction ? callAction : exitAction}
          secondaryAction={copy.leadsWithSupport ? (callAction ? exitAction : undefined) : callAction}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flexGrow: 1, justifyContent: 'center', padding: 16 },
});
