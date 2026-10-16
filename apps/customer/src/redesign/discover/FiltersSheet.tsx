/**
 * Browse's "Filter restaurants" sheet: open now, distance (with an address), price band and
 * dietary needs. Choices are held as a draft and only change the list when "Show restaurants" is
 * pressed; closing the sheet drops them.
 *
 * Left out on purpose, as the board says: a minimum-rating filter (no ratings at launch, so every
 * restaurant would read "New") and a cuisine filter (the contract returns no cuisine ids: https://github.com/shaiknoorullah/hg-mono/issues/931). Price
 * bands are named in words only; the board's dollar-sign suffix is a design-system gap, and
 * "dollar dollar" is never what a screen reader should hear.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Checkbox, Select, Sheet, Switch, useTheme, useTypeStyle } from '../ds';
import {
  DIETARY_CHOICES,
  DISTANCE_CHOICES,
  PRICE_BAND_LABELS,
  distanceLabel,
  type BrowseFilters,
  type DietaryTag,
  type PriceBand,
  NO_FILTERS,
} from './browseData';

const ANY_DISTANCE = 'any';
const BANDS = Object.keys(PRICE_BAND_LABELS) as PriceBand[];

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function FiltersSheet({
  open,
  hasAddress,
  filters,
  onClose,
  onApply,
}: {
  open: boolean;
  hasAddress: boolean;
  filters: BrowseFilters;
  onClose: () => void;
  onApply: (next: BrowseFilters) => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const [draft, setDraft] = React.useState<BrowseFilters>(filters);
  // Each opening starts from what is applied now.
  React.useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const section = (title: string) => (
    <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
      {title}
    </Text>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter restaurants"
      snapPoints={[0.85]}
      testID="Filters"
      footer={
        <View style={styles.footer}>
          <Button variant="primary" size="lg" fullWidth onPress={() => onApply(draft)} testID="Filters-apply">
            Show restaurants
          </Button>
          <Button variant="ghost" size="md" fullWidth onPress={() => setDraft(NO_FILTERS)} testID="Filters-clear">
            Clear filters
          </Button>
        </View>
      }
    >
      <View style={styles.body}>
        <Switch
          label="Open now"
          checked={draft.openNow}
          onChange={(openNow) => setDraft((d) => ({ ...d, openNow }))}
          testID="Filters-openNow"
        />
        {hasAddress ? (
          <Select
            label="Distance"
            value={draft.maxDistanceM == null ? ANY_DISTANCE : String(draft.maxDistanceM)}
            onChange={(v) => setDraft((d) => ({ ...d, maxDistanceM: v === ANY_DISTANCE ? null : Number(v) }))}
            options={[
              { value: ANY_DISTANCE, label: 'Any distance' },
              ...DISTANCE_CHOICES.map((m) => ({ value: String(m), label: distanceLabel(m) })),
            ]}
            testID="Filters-distance"
          />
        ) : null}
        <Text style={[small, { color: theme.color.text.secondary }]}>
          There is no minimum-rating filter yet: customers can rate orders in a later release.
        </Text>
        <View style={styles.group}>
          {section('Price')}
          {BANDS.map((band) => (
            <Checkbox
              key={band}
              label={PRICE_BAND_LABELS[band]}
              checked={draft.priceBands.includes(band)}
              onChange={() => setDraft((d) => ({ ...d, priceBands: toggle(d.priceBands, band) }))}
              testID={`Filters-price-${PRICE_BAND_LABELS[band]}`}
            />
          ))}
        </View>
        <View style={styles.group}>
          {section('Dietary')}
          {DIETARY_CHOICES.map(({ tag, label }) => (
            <Checkbox
              key={tag}
              label={label}
              checked={draft.dietary.includes(tag as DietaryTag)}
              onChange={() => setDraft((d) => ({ ...d, dietary: toggle(d.dietary, tag) }))}
              testID={`Filters-dietary-${label}`}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  group: { gap: 8 },
  footer: { gap: 8 },
});
