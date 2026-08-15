/**
 * Create or edit a saved address (C-30). `addressId === null` is create; otherwise the screen
 * loads the address first so edit starts from real data.
 *
 * `latitude`/`longitude` are required by the contract and normally come from a map picker; this
 * app has none yet (the checkout seed carries the same note in `api/addresses.ts`), so every
 * address this form writes is pinned to the same served downtown-Toronto point. Every other
 * field — label, line1/2, unit, buzzer, city, province, postal code, delivery notes, default —
 * is real and round-trips through the contract.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, Button, ErrorState, Input, Select, Spinner, Switch, Toast, useTheme } from '@hg/ui-native';
import type { SelectOption } from '@hg/ui-native';

import {
  createAddress,
  getAddress,
  updateAddress,
  type Address,
} from '../api/addresses';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';

const PROVINCES: SelectOption[] = [
  { value: 'ON', label: 'Ontario' },
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
];

export function AddressFormScreen({ addressId }: { addressId: string | null }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();

  const { state, reload } = useAsync<Address | null>(
    () => (addressId ? getAddress(addressId) : Promise.resolve(null)),
    [addressId],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title={addressId ? 'Edit address' : 'Add address'} back={{ onPress: nav.back }} />
      {state.kind === 'loading' ? (
        <View style={{ flex: 1, padding: 16 }}>
          <Spinner label="Loading address" />
        </View>
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState errorCode={state.code} onRetry={reload} />
        </View>
      ) : (
        <Form
          addressId={addressId}
          existing={state.data}
          bottomInset={insets.bottom}
          onSaved={() => nav.back()}
        />
      )}
    </View>
  );
}

function Form({
  addressId,
  existing,
  bottomInset,
  onSaved,
}: {
  addressId: string | null;
  existing: Address | null;
  bottomInset: number;
  onSaved: () => void;
}): React.ReactElement {
  const [label, setLabel] = React.useState(existing?.label ?? '');
  const [line1, setLine1] = React.useState(existing?.line1 ?? '');
  const [unit, setUnit] = React.useState(existing?.unit ?? '');
  const [buzzer, setBuzzer] = React.useState(existing?.buzzer ?? '');
  const [city, setCity] = React.useState(existing?.city ?? 'Toronto');
  const [province, setProvince] = React.useState<string>(existing?.province ?? 'ON');
  const [postalCode, setPostalCode] = React.useState(existing?.postal_code ?? '');
  const [notes, setNotes] = React.useState(existing?.delivery_notes ?? '');
  const [isDefault, setIsDefault] = React.useState(existing?.is_default ?? false);
  const [saving, setSaving] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const valid = line1.trim().length > 0 && city.trim().length > 0 && postalCode.trim().length > 0;

  async function save(): Promise<void> {
    if (!valid) {
      setErrorText('Street address, city and postal code are required.');
      return;
    }
    setErrorText(null);
    setSaving(true);
    const payload = {
      label: label.trim() || undefined,
      line1: line1.trim(),
      line2: undefined,
      unit: unit.trim() || undefined,
      buzzer: buzzer.trim() || undefined,
      city: city.trim(),
      province: province as Address['province'],
      postal_code: postalCode.trim().toUpperCase(),
      delivery_notes: notes.trim() || undefined,
      is_default: isDefault,
    };
    try {
      if (addressId) {
        await updateAddress(addressId, payload);
      } else {
        await createAddress(payload);
      }
      onSaved();
    } catch {
      setToast("Couldn't save this address — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset, gap: 14 }}>
      <Input label="Label" value={label} onChange={setLabel} placeholder="Home, Work…" />
      <Input label="Street address" value={line1} onChange={setLine1} required />
      <Input label="Unit / apt." value={unit} onChange={setUnit} />
      <Input label="Buzzer code" value={buzzer} onChange={setBuzzer} />
      <Input label="City" value={city} onChange={setCity} required />
      <Select label="Province" options={PROVINCES} value={province} onChange={setProvince} required />
      <Input
        label="Postal code"
        value={postalCode}
        onChange={setPostalCode}
        placeholder="M5H 2N2"
        required
      />
      <Input label="Delivery notes" value={notes} onChange={setNotes} placeholder="Leave at the door…" />
      <Switch checked={isDefault} onChange={setIsDefault} label="Set as default address" />
      {errorText ? <Text style={{ color: '#B42318' }}>{errorText}</Text> : null}
      <Button variant="primary" onPress={save} loading={saving} disabled={!valid} fullWidth>
        {addressId ? 'Save changes' : 'Add address'}
      </Button>
      {toast ? <Toast variant="danger" title={toast} onDismiss={() => setToast(null)} /> : null}
    </ScrollView>
  );
}
