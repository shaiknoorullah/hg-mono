/**
 * A4 Saved addresses (boards `AC/Addresses`, `-focus`, `-loading`, `-empty`, `-error`, `-offline`,
 * `-limit`, `-deleteddefault`, `-360`, `-dark`, `-lt`).
 *
 * `listAddresses` is the one read. Each row opens that address's form (one press target); the
 * default address is first and carries the "Default" badge. The list shows what the contract
 * returns for the list and no more: label, street and unit, city, province and postal code. The
 * buzzer, delivery notes and coordinates are not on this page.
 *
 * - No saved addresses: the empty state, with Add address.
 * - Twenty saved (the most that can be kept): Add address is disabled and the reason is beside it.
 * - Offline: the last list stays on screen under a banner, and Add address is disabled with its
 *   reason. The board says "saved on this phone"; the app keeps nothing on disk, so the banner
 *   says "as of" the time the list was fetched instead.
 * - Addresses exist but none is the default (the default was deleted, and the server does not
 *   promote another): a banner asks the customer to choose one. This is read from the data, so it
 *   shows however the default went missing.
 *
 * The delete toasts of boards `-deletedlast`, `-deleteddefault` and `-deletednodefault`: deleting
 * happens in the address form (`address/AddressFormScreen`), which is closed by the time the list
 * shows, so it leaves the toast in `address/addressNotice` and this page shows it once. Its text
 * comes from the refreshed list, not from what the form assumed.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Badge, Banner, Button, Card, EmptyState, ErrorState, Icon, Skeleton, Toast, radius, space, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { listAddresses } from './accountApi';
import { clearAddressNotice, useAddressNotice } from './address/addressNotice';
import { ADDRESS_LIMIT, addressRow, defaultFirst, type Address } from './rules';

export const ADDRESSES_COPY = {
  title: 'Saved addresses',
  emptyTitle: 'No saved addresses',
  emptyBody: "Search for an address and drag the pin onto the door your rider should use. You don't need to be there.",
  errorTitle: "We couldn't load your addresses",
  errorBody: 'Check your connection and try again. Your saved addresses are safe.',
  noDefaultTitle: 'Choose a default address',
  noDefaultBody: "Your default was deleted. Open an address and make it your default, and we'll use it first on Home and at checkout.",
  limit: "You've saved 20, the most you can keep. Delete one to add another.",
  offlineAdd: "You're offline. Connect to add an address.",
} as const;

export function AddressesScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const small = useTypeStyle('body.sm');
  const { online } = useConnectivity();
  const { query, reload } = useQuery(listAddresses, []);
  const notice = useAddressNotice();
  // Shown once: leaving the list drops it.
  React.useEffect(() => clearAddressNotice, []);

  const add = () => nav.push({ name: 'addressForm', addressId: null });
  const addresses = query.kind === 'ready' ? query.data : [];
  const atLimit = addresses.length >= ADDRESS_LIMIT;
  const whyDisabled = !online ? ADDRESSES_COPY.offlineAdd : atLimit ? ADDRESSES_COPY.limit : null;

  let body: React.ReactElement;
  if (query.kind === 'loading') {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading addresses" aria-busy testID="Addresses-loading">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={84} />
          ))}
        </View>
      </View>
    );
  } else if (query.kind === 'error') {
    body = (
      <ErrorState
        variant="page"
        errorCode={query.code}
        offline={!online}
        title={ADDRESSES_COPY.errorTitle}
        description={ADDRESSES_COPY.errorBody}
        onRetry={reload}
        testID="Addresses-error"
      />
    );
  } else if (addresses.length === 0) {
    body = (
      <EmptyState
        variant="page"
        headingLevel={1}
        autoFocus
        illustration={<Icon name="map" size={48} color={theme.color.text.secondary} />}
        title={ADDRESSES_COPY.emptyTitle}
        description={ADDRESSES_COPY.emptyBody}
        primaryAction={{ label: 'Add address', onPress: add, disabled: !online }}
        testID="Addresses-empty"
      />
    );
  } else {
    const hasDefault = addresses.some((a) => a.is_default);
    body = (
      <View style={styles.stack}>
        {!online ? (
          <Banner
            variant="info"
            title="You're offline"
            description={`Showing your addresses as of ${formatTime(query.asOf)}. Connect to add or change one.`}
            testID="Addresses-offline"
          />
        ) : null}
        {!hasDefault ? (
          <Banner
            variant="warning"
            title={ADDRESSES_COPY.noDefaultTitle}
            description={ADDRESSES_COPY.noDefaultBody}
            testID="Addresses-noDefault"
          />
        ) : null}
        <View style={styles.stack} testID="Addresses-list">
          {defaultFirst(addresses).map((a) => (
            <AddressCard key={a.id} address={a} onPress={() => nav.push({ name: 'addressForm', addressId: a.id })} />
          ))}
        </View>
        <Button variant="primary" size="lg" fullWidth iconStart="plus" disabled={whyDisabled !== null} onPress={add} testID="Addresses-add">
          Add address
        </Button>
        {whyDisabled ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Addresses-whyDisabled">
            {whyDisabled}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressesScreen">
      <AppBar
        title={ADDRESSES_COPY.title}
        tone="cream"
        loading={query.kind === 'loading'}
        isPageHeading={query.kind === 'ready' && addresses.length > 0}
        back={{ onPress: nav.back, previousTitle: 'Account' }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: theme.density.gutter }]}>{body}</ScrollView>
      {notice ? (
        <View pointerEvents="box-none" style={[styles.toastDock, { paddingHorizontal: theme.density.gutter }]}>
          <Toast variant="neutral" title={notice.title} description={notice.description} onDismiss={clearAddressNotice} testID="Addresses-notice" />
        </View>
      ) : null}
    </View>
  );
}

function AddressCard({ address, onPress }: { address: Address; onPress: () => void }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const row = addressRow(address);
  return (
    <Card
      variant="outlined"
      radius={radius.lg}
      onPress={onPress}
      accessibilityLabel={`${row.title}${address.is_default ? ', default' : ''}, ${row.street}, ${row.area}`}
      contentStyle={styles.card}
      testID={`Address-${address.id}`}
    >
      <View style={styles.cardText}>
        <View style={styles.titleRow}>
          <Text style={[label, { color: theme.color.text.primary }]}>{row.title}</Text>
          {address.is_default ? <Badge variant="neutral" size="sm" label="Default" testID={`Address-${address.id}-default`} /> : null}
        </View>
        {row.street !== row.title ? <Text style={[small, { color: theme.color.text.secondary }]}>{row.street}</Text> : null}
        <Text style={[small, { color: theme.color.text.secondary }]}>{row.area}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={theme.color.text.secondary} />
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], flexGrow: 1 },
  stack: { gap: space['4'] },
  card: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 96 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },
});
