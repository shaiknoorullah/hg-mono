/**
 * Screen parts the earnings screens share (EA boards): the paused and error blocks, the paging
 * footer, link rows and text roles. Screen-local layout composed from `../ds`, not components:
 * nothing outside this folder imports them. One copy, so the two screen files do not carry
 * copies of each other.
 */
import * as React from 'react';
import { Text, View } from 'react-native';

import { Banner, Button, Card, ErrorState, Skeleton, space, typeStyle, useTheme } from '../ds';
import type { RiderError } from '../data/errors';
import { isRateLimited, useCooldown } from './api';
import { RATE_LIMITED_WAIT, type StateCopy } from './copy';

export function PausedBlock({
  copy,
  onAccount,
  testID,
  buttonTestID,
}: {
  copy: StateCopy;
  onAccount: () => void;
  testID: string;
  buttonTestID?: string;
}): React.ReactElement {
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      {/* ds-request(native): ErrorState rider variant (lock icon, action in the bottom third) — EA *-not-active */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      <Button variant="primary" size="xl" fullWidth onPress={onAccount} testID={buttonTestID}>
        {copy.action ?? 'Go to Account'}
      </Button>
    </View>
  );
}

export function ScreenError({
  copy,
  error,
  busy,
  onRetry,
  testID,
}: {
  copy: StateCopy;
  error: RiderError | null;
  busy: boolean;
  onRetry: () => void;
  testID: string;
}): React.ReactElement {
  const rateLimited = isRateLimited(error);
  const waiting = useCooldown(error);
  return (
    <View style={{ gap: space['4'] }} testID={testID}>
      {/* ds-request(native): ErrorState rider variant (role=alert on heading + message, action in the bottom third) — EA *-error / *-rate-limited */}
      <ErrorState variant="inline" title={copy.title} description={copy.body} />
      {rateLimited ? <Body>{RATE_LIMITED_WAIT}</Body> : null}
      <Button variant="primary" size="xl" fullWidth disabled={waiting} loading={busy} onPress={onRetry} testID={`${testID}-retry`}>
        {copy.action ?? 'Try again'}
      </Button>
    </View>
  );
}

export function PagingFooter({
  hasMore,
  online,
  loading,
  error,
  onMore,
  copy,
  testID,
}: {
  hasMore: boolean;
  online: boolean;
  loading: boolean;
  error: RiderError | null;
  onMore: () => void;
  copy: { more: string; loading: string; error: StateCopy; end: string; offline?: string };
  testID: string;
}): React.ReactElement | null {
  if (!hasMore) return <Body secondary>{copy.end}</Body>;
  // Nothing older loads offline: Payouts says so (EA Payouts-offline); Activity shows nothing
  // (EA Activity-offline) and the button comes back with the network.
  if (!online) return copy.offline ? <Body secondary>{copy.offline}</Body> : null;
  return (
    <View style={{ gap: space['3'] }}>
      {error ? (
        <>
          <Banner variant="neutral" title={copy.error.title} description={copy.error.body} testID={`${testID}-more-error`} />
          <Button variant="tertiary" size="xl" fullWidth onPress={onMore} testID={`${testID}-more-retry`}>
            {copy.error.action ?? 'Try again'}
          </Button>
        </>
      ) : (
        <Button variant="tertiary" size="xl" fullWidth loading={loading} onPress={onMore} accessibilityLabel={loading ? copy.loading : copy.more} testID={`${testID}-more`}>
          {copy.more}
        </Button>
      )}
      {loading ? <Skeleton variant="text" lines={2} /> : null}
    </View>
  );
}

export function LinkRow({ title, sub, onPress, testID }: { title: string; sub: string; onPress: () => void; testID: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={`${title}. ${sub}`} style={{ minHeight: 72 }} testID={testID}>
      <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>{title}</Text>
      <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{sub}</Text>
    </Card>
  );
}

export function SectionTitle({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[typeStyle(theme, 'heading.md'), { color: theme.color.text.primary }]}>
      {children}
    </Text>
  );
}

export function Body({ children, secondary = false, testID }: { children: React.ReactNode; secondary?: boolean; testID?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text style={[typeStyle(theme, 'body.lg'), { color: secondary ? theme.color.text.secondary : theme.color.text.primary }]} testID={testID}>
      {children}
    </Text>
  );
}

export function LiveStatus({ text }: { text: string }): React.ReactElement {
  return (
    <Text accessibilityLiveRegion="polite" style={{ position: 'absolute', opacity: 0 }}>
      {text}
    </Text>
  );
}
