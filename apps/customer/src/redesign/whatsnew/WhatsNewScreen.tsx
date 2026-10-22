/**
 * A7 What's new, the page opened from Account (boards `AC/WhatsNew-page`, `-pagefocus`,
 * `-page-360`, `-page-dark`, `-page-lt`, `-empty`): every release up to the installed version,
 * newest first, the installed one marked "Your version".
 *
 * The notes ship inside the app, so there is no loading or error screen (the boards draw none): a
 * file that cannot be read is the empty state, which points to the store listing. Opening the page
 * counts as reading the notes, so the sheet on Home does not repeat them.
 *
 * Gap: the empty state's `gift` icon is not in the design system's icon set; as the board draws
 * it, the illustration slot is left empty.
 */
import * as React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Badge, Card, EmptyState, radius, space, useTheme, useTypeStyle } from '../ds';
import { useNav } from '../navigation/context';
import { STORE_URL } from '../session/BlockedScreen';
import { WHATS_NEW } from './copy';
import { ReleaseNotesList } from './ReleaseNotesList';
import { appVersion, compareVersions, loadReleaseNotes, releaseDate, released } from './releaseNotes';
import { markSeen } from './store';

export function WhatsNewScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const heading = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const current = appVersion();
  const releases = React.useMemo(() => released(loadReleaseNotes(), current), [current]);
  const newest = releases[0]?.version ?? null;

  React.useEffect(() => {
    if (newest !== null) markSeen(newest);
  }, [newest]);

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="WhatsNewScreen">
      <AppBar title={WHATS_NEW.title} tone="cream" back={{ onPress: nav.back, previousTitle: WHATS_NEW.back }} />
      {releases.length === 0 ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>
          <EmptyState
            variant="inline"
            headingLevel={2}
            title={WHATS_NEW.empty.title}
            description={WHATS_NEW.empty.body}
            secondaryAction={{ label: WHATS_NEW.empty.store, onPress: () => void Linking.openURL(STORE_URL).catch(() => {}), testID: 'WhatsNew-store' }}
            testID="WhatsNew-empty"
          />
          <Text style={[small, styles.centered, { color: theme.color.text.secondary }]}>{WHATS_NEW.empty.youHave(current)}</Text>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>
          {releases.map((release) => (
            <Card key={release.version} variant="outlined" radius={radius.lg} testID={`WhatsNew-card-${release.version}`}>
              <View style={styles.release}>
                <View style={styles.titleRow}>
                  <Text accessibilityRole="header" aria-level={2} style={[heading, { color: theme.color.text.primary }]}>
                    {WHATS_NEW.version(release.version)}
                  </Text>
                  {compareVersions(release.version, current) === 0 ? (
                    <Badge variant="brand" size="sm" label={WHATS_NEW.yourVersion} testID={`WhatsNew-current-${release.version}`} />
                  ) : null}
                </View>
                <Text style={[small, { color: theme.color.text.secondary }]}>{releaseDate(release.date)}</Text>
                <ReleaseNotesList notes={release.notes} />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], gap: space['5'] },
  release: { gap: space['3'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
  centered: { textAlign: 'center' },
});
