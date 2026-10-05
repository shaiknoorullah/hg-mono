/**
 * "Where should we deliver?" — the first-run address step (Sign-in canvas, After the code:
 * SignedIn-address). Shown once, only after a new customer saves their details with no default
 * address. "Add your address" opens the existing address form; "Not now" lands on Home, where
 * restaurants still load (`listRestaurants` answers `NO_ADDRESS`) and only add-to-cart asks for an
 * address.
 *
 * The address form pops back here after saving, so on every mount this checks the address book:
 * once there is an address, the step is done and Home opens with "Address saved".
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Button, Icon, tokens, useTheme, useTypeStyle } from '@hg/ui-native';

import { listAddresses } from '../api/addresses';
import { FlowLayout } from '../components/FlowLayout';
import { useNavigation } from '../navigation/stack';
import { showWelcome } from '../signin/session';

export function AddressStepScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');

  React.useEffect(() => {
    let live = true;
    listAddresses()
      .then((addresses) => {
        if (!live || addresses.length === 0) return;
        const saved = addresses.find((a) => a.is_default) ?? addresses[0]!;
        showWelcome({
          variant: 'success',
          title: 'Address saved',
          description: `Showing restaurants that deliver to ${saved.line1}.`,
        });
        nav.reset({ name: 'discovery' });
      })
      .catch(() => {
        /* the step stays; nothing is lost by asking */
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FlowLayout
      centerBody
      testID="AddressStepScreen"
      footer={
        <>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconStart={<Icon name="plus" size={20} color={theme.color.text.onBrand} />}
            onPress={() => nav.push({ name: 'addressForm', addressId: null })}
            testID="AddressStep-add"
          >
            Add your address
          </Button>
          <Button variant="ghost" size="lg" fullWidth onPress={() => nav.reset({ name: 'discovery' })}>
            Not now
          </Button>
          <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
            You can look at restaurants now. You'll need an address before adding food to your cart.
          </Text>
        </>
      }
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 64,
          height: 64,
          borderRadius: tokens.radius.full,
          backgroundColor: theme.color.surface.sunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="map" size={32} color={theme.color.text.secondary} />
      </View>
      <Text accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
        Where should we deliver?
      </Text>
      <Text style={[body, { color: theme.color.text.primary }]}>
        Search for your address, then drag the pin onto your door. You don't need to be there.
      </Text>
      <Text style={[body, { color: theme.color.text.secondary }]}>
        Then we'll show the restaurants that deliver to you, each with a halal certificate we've
        checked.
      </Text>
    </FlowLayout>
  );
}
