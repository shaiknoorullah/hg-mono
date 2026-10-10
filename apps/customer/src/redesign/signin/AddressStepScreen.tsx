/**
 * S4 address step: "Where should we deliver?" (boards `SI/SignedIn-address`, `-noaddress`,
 * `-firstaddress`), ported from #635's `AddressStepScreen`.
 *
 * Shown once, after a new customer saves their details with no default address. "Add your
 * address" opens the address form (`{ addressId: null, first: true }`); "Not now" lands on Home in
 * its "Set your delivery address" state (restaurants still load; only add-to-cart asks for an
 * address).
 *
 * The address form comes back here after saving, so on every arrival this checks the address
 * book: once there is an address the step is done, and Home opens with "Address saved". While
 * that check runs, and when it fails, the step simply stays: nothing is lost by asking.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from '../api/client';
import { Button, Icon, tokens, useTheme, useTypeStyle } from '../ds';
import { useNav } from '../navigation/context';
import { showWelcome } from '../session/session';
import { useFocusOnMount } from './a11y';

type Address = Schema['Address'];

export function AddressStepScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const heading = React.useRef<Text>(null);
  useFocusOnMount(heading);

  React.useEffect(() => {
    let live = true;
    unwrap(api.GET('/v1/addresses'))
      .then((res) => {
        const addresses = (res.data ?? []) as Address[];
        if (!live || addresses.length === 0) return;
        const saved = addresses.find((a) => a.is_default) ?? addresses[0]!;
        showWelcome({
          variant: 'success',
          title: 'Address saved',
          description: `Showing restaurants that deliver to ${saved.line1}.`,
        });
        nav.reset({ name: 'home' });
      })
      .catch(() => {
        // The step stays; nothing is lost by asking.
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="AddressStepScreen">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: tokens.space['4'],
          paddingTop: tokens.space['12'],
          paddingBottom: tokens.space['4'],
          gap: tokens.space['4'],
        }}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.circle, { backgroundColor: theme.color.surface.sunken }]}
        >
          <Icon name="map" size={32} color={theme.color.text.secondary} />
        </View>
        <Text ref={heading} accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
          Where should we deliver?
        </Text>
        <Text style={[body, { color: theme.color.text.primary }]}>
          Search for your address, then drag the pin onto your door. You don't need to be there.
        </Text>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Then we'll show the restaurants that deliver to you, each with a halal certificate we've checked.
        </Text>
      </ScrollView>
      <View style={{ paddingHorizontal: tokens.space['4'], paddingBottom: tokens.space['4'], gap: tokens.space['3'] }}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          iconStart={<Icon name="plus" size={20} color={theme.color.text.onBrand} />}
          onPress={() => nav.push({ name: 'addressForm', addressId: null, first: true })}
          testID="AddressStep-add"
        >
          Add your address
        </Button>
        <Button variant="ghost" size="lg" fullWidth onPress={() => nav.reset({ name: 'home' })} testID="AddressStep-notnow">
          Not now
        </Button>
        <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>
          You can look at restaurants now. You'll need an address before adding food to your cart.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
