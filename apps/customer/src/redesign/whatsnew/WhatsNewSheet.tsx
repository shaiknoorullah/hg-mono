/**
 * A7 What's new, the sheet (boards `AC/WhatsNew`, `-multi`, `-multi360`, `-sheetfocus`, `-dark`,
 * `-lt`, `-held`, `-later`): shown once after an update, on Home only.
 *
 * Home mounts `WhatsNewOnHome`. The sheet opens when this phone has release notes it has not been
 * told about, and waits while anything else is in progress: an order is open (the board "held
 * during tracking": checkout and tracking are screens above Home, so Home is not even mounted
 * while they are up, and an order in progress is the same flow still open on Home's strip), or
 * another Home sheet is up. It opens on the first Home visit after that, once.
 *
 * "Got it", the close button, a swipe, a scrim tap and Back all mark the newest version shown as
 * seen. The app closing with the sheet up does not.
 *
 * Without storage that survives a restart the sheet never opens by itself (`store.ts`); the page
 * in Account is the way in.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Sheet, space, useTheme, useTypeStyle } from '../ds';
import { readActiveOrder } from '../tracking/useActiveOrder';
import { WHATS_NEW } from './copy';
import { ReleaseNotesList } from './ReleaseNotesList';
import { appVersion, loadReleaseNotes, releaseDate, unseen, type Release } from './releaseNotes';
import { markSeen, useSeen } from './store';

export function WhatsNewOnHome({ held }: { held: boolean }): React.ReactElement | null {
  const seen = useSeen();
  const [shown, setShown] = React.useState<Release[] | null>(null);

  const due = seen.loaded && seen.canAutoShow ? unseen(loadReleaseNotes(), appVersion(), seen.lastSeen) : [];
  const dueKey = due.map((r) => r.version).join(',');

  React.useEffect(() => {
    if (shown !== null || held || dueKey === '') return undefined;
    let live = true;
    // Home's own strip polls the order every 15 seconds; ask once more before covering the page,
    // so an order that has just been placed holds the sheet back. A read that fails counts as no
    // order, as it does for the strip.
    readActiveOrder().then(
      (order) => {
        if (live && order === null) setShown(due);
      },
      () => {
        if (live) setShown(due);
      },
    );
    return () => {
      live = false;
    };
    // `due` is rebuilt every render; `dueKey` says when its content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, dueKey, shown]);

  if (shown === null) return null;
  const close = () => {
    markSeen(shown[0]!.version);
    setShown(null);
  };
  return <WhatsNewSheet releases={shown} onClose={close} />;
}

export function WhatsNewSheet({ releases, onClose }: { releases: readonly Release[]; onClose: () => void }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  return (
    <Sheet
      open
      onClose={onClose}
      title={WHATS_NEW.sheetTitle}
      scrollable
      snapPoints={[0.82]}
      footer={
        <View style={styles.footer}>
          <Button variant="primary" size="lg" fullWidth onPress={onClose} testID="WhatsNew-gotIt">
            {WHATS_NEW.gotIt}
          </Button>
          <Text style={[small, styles.footerLine, { color: theme.color.text.secondary }]}>{WHATS_NEW.footerLine}</Text>
        </View>
      }
      testID="WhatsNew-sheet"
    >
      <View style={styles.body}>
        <Text style={[body, { color: theme.color.text.primary }]}>
          {releases.length === 1 ? WHATS_NEW.introOne : WHATS_NEW.introMany(releases.length)}
        </Text>
        {releases.map((release) => (
          <View key={release.version} style={styles.release} testID={`WhatsNew-version-${release.version}`}>
            <Text accessibilityRole="header" aria-level={3} style={[heading, { color: theme.color.text.primary }]}>
              {`${WHATS_NEW.version(release.version)} · `}
              <Text style={{ color: theme.color.text.secondary }}>{releaseDate(release.date)}</Text>
            </Text>
            <ReleaseNotesList notes={release.notes} />
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space['5'] },
  release: { gap: space['2'] },
  footer: { gap: space['2'] },
  footerLine: { textAlign: 'center' },
});
