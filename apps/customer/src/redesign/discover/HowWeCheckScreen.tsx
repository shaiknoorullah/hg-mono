/**
 * D8 How we check (AC/Legal state "verify", -dark, -360, -lt; older DO/How-we-verify).
 *
 * A static page of owner-approved wording; no operation (the list of accepted certifying bodies is
 * Needs API and is not shown). The AppBar keeps the short title "How we check", which never
 * truncates at 360 wide or 200 % text; the full name wraps below as the page's h1, and focus moves
 * there on arrival.
 */
import * as React from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Card, space, useTheme, useTypeStyle } from '../ds';
import { useNav } from '../navigation/context';

export const HOW_WE_CHECK_TITLE = 'How we check halal certificates';

export const SEVEN_CHECKS: readonly string[] = [
  'The certificate is readable, complete and not altered.',
  'It comes from a certifying body on our accepted list.',
  "The name on it matches the restaurant's registered name.",
  "The address on it matches the restaurant's premises.",
  'It has been issued and has not run out.',
  'It covers the food the restaurant sells on HalalGoes.',
  "The same certificate isn't being used by another restaurant.",
];

export function HowWeCheckScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const h1 = useTypeStyle('heading.xl');
  const h2 = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const heading = React.useRef<Text>(null);

  React.useEffect(() => {
    const node = heading.current ? findNodeHandle(heading.current) : null;
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const primary = { color: theme.color.text.primary };
  const secondary = { color: theme.color.text.secondary };

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="HowWeCheck">
      <AppBar
        title="How we check"
        isPageHeading={false}
        back={nav.canGoBack ? { onPress: nav.back, previousTitle: nav.tab === 'account' ? 'Account' : 'Home' } : undefined}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>
        <Text ref={heading} accessibilityRole="header" style={[h1, primary]} testID="HowWeCheck-heading">
          {HOW_WE_CHECK_TITLE}
        </Text>
        <Text style={[body, primary]}>
          Restaurants on HalalGoes send us their halal certificate. A person on our team checks it before the
          restaurant is listed, and every new or renewed certificate is checked the same way. Only restaurants with a
          certificate we've checked are listed.
        </Text>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[h2, primary]}>
            What we check
          </Text>
          <Card variant="outlined">
            <View style={styles.list}>
              {SEVEN_CHECKS.map((check, i) => (
                <View key={check} style={styles.listItem} accessible accessibilityLabel={`${i + 1}. ${check}`}>
                  <Text style={[body, primary, styles.number]}>{`${i + 1}.`}</Text>
                  <Text style={[body, primary, styles.shrink]}>{check}</Text>
                </View>
              ))}
            </View>
          </Card>
          <Text style={[small, secondary]}>
            All seven must pass. Two of them, the dates and the reuse check, are worked out by our system and can't be
            overridden by anyone.
          </Text>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[h2, primary]}>
            What we don't do
          </Text>
          <Text style={[body, primary]}>
            We don't decide whether food is halal. That is the certifying body's role. We check that a valid certificate
            from an accepted body is in place.
          </Text>
          <Text style={[body, primary]}>
            When a certificate runs out, we take the restaurant off HalalGoes until a new certificate is checked. That
            means we can't currently vouch for it, not that the food isn't halal.
          </Text>
          <Text style={[body, primary]}>
            If a certificate is close to its end date, its badge shows the date, like "Halal certified · expires 20 Oct".
          </Text>
          <Text style={[body, primary]}>
            If some certificate details are missing or don't load, we don't show the Halal certified badge. We say the
            certificate details are unavailable instead of guessing.
          </Text>
        </View>

        <Text style={[body, primary]}>
          HalalGoes does not itself certify food. Certifying bodies certify food; we check their certificates.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['8'], gap: space['5'] },
  section: { gap: space['3'] },
  list: { gap: space['3'] },
  listItem: { flexDirection: 'row', gap: space['2'] },
  number: { minWidth: 20 },
  shrink: { flex: 1, minWidth: 0 },
});
