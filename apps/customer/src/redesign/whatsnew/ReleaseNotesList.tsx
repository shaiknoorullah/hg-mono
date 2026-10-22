/**
 * One release's notes as a bulleted list, shared by the sheet and the page (boards `AC/WhatsNew*`
 * draw a `ul` of sentences; each note here has a short title and a body, so the title leads).
 * Composed from `Text` on the design system's type roles; the design system has no list component.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { space, useTheme, useTypeStyle } from '../ds';
import type { ReleaseNote } from './releaseNotes';

export function ReleaseNotesList({ notes, testID }: { notes: readonly ReleaseNote[]; testID?: string }): React.ReactElement {
  const theme = useTheme();
  const title = useTypeStyle('label.lg');
  const body = useTypeStyle('body.md');
  return (
    <View accessibilityRole="list" style={styles.list} testID={testID}>
      {notes.map((note) => (
        <View key={note.title} style={styles.item}>
          <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[body, { color: theme.color.text.primary }]}>
            {'•'}
          </Text>
          <View style={styles.text}>
            <Text style={[title, { color: theme.color.text.primary }]}>{note.title}</Text>
            <Text style={[body, { color: theme.color.text.secondary }]}>{note.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space['3'] },
  item: { flexDirection: 'row', gap: space['2'] },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
