/**
 * A5 Add or edit an address (boards `AC/AddressForm` and its 36 states: `-today`, `-first`,
 * `-kbd`, `-manualfocus`, `-filled`, `-validation`, `-invalidfocus`, `-geocoding`, `-geodown`,
 * `-mapfocus`, `-notserved`, `-saving`, `-saveerror`, `-server422`, `-conflict`, `-limit`, `-edit`,
 * `-editloading`, `-edit404`, `-editother`, `-settingdefault`, `-defaultdone`, `-defaultfail`,
 * `-deleteconfirm`, `-deleting`, `-deletefail`, `-inuse`, `-unsaved`, `-unconfirmed`, `-repin`,
 * `-offline`, `-editoffline`, and the `-dark`, `-360` and `-lt` renderings, which are this same
 * screen under the phone's theme, width and text size).
 *
 * One screen for both: `addressId` null opens a new address, otherwise `getAddress` loads it.
 *
 * - **New:** search (or the pin) first, then Address, Getting to your door, Address name, then
 *   "Check the pin" just above the sticky Save. Save is gated on that box. Latitude and longitude
 *   come from the pin, so an address can be added from anywhere.
 * - **Edit:** the stored pin; moving it asks for the box again. "Make this my default" applies at
 *   once and is not part of Save; Delete asks first and says when the address is the default.
 * - **Leaving with changes** asks "Discard your changes?" (the back button and Android's Back).
 * - **Failures:** the server's 422 marks the field it names; a 409 is the 20-address limit when the
 *   customer already has 20 and a plain conflict otherwise (the contract has no code for the limit);
 *   anything else says nothing was lost and offers to try again.
 *
 * The map itself is not here: see `PinStep`, which owns that boundary. Deleting leaves a toast for
 * Saved addresses (`addressNotice`), because this screen is closed by then.
 */
import * as React from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AppBar,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Textarea,
  Toast,
  space,
  useTheme,
  useTypeStyle,
} from '../../ds';
import { getPublicConfig, type PublicConfig } from '../../api/config';
import { useConnectivity } from '../../lib/connectivity';
import { useQuery } from '../../lib/query';
import { formatTime } from '../../lib/time';
import { useNav } from '../../navigation/context';
import { listOrdersPage } from '../../orders/ordersApi';
import { listAddresses } from '../accountApi';
import { ADDRESS_LIMIT } from '../rules';
import { createAddress, deleteAddress, getAddress, reverseGeocode, setDefaultAddress, updateAddress } from './addressApi';
import { showAddressNotice } from './addressNotice';
import {
  PROVINCE_NAMES,
  applyGeocoded,
  createInput,
  deleteDescription,
  deleteFailure,
  deletedToast,
  draftFromAddress,
  emptyDraft,
  firstError,
  geoFailure,
  isDirty,
  isNotServed,
  needsPinCheck,
  pinMoved,
  saveFailure,
  updateInput,
  validateDraft,
  FIELD_LIMITS,
  type Address,
  type AddressDraft,
  type FormErrors,
  type GeoFailure,
  type GeocodedAddress,
  type GeoPoint,
  type LabelKind,
  type Province,
} from './addressRules';
import { AddressSearch } from './AddressSearch';
import { PinStep, type PinStatus } from './PinStep';

export const FORM_COPY = {
  newTitle: 'New address',
  firstTitle: 'Your delivery address',
  editTitle: 'Edit address',
  doorTitle: 'Getting to your door',
  doorBody:
    'Riders offered your delivery see only your general area before they accept. The rider who accepts sees your full address, including unit, buzzer and notes. The restaurant sees it once it starts preparing your order; before that, only your area.',
  notesWhy: 'The restaurant and your rider see these. For example: side door, second buzzer from the top.',
  defaultWhy: "We'll use it first on Home and at checkout.",
  firstDefault: 'This will be your default address. We use it first on Home and at checkout.',
  isDefault:
    'This is your default address. We use it first on Home and at checkout. To change it, open another address and make that one the default.',
  defaultNow: "Changes right away. You don't need to press Save changes.",
  deleteWhy: 'Past orders keep the address they were delivered to.',
  labelHelpNew: 'Optional. Home and Work save those words as the name, Other lets you type your own, and No name shows the street instead.',
  labelHelpEdit: "You can rename this address, but not remove its name.",
  offlineNew: 'What you type stays here. Connect to Wi-Fi or mobile data to save this address.',
  saveWhyOffline: 'Connect to the internet to save.',
  saveErrorTitle: "We couldn't save this address",
  saveErrorBody: 'Everything you typed is still here, pin included. Check your connection and try again.',
  conflictBody: 'Your saved addresses changed while you were saving, maybe on another device. Everything you typed is still here. Try again.',
  limitTitle: 'You already have 20 saved addresses',
  limitBody: "That's the most you can keep. Delete one you no longer use, then save this one. What you typed is still here.",
  goneTitle: 'This address was deleted',
  goneBody: "It may have been deleted on another device. Your other saved addresses haven't changed.",
  loadErrorTitle: "We couldn't load this address",
  loadErrorBody: 'Check your connection and try again. Your saved addresses are safe.',
  inUseTitle: "You can't delete this address yet",
  inUseBody: "An order that isn't finished yet still uses this address. You can delete it once that order is finished.",
  unsavedTitle: 'Discard your changes?',
  unsavedBody: "You changed this address but haven't saved it. If you leave now, the changes are lost.",
} as const;

export interface AddressFormScreenProps {
  /** `null` opens a new address. */
  addressId: string | null;
  /** The first-address step opened this: the only address has to be the default. */
  first?: boolean;
}

type Banners =
  | { kind: 'validation'; title: string; body: string }
  | { kind: 'saveError' }
  | { kind: 'conflict' }
  | { kind: 'limit' }
  | null;

type Toasts =
  | { kind: 'defaultDone'; name: string }
  | { kind: 'defaultFail'; name: string; currentDefault: string | null }
  | { kind: 'deleteFail'; name: string }
  | null;

type Section = 'top' | 'address' | 'door' | 'label' | 'confirm';

const nameOf = (a: Pick<Address, 'label' | 'line1'>) => (a.label ?? '').trim() || a.line1;

export function AddressFormScreen({ addressId, first = false }: AddressFormScreenProps): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { online } = useConnectivity();
  const h2 = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const isEdit = addressId !== null;

  const { query, reload } = useQuery(() => getAddress(addressId as string), [addressId], { enabled: isEdit });
  const list = useQuery(listAddresses, []);
  const saved = list.query.kind === 'ready' ? list.query.data : null;
  const savedCount = saved?.length ?? 0;
  const isFirstAddress = !isEdit && (first || (saved !== null && saved.length === 0));

  const [config, setConfig] = React.useState<PublicConfig | null>(null);
  React.useEffect(() => {
    let live = true;
    getPublicConfig()
      .then((c) => live && setConfig(c))
      .catch(() => {
        /* The form never depends on the config: no served list means nothing is blocked. */
      });
    return () => {
      live = false;
    };
  }, []);
  const served = config?.served_provinces ?? null;
  const centre: GeoPoint | null = config?.default_map_center ?? null;

  const [draft, setDraft] = React.useState<AddressDraft>(() => emptyDraft());
  const [baseline, setBaseline] = React.useState<AddressDraft | null>(null);
  const [isDefault, setIsDefault] = React.useState(false);
  const [asOf, setAsOf] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (isEdit && query.kind === 'ready' && baseline === null) {
      const d = draftFromAddress(query.data);
      setDraft(d);
      setBaseline(d);
      setIsDefault(query.data.is_default);
      setAsOf(query.asOf);
    }
  }, [isEdit, query, baseline]);

  const [errors, setErrors] = React.useState<FormErrors>({});
  const [banner, setBanner] = React.useState<Banners>(null);
  const [toast, setToast] = React.useState<Toasts>(null);
  const [saving, setSaving] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [geoNote, setGeoNote] = React.useState<GeoFailure | null>(null);
  const [settingDefault, setSettingDefault] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const [dialog, setDialog] = React.useState<'delete' | 'inUse' | 'unsaved' | null>(null);
  const [searchKey, setSearchKey] = React.useState(0);
  const [notServedByServer, setNotServedByServer] = React.useState(false);

  const mounted = React.useRef(true);
  const leaving = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stored: Address | null = query.kind === 'ready' ? query.data : null;
  const base = isEdit ? baseline : emptyDraft();
  const dirty = base !== null && isDirty(draft, base);
  const notServed = isNotServed(draft.province, served);
  const blockedByProvince = notServed || notServedByServer;
  const showPinCheck = needsPinCheck(draft, isEdit ? baseline : null);

  /* ---- leaving ---------------------------------------------------------------------------- */

  const leave = React.useCallback(() => {
    leaving.current = true;
    nav.back();
  }, [nav]);

  const requestBack = React.useCallback(() => {
    if (dirty && !leaving.current && !saving) setDialog('unsaved');
    else leave();
  }, [dirty, saving, leave]);

  // Android's Back. The shell registers its own handler in an effect that runs after this
  // screen's, and the newest handler runs first, so this one registers a tick later to be asked first.
  const requestBackRef = React.useRef(requestBack);
  requestBackRef.current = requestBack;
  React.useEffect(() => {
    let sub: { remove: () => void } | null = null;
    const timer = setTimeout(() => {
      sub = BackHandler.addEventListener('hardwareBackPress', () => {
        requestBackRef.current();
        return true;
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      sub?.remove();
    };
  }, []);

  /* ---- scrolling to what needs attention -------------------------------------------------- */

  const scroll = React.useRef<ScrollView>(null);
  const sectionY = React.useRef<Partial<Record<Section, number>>>({});
  const mark = (s: Section) => (e: { nativeEvent: { layout: { y: number } } }) => {
    sectionY.current[s] = e.nativeEvent.layout.y;
  };
  const scrollTo = (s: Section) => scroll.current?.scrollTo?.({ y: Math.max((sectionY.current[s] ?? 0) - space['4'], 0), animated: true });
  const scrollToError = (key: keyof FormErrors) => {
    scrollTo(key === 'pin' ? 'top' : key === 'confirm' ? 'confirm' : key === 'unit' || key === 'buzzer' || key === 'notes' ? 'door' : key === 'label' ? 'label' : 'address');
  };

  /* ---- editing ---------------------------------------------------------------------------- */

  const setField = <K extends keyof AddressDraft>(key: K, value: AddressDraft[K], clears?: keyof FormErrors) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (clears) setErrors((e) => ({ ...e, [clears]: undefined }));
    if (banner?.kind === 'validation') setBanner(null);
  };

  const setPin = (pin: GeoPoint) => {
    setDraft((d) => ({ ...d, pin, confirmed: false }));
    setErrors((e) => ({ ...e, pin: undefined, confirm: undefined }));
    setGeoNote(null);
  };

  const onPick = (g: GeocodedAddress) => {
    setDraft((d) => applyGeocoded(d, g, { movePin: true }));
    setErrors((e) => ({ ...e, line1: undefined, city: undefined, postal: undefined, pin: undefined, confirm: undefined }));
    setGeoNote(null);
    setBanner(null);
    setNotServedByServer(false);
  };

  const useSpot = async () => {
    if (!draft.pin || finding) return;
    setFinding(true);
    setGeoNote(null);
    try {
      const g = await reverseGeocode(draft.pin);
      if (!mounted.current) return;
      setDraft((d) => ({ ...applyGeocoded(d, g, { movePin: false }), confirmed: false }));
      setErrors((e) => ({ ...e, line1: undefined, city: undefined, postal: undefined, confirm: undefined }));
    } catch (e) {
      if (mounted.current) setGeoNote(geoFailure(e));
    } finally {
      if (mounted.current) setFinding(false);
    }
  };

  const searchAnother = () => {
    setDraft((d) => ({ ...d, line1: '', city: '', postal: '', province: served?.[0] ?? d.province, pin: null, confirmed: false }));
    setSearchKey((k) => k + 1);
    scrollTo('top');
  };

  /* ---- save ------------------------------------------------------------------------------- */

  const save = async () => {
    if (saving || !online || blockedByProvince) return;
    const found = validateDraft(draft, isEdit ? baseline : null);
    setErrors(found);
    setBanner(null);
    const bad = firstError(found);
    if (bad) {
      scrollToError(bad);
      return;
    }
    if (isEdit && baseline && !dirty) {
      leave();
      return;
    }
    setSaving(true);
    try {
      if (addressId !== null && baseline) await updateAddress(addressId, updateInput(draft, baseline));
      else await createAddress(createInput(draft, isFirstAddress || draft.makeDefault));
      leaving.current = true;
      if (mounted.current) nav.back();
    } catch (e) {
      if (!mounted.current) return;
      setSaving(false);
      const f = saveFailure(e, { isEdit, savedCount });
      if (f.kind === 'validation') {
        setErrors(f.errors);
        setBanner({ kind: 'validation', title: f.banner.title, body: f.banner.body });
        const key = firstError(f.errors);
        if (key) scrollToError(key);
        else scrollTo('top');
      } else if (f.kind === 'notServed') {
        setErrors({});
        setBanner(null);
        setNotServedByServer(true);
      } else if (f.kind === 'limit') setBanner({ kind: 'limit' });
      else if (f.kind === 'conflict') setBanner({ kind: 'conflict' });
      else if (f.kind === 'gone') setGone(true);
      else setBanner({ kind: 'saveError' });
      if (f.kind !== 'validation') scrollTo('top');
    }
  };

  /* ---- default and delete ----------------------------------------------------------------- */

  const makeDefault = async () => {
    if (addressId === null || settingDefault || !online) return;
    const name = nameOf(stored ?? { label: null, line1: draft.line1 });
    setSettingDefault(true);
    setToast(null);
    try {
      await setDefaultAddress(addressId);
      if (!mounted.current) return;
      setIsDefault(true);
      setToast({ kind: 'defaultDone', name });
    } catch {
      if (!mounted.current) return;
      const current = saved?.find((a) => a.is_default && a.id !== addressId);
      setToast({ kind: 'defaultFail', name, currentDefault: current ? nameOf(current) : null });
    } finally {
      if (mounted.current) setSettingDefault(false);
    }
  };

  const findActiveOrder = async () => {
    setDialog(null);
    try {
      const page = await listOrdersPage('ACTIVE');
      const order = page.orders[0];
      if (order && mounted.current) nav.push({ name: 'tracking', orderId: order.id });
    } catch {
      /* The dialog already told the customer why; the Orders tab is the way to the order. */
    }
  };

  const confirmDelete = async () => {
    if (addressId === null || deleting) return;
    setDeleting(true);
    const wasDefault = isDefault;
    const storedName = nameOf(stored ?? { label: null, line1: baseline?.line1 ?? draft.line1 });
    try {
      await deleteAddress(addressId);
      let remaining: Address[] | null = null;
      try {
        remaining = await listAddresses();
      } catch {
        remaining = null;
      }
      showAddressNotice({
        title: 'Address deleted',
        description: remaining ? deletedToast(remaining, wasDefault) : `${storedName} was removed from your saved addresses.`,
      });
      leaving.current = true;
      if (mounted.current) nav.back();
    } catch (e) {
      if (!mounted.current) return;
      setDeleting(false);
      setDialog(null);
      const f = deleteFailure(e);
      if (f === 'in_use') setDialog('inUse');
      else if (f === 'gone') setGone(true);
      else setToast({ kind: 'deleteFail', name: storedName });
    }
  };

  /* ---- states that replace the form ------------------------------------------------------- */

  const title = isEdit ? FORM_COPY.editTitle : first ? FORM_COPY.firstTitle : FORM_COPY.newTitle;
  const bar = (loading: boolean) => (
    <AppBar
      title={title}
      tone="cream"
      loading={loading}
      back={first ? { onPress: requestBack } : { onPress: requestBack, previousTitle: 'Addresses' }}
      testID="AddressForm-bar"
    />
  );

  if (isEdit && gone) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressFormScreen">
        {bar(false)}
        <EmptyState
          variant="page"
          autoFocus
          illustration={<Icon name="map" size={48} color={theme.color.text.secondary} />}
          title={FORM_COPY.goneTitle}
          description={FORM_COPY.goneBody}
          primaryAction={{ label: 'Back to Addresses', onPress: leave }}
          testID="AddressForm-gone"
        />
      </View>
    );
  }

  if (isEdit && query.kind === 'error' && baseline === null) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressFormScreen">
        {bar(false)}
        {query.status === 404 ? (
          <EmptyState
            variant="page"
            autoFocus
            illustration={<Icon name="map" size={48} color={theme.color.text.secondary} />}
            title={FORM_COPY.goneTitle}
            description={FORM_COPY.goneBody}
            primaryAction={{ label: 'Back to Addresses', onPress: leave }}
            testID="AddressForm-gone"
          />
        ) : (
          <ErrorState
            variant="page"
            errorCode={query.code}
            offline={!online}
            title={FORM_COPY.loadErrorTitle}
            description={FORM_COPY.loadErrorBody}
            onRetry={reload}
            testID="AddressForm-error"
          />
        )}
      </View>
    );
  }

  if (isEdit && baseline === null) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressFormScreen">
        {bar(true)}
        <View accessibilityRole="progressbar" accessibilityLabel="Loading address" aria-busy style={styles.loading} testID="AddressForm-loading">
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.stack}>
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="rect" height={52} />
            <Skeleton variant="rect" height={52} />
            <Skeleton variant="rect" height={52} width="60%" />
            <Skeleton variant="rect" height={200} />
          </View>
        </View>
      </View>
    );
  }

  /* ---- the form --------------------------------------------------------------------------- */

  const pinStatus: PinStatus = finding
    ? 'finding'
    : !draft.pin
      ? 'unplaced'
      : isEdit
        ? pinMoved(draft.pin, baseline?.pin ?? null)
          ? 'moved'
          : 'stored'
        : 'placed';

  const servedNames = (served ?? []).map((p) => PROVINCE_NAMES[p]);
  const servedPhrase = servedNames.length > 0 ? servedNames.join(' and ') : 'Ontario';
  const provinceHelp = blockedByProvince ? undefined : `We deliver in ${servedPhrase} only for now.`;
  const labelOptions: LabelKind[] = isEdit ? ['HOME', 'WORK', 'OTHER'] : ['NONE', 'HOME', 'WORK', 'OTHER'];
  const labelText: Record<LabelKind, string> = { NONE: 'No name', HOME: 'Home', WORK: 'Work', OTHER: 'Other' };
  const showDefaultBox = !isEdit && !isFirstAddress;
  const saveBlockedWhy = !online ? 'save-why' : blockedByProvince ? 'notserved-why' : null;
  const gutter = theme.density.gutter;
  const heading = (text: string) => (
    <Text accessibilityRole="header" style={[h2, { color: theme.color.text.primary }]}>
      {text}
    </Text>
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressFormScreen">
      {bar(false)}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
          testID="AddressForm-scroll"
        >
          {!online ? (
            <Banner
              variant="info"
              title="You're offline"
              description={
                isEdit
                  ? `Showing this address as of ${asOf ? formatTime(asOf) : 'when it loaded'}. What you change stays here; connect to save it.`
                  : FORM_COPY.offlineNew
              }
              testID="AddressForm-offline"
            />
          ) : null}

          {banner?.kind === 'validation' ? (
            <Banner variant="warning" title={banner.title} description={banner.body} testID="AddressForm-server422" />
          ) : null}
          {banner?.kind === 'conflict' ? (
            <Banner variant="warning" title={FORM_COPY.saveErrorTitle} description={FORM_COPY.conflictBody} testID="AddressForm-conflict" />
          ) : null}
          {banner?.kind === 'saveError' ? (
            <Banner variant="warning" title={FORM_COPY.saveErrorTitle} description={FORM_COPY.saveErrorBody} testID="AddressForm-saveError" />
          ) : null}
          {banner?.kind === 'limit' ? (
            <Banner
              variant="warning"
              title={FORM_COPY.limitTitle}
              description={FORM_COPY.limitBody}
              action={{ label: 'Go to Addresses', onPress: leave }}
              testID="AddressForm-limit"
            />
          ) : null}
          {blockedByProvince ? (
            <Banner
              variant="warning"
              title={`We deliver in ${servedPhrase} only for now`}
              description={`The address you found is in ${PROVINCE_NAMES[draft.province]}, so we can't deliver there yet. Search for ${servedNames[0] ? `a${/^[AEIOU]/.test(servedNames[0]) ? 'n' : ''} ${servedNames[0]}` : 'another'} address instead.`}
              action={{
                label: 'Search for another address',
                onPress: () => {
                  setNotServedByServer(false);
                  searchAnother();
                },
              }}
              testID="AddressForm-notServed"
            />
          ) : null}
          {blockedByProvince ? (
            <Text nativeID="notserved-why" style={[small, { color: theme.color.text.secondary }]}>
              Save address is off until the address is in a province we deliver to.
            </Text>
          ) : null}

          <View onLayout={mark('top')}>
            <PinStep
              isEdit={isEdit}
              pin={draft.pin}
              centre={centre}
              status={pinStatus}
              line1={draft.line1}
              error={errors.pin}
              disabled={saving}
              lookupDisabled={!online}
              onPinChange={setPin}
              onUseSpot={useSpot}
              search={
                isEdit ? undefined : (
                  <AddressSearch
                    key={searchKey}
                    near={draft.pin}
                    disabled={saving}
                    onPick={onPick}
                    onEnterManually={() => scrollTo('address')}
                  />
                )
              }
              note={geoNote ? <GeoNote failure={geoNote} /> : undefined}
            />
          </View>

          <View style={styles.stack} onLayout={mark('address')}>
            {heading('Address')}
            {finding ? (
              <Text accessibilityRole="alert" style={[small, { color: theme.color.text.secondary }]} testID="AddressForm-finding">
                Filling in the address from your pin.
              </Text>
            ) : null}
            <Input
              label="Street address"
              required
              autoComplete="address-line1"
              maxLength={FIELD_LIMITS.line1}
              value={draft.line1}
              onChange={(v) => setField('line1', v, 'line1')}
              readOnly={saving}
              loading={finding}
              errorText={errors.line1}
              testID="AddressForm-line1"
            />
            <Input
              label="Building or complex name (optional)"
              autoComplete="address-line2"
              maxLength={FIELD_LIMITS.line2}
              value={draft.line2}
              onChange={(v) => setField('line2', v, 'line2')}
              readOnly={saving}
              errorText={errors.line2}
              testID="AddressForm-line2"
            />
            <Input
              label="City"
              required
              autoComplete="address-level2"
              maxLength={FIELD_LIMITS.city}
              value={draft.city}
              onChange={(v) => setField('city', v, 'city')}
              readOnly={saving}
              loading={finding}
              errorText={errors.city}
              testID="AddressForm-city"
            />
            {served !== null && served.length > 1 ? (
              <Select
                label="Province"
                value={draft.province}
                options={served.map((p) => ({ value: p, label: PROVINCE_NAMES[p] }))}
                onChange={(v) => {
                  setField('province', v as Province);
                  setNotServedByServer(false);
                }}
                disabled={saving}
                testID="AddressForm-province"
              />
            ) : (
              <Input
                label="Province"
                readOnly
                value={PROVINCE_NAMES[draft.province]}
                onChange={() => undefined}
                helperText={provinceHelp}
                testID="AddressForm-province"
              />
            )}
            <Input
              label="Postal code"
              required
              autoComplete="postal-code"
              maxLength={FIELD_LIMITS.postal}
              value={draft.postal}
              onChange={(v) => setField('postal', v, 'postal')}
              readOnly={saving}
              loading={finding}
              helperText={errors.postal ? undefined : 'Like M1R 4E7'}
              errorText={errors.postal}
              testID="AddressForm-postal"
            />
          </View>

          <View style={styles.stack} onLayout={mark('door')}>
            {heading(FORM_COPY.doorTitle)}
            <Text style={[small, { color: theme.color.text.secondary }]}>{FORM_COPY.doorBody}</Text>
            <View style={styles.pair}>
              <View style={styles.pairCell}>
                <Input
                  label="Unit (optional)"
                  maxLength={FIELD_LIMITS.unit}
                  value={draft.unit}
                  onChange={(v) => setField('unit', v, 'unit')}
                  readOnly={saving}
                  errorText={errors.unit}
                  testID="AddressForm-unit"
                />
              </View>
              <View style={styles.pairCell}>
                <Input
                  label="Buzzer (optional)"
                  maxLength={FIELD_LIMITS.buzzer}
                  value={draft.buzzer}
                  onChange={(v) => setField('buzzer', v, 'buzzer')}
                  readOnly={saving}
                  errorText={errors.buzzer}
                  testID="AddressForm-buzzer"
                />
              </View>
            </View>
            <Textarea
              label="Delivery notes (optional)"
              value={draft.notes}
              maxLength={FIELD_LIMITS.notes}
              onChange={(v) => setField('notes', v, 'notes')}
              readOnly={saving}
              errorText={errors.notes}
              testID="AddressForm-notes"
            />
            <Text style={[small, { color: theme.color.text.secondary }]}>{FORM_COPY.notesWhy}</Text>
          </View>

          <View style={styles.stack} onLayout={mark('label')}>
            {heading('Address name')}
            <RadioGroup
              name="address-label"
              label="Save this address as"
              orientation="horizontal"
              value={draft.labelKind}
              onChange={(v) => setField('labelKind', v as LabelKind, 'label')}
              disabled={saving}
              testID="AddressForm-labelKind"
            >
              {labelOptions.map((k) => (
                <Radio key={k} value={k} label={labelText[k]} testID={`AddressForm-label-${k}`} />
              ))}
            </RadioGroup>
            {draft.labelKind === 'OTHER' ? (
              <Input
                label="Name for this address"
                maxLength={FIELD_LIMITS.label}
                characterCount
                value={draft.label}
                onChange={(v) => setField('label', v, 'label')}
                readOnly={saving}
                errorText={errors.label}
                testID="AddressForm-label"
              />
            ) : null}
            <Text style={[small, { color: theme.color.text.secondary }]}>{isEdit ? FORM_COPY.labelHelpEdit : FORM_COPY.labelHelpNew}</Text>
            {showDefaultBox ? (
              <View style={styles.tight}>
                <Checkbox
                  label="Make this my default address"
                  checked={draft.makeDefault}
                  onChange={(v) => setField('makeDefault', v)}
                  testID="AddressForm-makeDefault"
                />
                <Text style={[small, { color: theme.color.text.secondary, paddingLeft: 32 }]}>{FORM_COPY.defaultWhy}</Text>
              </View>
            ) : null}
            {isFirstAddress ? (
              <Text style={[small, { color: theme.color.text.primary }]} testID="AddressForm-firstDefault">
                {FORM_COPY.firstDefault}
              </Text>
            ) : null}
          </View>

          {showPinCheck ? (
            <View style={[styles.stack, styles.divided, { borderTopColor: theme.color.border.decorative }]} onLayout={mark('confirm')}>
              {heading('Check the pin')}
              <Text style={[small, { color: theme.color.text.primary }]}>
                {`Is the pin on the entrance of ${draft.line1.trim()}? Look at the map above before you save.`}
              </Text>
              <Checkbox
                label={`The pin is on the entrance of ${draft.line1.trim()}`}
                checked={draft.confirmed}
                error={Boolean(errors.confirm)}
                onChange={(v) => setField('confirmed', v, 'confirm')}
                testID="AddressForm-confirm"
              />
              {errors.confirm ? (
                <Text accessibilityRole="alert" style={[small, { color: theme.color.feedback.danger.text }]} testID="AddressForm-confirmError">
                  {errors.confirm}
                </Text>
              ) : null}
            </View>
          ) : null}

          {isEdit ? (
            <>
              <View style={[styles.stack, styles.divided, { borderTopColor: theme.color.border.decorative }]}>
                {heading('Default address')}
                {isDefault ? <Text style={[small, { color: theme.color.text.secondary }]}>{FORM_COPY.isDefault}</Text> : null}
                {!isDefault ? (
                  <>
                    <Text style={[small, { color: theme.color.text.secondary }]}>{FORM_COPY.defaultNow}</Text>
                    <Button
                      variant="tertiary"
                      fullWidth
                      loading={settingDefault}
                      disabled={!online}
                      onPress={makeDefault}
                      testID="AddressForm-setDefault"
                    >
                      {settingDefault ? 'Making it your default' : 'Make this my default address'}
                    </Button>
                  </>
                ) : null}
              </View>
              <View style={[styles.stack, styles.divided, { borderTopColor: theme.color.border.decorative }]}>
                {heading('Delete')}
                <Text style={[small, { color: theme.color.text.secondary }]}>{FORM_COPY.deleteWhy}</Text>
                <Button
                  variant="tertiary"
                  destructive
                  fullWidth
                  disabled={!online}
                  onPress={() => setDialog('delete')}
                  testID="AddressForm-delete"
                >
                  Delete this address
                </Button>
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingHorizontal: gutter, backgroundColor: theme.color.surface.base, borderTopColor: theme.color.border.decorative }]}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!online || blockedByProvince}
            accessibilityHint={saveBlockedWhy ? (blockedByProvince ? 'Save is off until the address is in a province we deliver to' : FORM_COPY.saveWhyOffline) : undefined}
            onPress={save}
            testID="AddressForm-save"
          >
            {saving ? 'Saving address' : isEdit ? 'Save changes' : 'Save address'}
          </Button>
          {!online ? (
            <Text nativeID="save-why" style={[small, styles.centred, { color: theme.color.text.secondary }]} testID="AddressForm-saveWhy">
              {FORM_COPY.saveWhyOffline}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {toast ? (
        <View pointerEvents="box-none" style={[styles.toastDock, { paddingHorizontal: gutter }]}>
          {toast.kind === 'defaultDone' ? (
            <Toast
              variant="success"
              title={`${toast.name} is now your default`}
              description={FORM_COPY.defaultWhy}
              onDismiss={() => setToast(null)}
              testID="AddressForm-defaultDone"
            />
          ) : null}
          {toast.kind === 'defaultFail' ? (
            <Toast
              variant="warning"
              title={`We couldn't make ${toast.name} your default`}
              description={`${toast.currentDefault ? `${toast.currentDefault} is still your default.` : "Your default hasn't changed."} Check your connection and try again.`}
              action={{ label: 'Try again', onPress: () => void makeDefault() }}
              onDismiss={() => setToast(null)}
              testID="AddressForm-defaultFail"
            />
          ) : null}
          {toast.kind === 'deleteFail' ? (
            <Toast
              variant="warning"
              title="We couldn't delete this address"
              description={`${toast.name} is still saved. Check your connection and try again.`}
              action={{ label: 'Try again', onPress: () => setDialog('delete') }}
              onDismiss={() => setToast(null)}
              testID="AddressForm-deleteFail"
            />
          ) : null}
        </View>
      ) : null}

      <Modal
        open={dialog === 'delete'}
        onClose={() => (deleting ? undefined : setDialog(null))}
        variant="confirm"
        destructive
        size="sm"
        title="Delete this address?"
        description={deleteDescription({ label: stored?.label ?? null, line1: baseline?.line1 ?? draft.line1, is_default: isDefault })}
        actions={[
          { label: 'Keep address', onPress: () => setDialog(null), disabled: deleting },
          { label: 'Delete address', destructive: true, loading: deleting, onPress: () => void confirmDelete() },
        ]}
        testID="AddressForm-deleteDialog"
      />
      <Modal
        open={dialog === 'inUse'}
        onClose={() => setDialog(null)}
        variant="confirm"
        size="sm"
        title={FORM_COPY.inUseTitle}
        description={FORM_COPY.inUseBody}
        actions={[
          { label: 'OK', onPress: () => setDialog(null) },
          { label: 'View order', onPress: () => void findActiveOrder() },
        ]}
        testID="AddressForm-inUseDialog"
      />
      <Modal
        open={dialog === 'unsaved'}
        onClose={() => setDialog(null)}
        variant="confirm"
        destructive
        size="sm"
        title={FORM_COPY.unsavedTitle}
        description={FORM_COPY.unsavedBody}
        actions={[
          { label: 'Keep editing', onPress: () => setDialog(null) },
          {
            label: 'Discard changes',
            destructive: true,
            onPress: () => {
              setDialog(null);
              leave();
            },
          },
        ]}
        testID="AddressForm-unsavedDialog"
      />
    </View>
  );
}

/** What the pin lookup failing looks like: the pin stays, and the customer types the address. */
function GeoNote({ failure }: { failure: GeoFailure }): React.ReactElement {
  switch (failure.kind) {
    case 'no_match':
      return (
        <Banner
          variant="info"
          title="We couldn't find an address near the pin"
          description="Type the address in the fields below. The pin stays where it is."
          testID="AddressForm-geoNote"
        />
      );
    case 'unavailable':
      return (
        <Banner
          variant="info"
          title="Address lookup isn't working right now"
          description="Type the address in the fields below. The pin stays where it is."
          testID="AddressForm-geoNote"
        />
      );
    case 'rate_limited':
      return (
        <Banner
          variant="warning"
          title="Too many lookups"
          description="Wait a moment and try again, or type the address in the fields below."
          testID="AddressForm-geoNote"
        />
      );
    default:
      return (
        <Banner
          variant="warning"
          title="We couldn't look up this spot"
          description="Check your connection and try again, or type the address in the fields below."
          testID="AddressForm-geoNote"
        />
      );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: space['2'], paddingBottom: space['6'], gap: space['6'], flexGrow: 1 },
  loading: { paddingHorizontal: space['4'], paddingTop: space['2'] },
  stack: { gap: space['4'] },
  tight: { gap: space['1'] },
  divided: { paddingTop: space['6'], borderTopWidth: 1 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space['3'] },
  pairCell: { flexGrow: 1, flexBasis: 150, minWidth: 0 },
  footer: { paddingTop: space['3'], paddingBottom: space['4'], gap: space['2'], borderTopWidth: 1 },
  centred: { textAlign: 'center' },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 112 },
});
