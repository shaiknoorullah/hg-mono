/**
 * Create or edit a saved address (C-30). `addressId === null` is create; otherwise the screen
 * loads the address first so edit starts from real data.
 *
 * The customer types in the search box and picks a result (Mapbox, `api/geocode.ts`); the pick
 * fills street, city, province, postal code and the latitude/longitude the contract requires.
 * With no Mapbox token the form still works by hand, but the address is marked "location not
 * verified" and saved at a Toronto city-centre placeholder point.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppBar,
  Button,
  Checkbox,
  ErrorState,
  Input,
  Spinner,
  Toast,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { InlineAlert } from '../components/InlineAlert';

import {
  createAddress,
  getAddress,
  updateAddress,
  type Address,
} from '../api/addresses';
import { useAsync } from '../api/async';
import { searchAddresses, MAPBOX_TOKEN, type GeocodeResult } from '../api/geocode';
import { useNavigation } from '../navigation/stack';

function provinceName(code: string): string {
  return PROVINCES.find((p) => p.value === code)?.label ?? code;
}

/** Only used with no Mapbox token: the address is saved as "location not verified". */
const UNVERIFIED_POINT = { latitude: 43.6532, longitude: -79.3832 };

const PROVINCES: ReadonlyArray<{ value: string; label: string }> = [
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
  const theme = useTheme();
  const bodySm = useTypeStyle('body.sm');
  const [label, setLabel] = React.useState(existing?.label ?? '');
  const [line1, setLine1] = React.useState(existing?.line1 ?? '');
  const [unit, setUnit] = React.useState(existing?.unit ?? '');
  const [buzzer, setBuzzer] = React.useState(existing?.buzzer ?? '');
  const [city, setCity] = React.useState(existing?.city ?? 'Toronto');
  // Ontario only at launch (canvas: province fixed ON); an edit keeps what was saved.
  const [province, setProvince] = React.useState<string>(existing?.province ?? 'ON');
  const [postalCode, setPostalCode] = React.useState(existing?.postal_code ?? '');
  const [notes, setNotes] = React.useState(existing?.delivery_notes ?? '');
  const [isDefault, setIsDefault] = React.useState(existing?.is_default ?? false);
  const [point, setPoint] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [query, setQuery] = React.useState('');
  const [search, setSearch] = React.useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'results'; results: GeocodeResult[] }
    | { kind: 'network' }
  >({ kind: 'idle' });
  const [saving, setSaving] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const noToken = MAPBOX_TOKEN === '';
  // An edit keeps the stored point unless a new search result replaces it.
  const hasPoint = point !== null || (existing !== null && addressId !== null);

  // Debounced type-to-search; a newer keystroke aborts the older request.
  React.useEffect(() => {
    const q = query.trim();
    if (noToken || q.length < 3) {
      setSearch({ kind: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setSearch({ kind: 'loading' });
    const t = setTimeout(() => {
      void searchAddresses(q, ctl.signal).then((out) => {
        if (ctl.signal.aborted) return;
        setSearch(out.kind === 'ok' ? { kind: 'results', results: out.results } : { kind: 'network' });
      });
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, noToken]);

  function pick(r: GeocodeResult): void {
    setLine1(r.line1);
    if (r.city) setCity(r.city);
    if (r.province) setProvince(r.province);
    if (r.postalCode) setPostalCode(r.postalCode);
    setPoint({ latitude: r.latitude, longitude: r.longitude });
    setQuery('');
    setSearch({ kind: 'idle' });
  }

  const valid = (noToken || hasPoint) && line1.trim().length > 0 && city.trim().length > 0 && postalCode.trim().length > 0;

  async function save(): Promise<void> {
    if (!valid) {
      setErrorText(
        noToken || hasPoint
          ? 'Street address, city and postal code are required.'
          : 'Search for your address and pick it from the results.',
      );
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
        await updateAddress(addressId, point ? { ...payload, ...point } : payload);
      } else {
        await createAddress({ ...payload, ...(point ?? UNVERIFIED_POINT) });
      }
      onSaved();
    } catch {
      setToast("Couldn't save this address — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.surface.base }}
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {noToken ? (
        // Address search (#179) is not in the contract yet, so this is the canvas's manual
        // path ("Address — manual"). Said plainly, in a neutral notice: nothing is wrong.
        <InlineAlert
          role="status"
          icon="map"
          title="Type your address"
          body="Address search isn't available in this version, so we can't check the spot on a map yet. Riders use the street address and your notes."
          testID="AddressForm-manualNotice"
        />
      ) : (
        <View style={{ gap: 8 }}>
          <Input
            label="Search for your address"
            variant="search"
            value={query}
            onChange={setQuery}
            placeholder="Street and number, or a place"
            helperText={hasPoint ? 'Location confirmed. Search again to change it.' : undefined}
          />
          {search.kind === 'loading' ? <Spinner label="Searching" /> : null}
          {search.kind === 'network' ? (
            <Text style={[bodySm, { color: theme.color.text.secondary }]}>
              Couldn't reach address search. Check your connection and keep typing to retry.
            </Text>
          ) : null}
          {search.kind === 'results' && search.results.length === 0 ? (
            <Text style={[bodySm, { color: theme.color.text.secondary }]}>
              No matching addresses. Check the spelling or add the street number.
            </Text>
          ) : null}
          {search.kind === 'results'
            ? search.results.map((r) => (
                <Button key={r.id} variant="secondary" fullWidth onPress={() => pick(r)}>
                  {r.label}
                </Button>
              ))
            : null}
        </View>
      )}
      <Input label="Street address" value={line1} onChange={setLine1} required />
      <Input label="Unit (optional)" value={unit} onChange={setUnit} />
      <Input label="Buzzer (optional)" value={buzzer} onChange={setBuzzer} />
      <Input label="City" value={city} onChange={setCity} required />
      <Input
        label="Province"
        value={provinceName(province)}
        onChange={() => undefined}
        readOnly
        helperText="We deliver in Ontario only for now."
      />
      <Input
        label="Postal code"
        value={postalCode}
        onChange={setPostalCode}
        helperText="For example M1R 4E7."
        required
      />
      <Input
        label="Label (optional)"
        value={label}
        onChange={setLabel}
        helperText="For example Home or Work."
      />
      <Input
        label="Notes for the rider (optional)"
        value={notes}
        onChange={setNotes}
        helperText="For example the entrance or where to park."
        maxLength={200}
        characterCount
      />
      <Checkbox checked={isDefault} onChange={setIsDefault} label="Make this my default address" />
      {errorText ? (
        <Text accessibilityRole="alert" style={[bodySm, { color: theme.color.feedback.danger.text }]}>
          {errorText}
        </Text>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        onPress={save}
        loading={saving}
        disabled={!valid}
        fullWidth
        testID="AddressForm-save"
      >
        {addressId ? 'Save changes' : 'Save address'}
      </Button>
      {toast ? <Toast variant="danger" title={toast} onDismiss={() => setToast(null)} /> : null}
    </ScrollView>
  );
}
