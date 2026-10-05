/**
 * Saved addresses (C-30), as the Account canvas's Addresses board draws it: one card of rows,
 * each a single press target that opens the address to edit (where Make default and Delete
 * live), and Add address below the list.
 *
 * Row rules from the canvas: the label is the title ('Home' gets the home icon, anything else the
 * map pin); with no label, `line1` is the title. A unit already starting with Unit, Apt, Suite or
 * # is shown as stored, otherwise prefixed "Unit " (never "Unit Unit 4211").
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { AppBar, Badge, Button, Icon, Skeleton, tokens, useTheme } from '@hg/ui-native';

import { listAddresses, type Address } from '../api/addresses';
import { useAsync } from '../api/async';
import { ListGroup, ListRow } from '../components/ListRow';
import { StateMessage } from '../components/StateMessage';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';

export function unitText(unit: string): string {
  return /^(unit|apt|suite|#)/i.test(unit.trim()) ? unit.trim() : `Unit ${unit.trim()}`;
}

/** Title and the two sublines of an address row. */
export function addressRow(a: Address): { title: string; lines: string[] } {
  const unit = a.unit ? unitText(a.unit) : '';
  const cityLine = `${a.city}, ${a.province} ${a.postal_code}`;
  if (a.label) return { title: a.label, lines: [unit ? `${a.line1}, ${unit}` : a.line1, cityLine] };
  return { title: a.line1, lines: unit ? [unit, cityLine] : [cityLine] };
}

export function AddressesScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => listAddresses(), []);

  const add = (): void => nav.push({ name: 'addressForm', addressId: null });
  const empty = state.kind === 'ready' && state.data.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar
        tone="cream"
        title="Addresses"
        back={{ onPress: nav.back, previousTitle: 'Account' }}
        loading={state.kind === 'loading'}
      />
      <View style={{ flex: 1 }}>
        {state.kind === 'loading' ? (
          <View style={{ padding: tokens.space['4'], paddingTop: tokens.space['2'] }} accessibilityLabel="Loading addresses">
            <ListGroup>
              {[40, 30].map((w) => (
                <View
                  key={w}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'], minHeight: theme.density.rowHeight, paddingHorizontal: tokens.space['4'] }}
                >
                  <View style={{ width: 36 }}>
                    <Skeleton variant="rect" height={36} animated={false} />
                  </View>
                  <View style={{ flex: 1, gap: tokens.space['2'] }}>
                    <View style={{ width: `${w}%` }}>
                      <Skeleton variant="rect" height={14} animated={false} />
                    </View>
                    <View style={{ width: '70%' }}>
                      <Skeleton variant="rect" height={12} animated={false} />
                    </View>
                  </View>
                </View>
              ))}
            </ListGroup>
          </View>
        ) : state.kind === 'error' ? (
          <StateMessage
            tone="error"
            icon="refresh"
            title="We couldn't load your addresses"
            description="Check your connection and try again. Your saved addresses are safe."
            onRetry={reload}
            testID="Addresses-error"
          />
        ) : empty ? (
          <StateMessage
            tone="empty"
            icon="map"
            title="No saved addresses"
            description="Add the street address your rider should come to, with a unit or buzzer if there is one. You don't need to be there."
            testID="Addresses-empty"
          />
        ) : (
          <ScrollView contentContainerStyle={{ padding: tokens.space['4'], paddingTop: tokens.space['2'] }}>
            <ListGroup testID="Addresses-list">
              {state.data.map((a) => {
                const row = addressRow(a);
                return (
                  <ListRow
                    key={a.id}
                    icon={a.label === 'Home' ? 'home' : 'map'}
                    title={row.title}
                    subtitle={row.lines.join('\n')}
                    trailing={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['2'] }}>
                        {a.is_default ? <Badge label="Default" variant="neutral" size="sm" /> : null}
                        <Icon name="chevron-right" size={20} color={theme.color.text.secondary} />
                      </View>
                    }
                    accessibilityLabel={`${a.label ? `${a.label}, ` : ''}${a.is_default ? 'default address, ' : ''}${row.lines.join(', ')}. Edit`}
                    onPress={() => nav.push({ name: 'addressForm', addressId: a.id })}
                  />
                );
              })}
            </ListGroup>
          </ScrollView>
        )}
      </View>
      {state.kind !== 'error' ? (
        <View style={{ paddingHorizontal: tokens.space['4'], paddingBottom: tokens.space['4'], paddingTop: tokens.space['2'] }}>
          <Button
            variant={empty ? 'primary' : 'tertiary'}
            size="lg"
            fullWidth
            disabled={state.kind === 'loading'}
            iconStart={<Icon name="plus" size={20} color={empty ? theme.color.text.onBrand : theme.color.text.primary} />}
            onPress={add}
            testID="Addresses-add"
          >
            Add address
          </Button>
        </View>
      ) : null}
      <CustomerTabBar active="profile" />
    </View>
  );
}
