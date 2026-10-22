/**
 * The address form's pin step: "Find your door on the map" / "Pin on your entrance" (boards
 * `AC/AddressForm`, `-first`, `-mapfocus`, `-repin`, `-locdenied`, `-geocoding`).
 *
 * THIS IS THE MAP BOUNDARY. `@hg/ui-native` has no draggable-pin map (issue #1023: the `MapView`
 * it has draws a restaurant, customer and rider and cannot be dragged or report where the pin
 * ends up), and adding a native map module changes the build. So the map region below is a
 * placeholder drawn from the board's own placeholder treatment (a sunken region with the customer
 * pin), and everything that does not need a map works for real:
 *
 * - the pin is placed by a search result (the form passes it in), or by **Move pin**: the
 *   board's four north / south / east / west buttons with a 1 m or 10 m step, which exist for
 *   keyboard, switch and screen-reader users and so need no map to be correct;
 * - **Use this spot for the address** calls `reverseGeocode` for the pin and hands the address up
 *   (`onUseSpot`), so the logic is ready the day the map lands and the pin can be dragged.
 *
 * When the map lands, only the `MapRegion` function below is replaced; its props (`pin`,
 * `onPinChange`, the summary text) are what the real map needs. The rest of the step, the form and
 * its tests do not change.
 *
 * Not built, and why: "Use my current location" (needs a location module, a native dependency)
 * and its permission-off note (board `AddressForm-locdenied`).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Icon, Radio, RadioGroup, radius, space, tokens, useTheme, useTypeStyle } from '../../ds';
import { nudge, STEP_METRES, type Compass, type GeoPoint, type StepMetres } from './addressRules';

/** Central Toronto: where Move pin starts when nothing is placed and the config has no centre. */
export const FALLBACK_CENTRE: GeoPoint = { latitude: 43.6532, longitude: -79.3832 };

export type PinStatus = 'unplaced' | 'placed' | 'moved' | 'stored' | 'finding';

export const PIN_COPY = {
  newTitle: 'Find your door on the map',
  editTitle: 'Pin on your entrance',
  newHelp:
    "Search for the address, then place the pin on the door your rider should use. You don't need to be there. We save the pin's position, even if it differs from the typed address.",
  editHelp: 'Your rider goes to this pin. To move it, use Move pin until the pin sits on the right door.',
  moveHelp: 'Each press moves the pin by the step size you choose.',
} as const;

export function pinSummary(status: PinStatus, line1: string): string {
  switch (status) {
    case 'finding':
      return 'Pin dropped. Finding the address';
    case 'unplaced':
      return 'Search for the address, or use Move pin to place the pin';
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
  onPinChange: (pin: GeoPoint) => void;
  /** Reverse-geocode the pin (`reverseGeocode`) and fill the address fields from it. */
  onUseSpot: () => void;
  testID?: string;
}

export function PinStep(props: PinStepProps): React.ReactElement {
  const { isEdit, pin, centre, status, line1, search, error, note, disabled = false, lookupDisabled = false, onPinChange, onUseSpot, testID = 'PinStep' } = props;
  const theme = useTheme();
  const h2 = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [step, setStep] = React.useState<StepMetres>('10');

  const move = (direction: Compass) => onPinChange(nudge(pin ?? centre ?? FALLBACK_CENTRE, direction, Number(step)));
  const summary = pinSummary(status, line1);

  return (
    <View style={styles.stack} testID={testID}>
      <Text accessibilityRole="header" style={[h2, { color: theme.color.text.primary }]}>
        {isEdit ? PIN_COPY.editTitle : PIN_COPY.newTitle}
      </Text>
      <Text style={[small, { color: theme.color.text.secondary }]}>{isEdit ? PIN_COPY.editHelp : PIN_COPY.newHelp}</Text>
      {search}
      <MapRegion pin={pin} summary={summary} line1={line1} hasError={Boolean(error)} />
      {error ? (
        <View accessibilityRole="alert" style={styles.errorRow} testID={`${testID}-error`}>
          <Icon name="error" size={16} color={theme.color.feedback.danger.text} />
          <Text style={[small, { color: theme.color.feedback.danger.text, flex: 1 }]}>{error}</Text>
        </View>
      ) : null}
      {note}
      <View style={styles.buttons}>
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

/**
 * The map. Replace this function (and only this) with the real draggable map when it exists
 * (issue #1023). Until then it is the board's placeholder region: a sunken area with the customer
 * pin and what the pin is doing, named for assistive technology the way the real map's summary
 * will be.
 */
function MapRegion({ pin, summary, line1, hasError }: { pin: GeoPoint | null; summary: string; line1: string; hasError: boolean }): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  return (
    <Card
      variant="outlined"
      radius={radius.lg}
      padding={0}
      style={hasError ? { borderColor: theme.color.feedback.danger.border, borderWidth: 2 } : undefined}
      testID="PinStep-map"
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={`Map. ${summary}. ${line1.trim() || 'no address yet'}.`}
        style={[styles.map, { backgroundColor: theme.color.surface.sunken }]}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.pin,
            { backgroundColor: tokens.color.map.pinCustomer, borderColor: theme.color.text.primary, opacity: pin ? 1 : 0.6 },
          ]}
        >
          <Icon name="map" size={20} color={theme.color.text.onAccent} />
        </View>
        <Text style={[small, { color: theme.color.text.primary, textAlign: 'center', paddingHorizontal: space['4'] }]}>{summary}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space['3'] },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  nudge: { gap: space['2'], padding: space['3'], borderWidth: 1, borderRadius: radius.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  cell: { flexGrow: 1, flexBasis: '45%' },
  map: { height: 240, alignItems: 'center', justifyContent: 'center', gap: space['2'], borderRadius: radius.lg },
  pin: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
