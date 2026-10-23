/**
 * Checkout's page sections, composed from design-system exports (boards `CC/Checkout-ready` and
 * its siblings). StickyFooter, InlineAlert and the Price-in-Button slot are design-system gaps
 * (the boards say so) and are composed here the way the cart composes them.
 *
 * Every amount is a server figure handed to `Price` (or `formatPrice` for a button's words); nothing
 * on this page adds, subtracts or multiplies one.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents } from '@hg/api-client';
import type { Cents } from '@hg/api-client';

import {
  Card,
  HalalBadge,
  Icon,
  Input,
  Price,
  Radio,
  RadioGroup,
  Skeleton,
  elevationStyle,
  formatPrice,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { presentHalal } from '../lib/halal';
import type { Cart } from '../ordering/cart';
import { itemsText, safeCents } from '../ordering/lines';
import type { ChangedRow, TipChoice } from './model';
import { TIP_PRESETS, TIP_TOO_HIGH, quoteLineOptions } from './model';
import type { Quote } from './checkoutApi';

/* ------------------------------------------------------------ restaurant */

export function RestaurantHeader({ cart, online, asOf, now }: { cart: Cart; online: boolean; asOf: number; now: number }): React.ReactElement | null {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const small = useTypeStyle('body.sm');
  const r = cart.restaurant;
  if (!r) return null;
  const halal = presentHalal(r.halal, { online, asOf, now });
  const min = r.availability?.eta_min_minutes;
  const max = r.availability?.eta_max_minutes;
  const eta = min != null && max != null ? `About ${min}–${max} min` : null;
  return (
    <Card variant="outlined" padding={16} testID="Checkout-restaurant">
      <View style={styles.stack}>
        <Text style={[heading, { color: theme.color.text.primary }]} testID="Checkout-restaurantName">
          {r.name}
        </Text>
        {/* The seal is presentHalal's decision: a missing or partial record draws no badge. */}
        {halal.kind === 'badge' ? (
          <View style={styles.wrap} testID="Checkout-halal">
            <HalalBadge state={halal.state} size="md" surface="card" restaurantId={r.id} certifyingBodyName={halal.certifyingBody} expiresOn={halal.expiresOn} testID="Checkout-halalBadge" />
          </View>
        ) : halal.kind === 'unavailable' || halal.kind === 'stale' ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Checkout-halalLine">
            {halal.line}
          </Text>
        ) : null}
        {eta ? (
          <View style={styles.wrap}>
            <Icon name="clock" size={16} color={theme.color.text.secondary} />
            <Text style={[small, { color: theme.color.text.secondary }]} testID="Checkout-eta">
              {eta}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------- tip */

export function TipCard({
  choice,
  onChoice,
  error,
  disabled,
}: {
  choice: TipChoice;
  onChoice: (next: TipChoice) => void;
  error: string | null;
  disabled: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const value = choice.kind === 'other' ? 'other' : String(choice.value);
  return (
    <Card variant="outlined" padding={16} testID="Checkout-tip">
      <View style={styles.stack}>
        <RadioGroup
          name="checkout-tip"
          label="Tip your rider"
          orientation="horizontal"
          value={value}
          disabled={disabled}
          onChange={(v) => onChoice(v === 'other' ? { kind: 'other', text: choice.kind === 'other' ? choice.text : '' } : { kind: 'preset', value: cents(Number(v)) })}
          testID="Checkout-tipOptions"
        >
          {TIP_PRESETS.map((t) => (
            <Radio key={t} value={String(t)} label={t === 0 ? 'No tip' : formatPrice(t, { free: 'No tip' })} testID={`Checkout-tip-${t}`} />
          ))}
          <Radio value="other" label="Other" testID="Checkout-tip-other" />
        </RadioGroup>
        {choice.kind === 'other' ? (
          <Input
            label="Tip amount"
            // `text`, not `numeric`: the numeric variant strips the decimal point, so "60.00" would
            // be sent as 600000 cents. The decimal keyboard still opens.
            variant="text"
            inputMode="decimal"
            prefix={<Text style={[small, { color: theme.color.text.secondary }]}>$</Text>}
            value={choice.text}
            onChange={(text) => onChoice({ kind: 'other', text })}
            helperText="Goes entirely to your rider."
            errorText={error ?? undefined}
            readOnly={disabled}
            testID="Checkout-tipInput"
          />
        ) : (
          <Text style={[small, { color: theme.color.text.secondary }]}>Goes entirely to your rider. Changing the tip updates the total.</Text>
        )}
      </View>
    </Card>
  );
}

/* --------------------------------------------------------- order summary */

/**
 * "Your order": the quote's lines and money rows, exactly as the server priced them. `was` marks the
 * rows the server changed since the last quote (old struck through, new announced as "now").
 */
export function OrderCard({
  quote,
  loading,
  changed,
  note,
}: {
  quote: Quote | null;
  loading: boolean;
  changed: readonly ChangedRow[];
  note: string | null;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const wasOf = (label: string): Cents | null => changed.find((c) => c.label === label)?.was ?? null;
  return (
    <Card variant="outlined" padding={16} testID="Checkout-order">
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
          Your order
        </Text>
        {quote ? (
          quote.lines.map((l) => {
            const options = quoteLineOptions(l);
            const request = l.special_request?.trim();
            return (
              <View key={l.line_no} style={styles.lineRow} testID={`Checkout-line-${l.line_no}`}>
                <View style={styles.shrink}>
                  <Text style={[body, { color: theme.color.text.primary }]}>{`${l.quantity}× ${l.menu_item_name}`}</Text>
                  {options ? <Text style={[small, { color: theme.color.text.secondary }]}>{options}</Text> : null}
                  {request ? <Text style={[small, styles.italic, { color: theme.color.text.secondary }]}>{`“${request}”`}</Text> : null}
                </View>
                <Price cents={l.line_total_cents} size="sm" loading={loading} />
              </View>
            );
          })
        ) : null}
        {note ? <Text style={[small, { color: theme.color.text.secondary }]}>{note}</Text> : null}
        {quote ? <QuoteRows quote={quote} loading={loading} wasOf={wasOf} /> : null}
      </View>
    </Card>
  );
}

function QuoteRows({ quote, loading, wasOf }: { quote: Quote; loading: boolean; wasOf: (label: string) => Cents | null }): React.ReactElement {
  const taxRows = quote.tax_lines ?? [];
  const discount = quote.discount;
  return (
    <View style={styles.rows} testID="Checkout-quote">
      <Row label="Items subtotal" value={quote.subtotal_cents} was={wasOf('Items subtotal')} loading={loading} testID="Checkout-subtotal" />
      {discount && discount.amount_cents !== 0 ? (
        <Row label={discount.code ? `Discount (${discount.code})` : 'Discount'} value={discount.amount_cents} minus loading={loading} testID="Checkout-discount" />
      ) : null}
      <Row label="Delivery fee" value={quote.delivery_fee_cents} was={wasOf('Delivery fee')} loading={loading} testID="Checkout-delivery" />
      {/* Always shown, even at $0.00. */}
      <Row label="Service fee" value={quote.service_fee_cents} was={wasOf('Service fee')} loading={loading} testID="Checkout-service" />
      {/* The server's tax rows, verbatim: the client never hides a non-empty list. */}
      {taxRows.map((t, i) => (
        <Row key={`${t.jurisdiction_code}-${t.statutory_label}-${i}`} label={t.statutory_label} value={t.amount_cents} loading={loading} testID={`Checkout-tax-${i}`} />
      ))}
      {quote.tip_cents !== 0 ? <Row label="Tip for your rider" value={quote.tip_cents} was={wasOf('Tip for your rider')} loading={loading} testID="Checkout-tipRow" /> : null}
      <Row label="Total" value={quote.total_cents} was={wasOf('Total')} total loading={loading} testID="Checkout-total" />
    </View>
  );
}

export function Row({
  label,
  value,
  was,
  total = false,
  minus = false,
  loading = false,
  testID,
}: {
  label: string;
  value: unknown;
  was?: Cents | null;
  total?: boolean;
  minus?: boolean;
  loading?: boolean;
  testID?: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const text = useTypeStyle(total ? 'heading.sm' : 'body.md');
  const amount = safeCents(value);
  if (amount === null && !loading) return null;
  return (
    <View style={styles.moneyRow} testID={testID}>
      <Text style={[text, styles.shrink, { color: theme.color.text.primary }]}>{label}</Text>
      <View style={styles.amounts}>
        {was != null ? <Price cents={was} size="sm" strikethrough /> : null}
        {minus ? <Text style={[text, { color: theme.color.text.primary }]}>{'−'}</Text> : null}
        <Price cents={amount ?? cents(0)} size={total ? 'lg' : 'sm'} loading={loading} testID={testID ? `${testID}-price` : undefined} />
      </View>
    </View>
  );
}

/** The "Pricing your order for Home…" placeholder rows (`CC/Checkout-quoting`). */
export function QuotingSkeleton(): React.ReactElement {
  return (
    <View style={styles.rows} testID="Checkout-quoting">
      <Row label="Items subtotal" value={0} loading />
      <Row label="Delivery fee" value={0} loading />
      <Row label="Service fee" value={0} loading />
      <Row label="Total" value={0} total loading />
    </View>
  );
}

/* ---------------------------------------------------------------- footer */

/** The sticky footer the boards name as a design-system gap: surface.raised with the sticky elevation. */
export function Footer({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID="Checkout-footer" style={[elevationStyle(theme, 'sticky'), styles.footer, { paddingBottom: 16 + insets.bottom, backgroundColor: theme.color.surface.raised }]}>
      {children}
    </View>
  );
}

/** "Place order · $106.84": the total is the server's, formatted for the button's words. */
export function placeLabel(verb: string, total: Cents | null): string {
  return total === null ? verb : `${verb} · ${formatPrice(total)}`;
}

export function placeA11yLabel(verb: string, total: Cents | null): string {
  return total === null ? verb : `${verb}, ${spokenPrice(total)}`;
}

/** The loading rows for the initial read of the page. */
export function LoadingBody(): React.ReactElement {
  return (
    <View style={styles.body} testID="Checkout-loadingBody">
      <Skeleton variant="rect" height={72} />
      <Skeleton variant="rect" height={132} />
      <Skeleton variant="rect" height={96} />
      <Skeleton variant="rect" height={220} />
    </View>
  );
}

export { TIP_TOO_HIGH, itemsText };

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 16 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
  stack: { gap: 8 },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  shrink: { flexShrink: 1 },
  italic: { fontStyle: 'italic' },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  rows: { gap: 4 },
  moneyRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  amounts: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 16 },
});
