/**
 * Saved-address CRUD (C-30): list, make-default, delete, and hand off to `AddressFormScreen`
 * for create/edit. `deleteAddress` can 409 `ADDRESS_IN_USE` when a non-terminal order still
 * references the row — that's surfaced as a toast rather than a silent failure.
 */
import * as React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isApiError } from '@hg/api-client';
import {
  AppBar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  Toast,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { listAddresses, deleteAddress, setDefaultAddress, type Address } from '../api/addresses';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';

export function AddressesScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => listAddresses(), []);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  async function onMakeDefault(id: string): Promise<void> {
    setBusyId(id);
    try {
      await setDefaultAddress(id);
      reload();
    } catch {
      setToast("Couldn't set that as your default address.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string): Promise<void> {
    setBusyId(id);
    try {
      await deleteAddress(id);
      reload();
    } catch (e) {
      setToast(
        isApiError(e) && String(e.code) === 'ADDRESS_IN_USE'
          ? "That address is on an active order and can't be deleted yet."
          : "Couldn't delete that address.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar
        title="Saved addresses"
        back={{ onPress: nav.back }}
        actions={[
          {
            key: 'add',
            icon: <Text style={{ fontSize: 20, color: theme.color.text.onBrand }}>+</Text>,
            accessibilityLabel: 'Add address',
            onPress: () => nav.push({ name: 'addressForm', addressId: null }),
          },
        ]}
      />
      {state.kind === 'loading' ? (
        <View style={{ flex: 1, padding: 16 }}>
          <Spinner label="Loading addresses" />
        </View>
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState errorCode={state.code} onRetry={reload} />
        </View>
      ) : state.data.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <EmptyState
            title="No saved addresses"
            description="Add a delivery address to check out faster next time."
            primaryAction={{ label: 'Add address', onPress: () => nav.push({ name: 'addressForm', addressId: null }) }}
          />
        </View>
      ) : (
        <FlatList
          data={state.data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 12 }}
          renderItem={({ item }) => (
            <AddressRow
              address={item}
              busy={busyId === item.id}
              onEdit={() => nav.push({ name: 'addressForm', addressId: item.id })}
              onMakeDefault={() => onMakeDefault(item.id)}
              onDelete={() => onDelete(item.id)}
            />
          )}
        />
      )}
      {toast ? <Toast variant="danger" title={toast} onDismiss={() => setToast(null)} /> : null}
    </View>
  );
}

function AddressRow({
  address,
  busy,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  address: Address;
  busy: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.sm');

  return (
    <Card variant="outlined" onPress={onEdit}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[label, { color: theme.color.text.primary }]}>{address.label ?? 'Address'}</Text>
          {address.is_default ? <Badge label="Default" variant="brand" /> : null}
        </View>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          {address.line1}
          {address.unit ? `, Unit ${address.unit}` : ''}
        </Text>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          {address.city}, {address.province} {address.postal_code}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {!address.is_default ? (
            <Button variant="tertiary" size="sm" onPress={onMakeDefault} loading={busy}>
              Make default
            </Button>
          ) : null}
          <Button variant="tertiary" size="sm" onPress={onDelete} loading={busy} destructive>
            Delete
          </Button>
        </View>
      </View>
    </Card>
  );
}
