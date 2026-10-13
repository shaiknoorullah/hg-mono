/**
 * Terms and privacy (boards `AC/Legal-terms`, `-termssignedout`, `-termsloading`, `-termserror`).
 *
 * Opened from Sign in while signed out (no bottom navigation; Back returns to Sign in) and from
 * Account. The version comes from `PublicConfig.terms_version`; while it loads no version shows,
 * and if it fails the error replaces the rows rather than guessing one.
 *
 * Not shipped as drawn: the board's rows open the full legal text, which legal has not supplied
 * yet ("[LEGAL TEXT]"), so the rows are plain and the "Each opens the full text" line is left out.
 * Recording acceptance of `terms_version` has no API (manifest §5 G38), so nothing here says the
 * customer accepted a version.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getPublicConfig } from '../api/config';
import { AppBar, Card, ErrorState, Skeleton, tokens, useTheme, useTypeStyle } from '../ds';
import { useQuery } from '../lib/query';
import { useNav } from '../navigation/context';

export function TermsScreen({ signedOut = false }: { signedOut?: boolean }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const label = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const { query, reload } = useQuery(() => getPublicConfig(), []);

  const content =
    query.kind === 'loading' ? (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading terms" testID="Terms-loading">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: tokens.space['2'] }}>
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="text" lines={2} />
        </View>
      </View>
    ) : query.kind === 'error' ? (
      <ErrorState
        variant="inline"
        errorCode={query.code}
        title="We couldn't load the terms"
        description="Check your connection and try again. The terms you agreed to haven't changed."
        onRetry={reload}
        testID="Terms-error"
      />
    ) : (
      <Card variant="outlined" padding={0} testID="Terms-rows">
        <View style={[styles.row, { paddingHorizontal: tokens.space['4'], paddingVertical: tokens.space['3'] }]}>
          <Text style={[label, { color: theme.color.text.primary }]}>Terms of use</Text>
          {query.data.terms_version ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>Version {query.data.terms_version}</Text>
          ) : null}
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.border.decorative }} />
        <View style={[styles.row, { paddingHorizontal: tokens.space['4'], paddingVertical: tokens.space['3'] }]}>
          <Text style={[label, { color: theme.color.text.primary }]}>Privacy policy</Text>
          <Text style={[small, { color: theme.color.text.secondary }]}>How we use and protect your information</Text>
        </View>
      </Card>
    );

  const page = (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="TermsScreen">
      <AppBar
        title="Terms and privacy"
        loading={query.kind === 'loading'}
        back={{ onPress: nav.back, previousTitle: signedOut ? 'sign in' : 'Account' }}
      />
      <ScrollView contentContainerStyle={{ padding: tokens.space['4'], gap: tokens.space['5'] }}>{content}</ScrollView>
    </View>
  );
  // Signed out, the Shell already keeps the page inside the safe area.
  return signedOut ? page : <SafeAreaView style={styles.fill}>{page}</SafeAreaView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { minHeight: 64, justifyContent: 'center', gap: 2 },
});
