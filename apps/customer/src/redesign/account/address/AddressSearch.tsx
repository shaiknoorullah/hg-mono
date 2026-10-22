/**
 * Address search for the address form (boards `AC/AddressForm`, `-first`, `-geodown`, and the
 * suggestion states of `DO/Address-search`): a search field, the suggestions under it, and what
 * each way the lookup can fail looks like.
 *
 * Three operations, all through our server (it forwards to Mapbox): `suggestAddresses` while the
 * customer types, `getPlaceAddress` once when they pick a row (which ends the search session, so a
 * new `session_token` follows), and nothing else here. Suggestions carry no coordinates; the place
 * lookup does, and the form puts the pin there.
 *
 * Address entry never becomes impossible:
 * - 429 (too many searches): searching pauses until the time the server named, shown as a clock
 *   time (a static time is true whichever window it was); the fields below still work.
 * - 503 (Mapbox down or refusing us): the search field is replaced by a note; the customer places
 *   the pin and types the fields.
 * - 404 on the place lookup (the suggestion expired) or no suggestions: say so, and offer to type.
 * - anything else: "We couldn't search", with Try again.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Banner, EmptyState, Icon, Input, ListRow, space, useTheme, useTypeStyle } from '../../ds';
import { getNow } from '../../lib/now';
import { formatTime } from '../../lib/time';
import { getPlaceAddress, suggestAddresses } from './addressApi';
import { geoFailure, newSessionToken, type AddressSuggestion, type GeocodedAddress, type GeoPoint } from './addressRules';

export const SEARCH_COPY = {
  label: 'Search for an address',
  helper: 'Type a street and number, like 14 Ellesmere Rd. The pin moves there.',
  unavailableTitle: "Address search isn't working right now",
  unavailableBody: 'Place the pin on your door, then type the address in the fields below. Nothing you typed is lost.',
  failedTitle: "We couldn't search",
  failedBody: 'Check your connection and try again. You can still type the address below.',
  staleTitle: 'That place is no longer available',
  staleBody: 'Search again, or enter the address yourself.',
  emptyBody: 'Check the spelling, move the pin, or enter the address yourself.',
} as const;

/** Letters typed before the first lookup, and the pause after the last key. */
const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; items: AddressSuggestion[] }
  | { kind: 'empty' }
  | { kind: 'picking'; placeId: string }
  | { kind: 'failed'; retry: { during: 'search' } | { during: 'pick'; suggestion: AddressSuggestion } }
  | { kind: 'rate_limited'; until: number }
  | { kind: 'stale' }
  | { kind: 'unavailable' };

export interface AddressSearchProps {
  /** Ranks results near here: the pin if one is placed, else nothing (the server falls back). */
  near: GeoPoint | null;
  disabled?: boolean;
  /** A suggestion was picked and its address fetched. */
  onPick: (address: GeocodedAddress) => void;
  /** "Enter the address yourself": the form moves to its fields. */
  onEnterManually?: () => void;
  testID?: string;
}

export function AddressSearch({ near, disabled = false, onPick, onEnterManually, testID = 'AddressSearch' }: AddressSearchProps): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const [text, setText] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });
  const [nonce, setNonce] = React.useState(0);

  const token = React.useRef(newSessionToken());
  const seq = React.useRef(0);
  const blockedUntil = React.useRef(0);
  const picked = React.useRef<string | null>(null);
  const nearRef = React.useRef(near);
  nearRef.current = near;

  const onFailure = React.useCallback((e: unknown, retry: Extract<Phase, { kind: 'failed' }>['retry']) => {
    const f = geoFailure(e);
    if (f.kind === 'rate_limited') {
      const until = getNow() + f.retryAfterSeconds * 1000;
      blockedUntil.current = until;
      setPhase({ kind: 'rate_limited', until });
    } else if (f.kind === 'unavailable') setPhase({ kind: 'unavailable' });
    else if (f.kind === 'no_match') setPhase(retry.during === 'pick' ? { kind: 'stale' } : { kind: 'empty' });
    else setPhase({ kind: 'failed', retry });
  }, []);

  React.useEffect(() => {
    const q = text.trim();
    if (q.length < MIN_CHARS) {
      setPhase((p) => (p.kind === 'unavailable' || p.kind === 'rate_limited' ? p : { kind: 'idle' }));
      return undefined;
    }
    if (picked.current === q) return undefined;
    const timer = setTimeout(() => {
      if (getNow() < blockedUntil.current) return;
      const run = ++seq.current;
      setPhase({ kind: 'loading' });
      suggestAddresses(q, token.current, nearRef.current)
        .then((items) => {
          if (run === seq.current) setPhase(items.length > 0 ? { kind: 'results', items } : { kind: 'empty' });
        })
        .catch((e: unknown) => {
          if (run === seq.current) onFailure(e, { during: 'search' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      seq.current += 1;
    };
  }, [text, nonce, onFailure]);

  const choose = React.useCallback(
    (suggestion: AddressSuggestion) => {
      const run = ++seq.current;
      setPhase({ kind: 'picking', placeId: suggestion.place_id });
      getPlaceAddress(suggestion.place_id, token.current)
        .then((address) => {
          if (run !== seq.current) return;
          token.current = newSessionToken();
          picked.current = address.formatted.trim();
          setText(address.formatted);
          setPhase({ kind: 'idle' });
          onPick(address);
        })
        .catch((e: unknown) => {
          if (run === seq.current) onFailure(e, { during: 'pick', suggestion });
        });
    },
    [onFailure, onPick],
  );

  if (phase.kind === 'unavailable') {
    return (
      <View style={styles.stack} testID={`${testID}-unavailable`}>
        <Banner
          variant="info"
          title={SEARCH_COPY.unavailableTitle}
          description={SEARCH_COPY.unavailableBody}
          action={{
            label: 'Try search again',
            onPress: () => {
              blockedUntil.current = 0;
              setPhase({ kind: 'idle' });
              setNonce((n) => n + 1);
            },
          }}
        />
      </View>
    );
  }

  const busy = phase.kind === 'loading' || phase.kind === 'picking';
  return (
    <View style={styles.stack} testID={testID}>
      <Input
        label={SEARCH_COPY.label}
        variant="search"
        autoComplete="street-address"
        value={text}
        onChange={(v) => {
          picked.current = null;
          setText(v);
        }}
        helperText={SEARCH_COPY.helper}
        loading={busy}
        readOnly={disabled || phase.kind === 'picking'}
        maxLength={256}
        testID={`${testID}-input`}
      />

      {phase.kind === 'results' ? (
        <View testID={`${testID}-results`}>
          <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]} testID={`${testID}-count`}>
            {phase.items.length === 1 ? '1 suggestion in Canada' : `${phase.items.length} suggestions in Canada`}
          </Text>
          <View accessibilityLabel="Address suggestions" style={{ marginTop: space['2'] }}>
            {phase.items.map((s) => (
              <ListRow
                key={s.place_id}
                icon="map"
                title={s.title}
                subline={s.subtitle ?? undefined}
                onPress={() => choose(s)}
                testID={`${testID}-suggestion-${s.place_id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      {phase.kind === 'empty' ? (
        <EmptyState
          variant="inline"
          illustration={<Icon name="map" size={32} color={theme.color.text.secondary} />}
          title={`No matches for “${text.trim()}”`}
          description={SEARCH_COPY.emptyBody}
          {...(onEnterManually ? { primaryAction: { label: 'Enter the address yourself', onPress: onEnterManually } } : {})}
          testID={`${testID}-empty`}
        />
      ) : null}

      {phase.kind === 'stale' ? (
        <Banner
          variant="info"
          title={SEARCH_COPY.staleTitle}
          description={SEARCH_COPY.staleBody}
          testID={`${testID}-stale`}
        />
      ) : null}

      {phase.kind === 'rate_limited' ? (
        <Banner
          variant="warning"
          title="Too many searches"
          description={`You can search again at ${formatTime(phase.until)}. You can still place the pin and type the address.`}
          testID={`${testID}-rateLimited`}
        />
      ) : null}

      {phase.kind === 'failed' ? (
        <Banner
          variant="warning"
          title={SEARCH_COPY.failedTitle}
          description={SEARCH_COPY.failedBody}
          action={{
            label: 'Try again',
            onPress: () => {
              if (phase.retry.during === 'pick') choose(phase.retry.suggestion);
              else setNonce((n) => n + 1);
            },
          }}
          testID={`${testID}-failed`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space['2'] },
});
