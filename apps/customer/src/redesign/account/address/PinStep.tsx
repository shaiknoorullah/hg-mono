/**
 * The address form's pin step: "Find your door on the map" / "Pin on your entrance" (boards
 * `AC/AddressForm`, `-first`, `-mapfocus`, `-repin`, `-locdenied`, `-geocoding`).
 *
 * The map is the design system's `MapPinPicker` (draggable pin on the Mapbox map the apps already
 * ship, reporting the pin's final coordinate on each drag end or tap). Without a map in the build,
 * without a public token or when tiles fail, `MapPinPicker` draws its own text panel and says so,
 * and everything below still works:
 *
 * - the pin is placed by a search result (the form passes it in), by dragging or tapping the map,
 *   or by **Move pin**: the board's four north / south / east / west buttons with a 1 m or 10 m
 *   step, which exist for keyboard, switch and screen-reader users (a map is never a focus stop);
 * - **Use this spot for the address** calls `reverseGeocode` for the pin and hands the address up
 *   (`onUseSpot`).
 *
 * **Use my current location** is a button here and a flow in the form (`useCurrentLocation`): the
 * form checks the phone's location permission, reads where it is, looks the address up and fills the
 * fields. When the permission is off the button is disabled and `locationNote` says why, with a way
 * to the phone's settings (board `AddressForm-locdenied`).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Icon, MapPinPicker, Radio, RadioGroup, radius, space, useTheme, useTypeStyle } from '../../ds';
import { nudge, STEP_METRES, type Compass, type GeoPoint, type StepMetres } from './addressRules';

/** Central Toronto: where Move pin starts when nothing is placed and the config has no centre. */
export const FALLBACK_CENTRE: GeoPoint = { latitude: 43.6532, longitude: -79.3832 };

export type PinStatus = 'unplaced' | 'placed' | 'moved' | 'stored' | 'finding';

export const PIN_COPY = {
  newTitle: 'Find your door on the map',
  editTitle: 'Pin on your entrance',
  newHelp:
    "Search for the address, then place the pin on the door your rider should use. You don't need to be there. We save the pin's position, even if it differs from the typed address.",
  editHelp: 'Your rider goes to this pin. To move it, drag the map until the pin sits on the right door.',
  moveHelp: 'Each press moves the pin by the step size you choose.',
} as const;

/**
 * The words for what the pin is doing: the map's accessible content and its fallback text. With
 * location off and no pin, the board names the central-Toronto start (`AddressForm-locdenied`).
 */
export function pinSummary(status: PinStatus, line1: string, locationOff = false): string {
  switch (status) {
    case 'finding':
      return 'Pin dropped. Finding the address';
    case 'unplaced':
      return locationOff ? 'Map at central Toronto. Drag it to your door' : 'Drag the map to your door';
    case 'moved':
      return 'Pin moved. Check it before you save';
    case 'stored':
      return 'Pin saved for this address';
    case 'placed':
      return `Pin on ${line1.trim() || 'your door'}`;
  }
}

export interface PinStepProps {
  isEdit: boolean;
  pin: GeoPoint | null;
  /** Where Move pin starts with no pin: `PublicConfig.default_map_center`. */
  centre: GeoPoint | null;
  status: PinStatus;
  line1: string;
  /** The search field (a new address only), drawn between the help text and the map. */
  search?: React.ReactNode;
  /** The pin error under the map, in the danger text role. */
  error?: string;
  /** Anything that follows the map: the reverse-lookup failure note. */
  note?: React.ReactNode;
  /** The form is saving: nothing moves. */
  disabled?: boolean;
  /** "Use this spot" cannot run (offline). */
  lookupDisabled?: boolean;
  /** "Use my current location" is running (permission, position or lookup). */
  locating?: boolean;
  /** Location is off for the app: the button is disabled and `locationNote` says why. */
  locationDisabled?: boolean;
  /** The note about location: off, or the phone could not say where it is. */
  locationNote?: React.ReactNode;
  onUseLocation: () => void;
  onPinChange: (pin: GeoPoint) => void;
  /** Reverse-geocode the pin (`reverseGeocode`) and fill the address fields from it. */
  onUseSpot: () => void;
  testID?: string;
}

export function PinStep(props: PinStepProps): React.ReactElement {
  const { isEdit, pin, centre, status, line1, search, error, note, locating = false, locationDisabled = false, locationNote, onUseLocation, disabled = false, lookupDisabled = false, onPinChange, onUseSpot, testID = 'PinStep' } = props;
  const theme = useTheme();
  const h2 = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [step, setStep] = React.useState<StepMetres>('10');

  const move = (direction: Compass) => onPinChange(nudge(pin ?? centre ?? FALLBACK_CENTRE, direction, Number(step)));
  const summary = pinSummary(status, line1, locationDisabled);

  return (
    <View style={styles.stack} testID={testID}>
      <Text accessibilityRole="header" style={[h2, { color: theme.color.text.primary }]}>
        {isEdit ? PIN_COPY.editTitle : PIN_COPY.newTitle}
      </Text>
      <Text style={[small, { color: theme.color.text.secondary }]}>{isEdit ? PIN_COPY.editHelp : PIN_COPY.newHelp}</Text>
      {search}
      <MapPinPicker
        value={pin}
        center={centre ?? FALLBACK_CENTRE}
        summary={summary}
        hasError={Boolean(error)}
        disabled={disabled}
        onChange={onPinChange}
        testID="PinStep-map"
      />
      {error ? (
        <View accessibilityRole="alert" style={styles.errorRow} testID={`${testID}-error`}>
          <Icon name="error" size={16} color={theme.color.feedback.danger.text} />
          <Text style={[small, { color: theme.color.feedback.danger.text, flex: 1 }]}>{error}</Text>
        </View>
      ) : null}
      {locationNote}
      {note}
      <View style={styles.buttons}>
        <Button
          variant="tertiary"
          iconStart="map"
          disabled={disabled || lookupDisabled || locationDisabled || status === 'finding'}
          loading={locating}
          onPress={onUseLocation}
          testID={`${testID}-useLocation`}
        >
          Use my current location
        </Button>
        <Button
          variant="tertiary"
          iconStart="map"
          disabled={disabled || lookupDisabled || pin === null || status === 'finding'}
          loading={status === 'finding'}
          onPress={onUseSpot}
          testID={`${testID}-useSpot`}
        >
          Use this spot for the address
        </Button>
        <Button
          variant="tertiary"
          disabled={disabled}
          accessibilityHint={moveOpen ? 'Hides the move buttons' : 'Shows buttons that move the pin north, south, east or west'}
          onPress={() => setMoveOpen((o) => !o)}
          testID={`${testID}-move`}
        >
          Move pin
        </Button>
      </View>
      {moveOpen ? (
        <View
          accessibilityRole="none"
          style={[styles.nudge, { borderColor: theme.color.border.decorative }]}
          testID={`${testID}-nudge`}
        >
          <RadioGroup
            name="pin-step"
            label="Step size"
            orientation="horizontal"
            value={step}
            onChange={(v) => setStep(v as StepMetres)}
            testID={`${testID}-step`}
          >
            {STEP_METRES.map((m) => (
              <Radio key={m} value={m} label={`${m} m`} testID={`${testID}-step-${m}`} />
            ))}
          </RadioGroup>
          <View style={styles.grid}>
            {(['north', 'south', 'west', 'east'] as const).map((d) => (
              <View key={d} style={styles.cell}>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={disabled}
                  accessibilityLabel={`Move ${d} ${step} m`}
                  onPress={() => move(d)}
                  testID={`${testID}-move-${d}`}
                >
                  {`Move ${d}`}
                </Button>
              </View>
            ))}
          </View>
          <Text style={[small, { color: theme.color.text.secondary }]}>{PIN_COPY.moveHelp}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space['3'] },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  nudge: { gap: space['2'], padding: space['3'], borderWidth: 1, borderRadius: radius.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  cell: { flexGrow: 1, flexBasis: '45%' },
});
