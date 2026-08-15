/**
 * Post-delivery ratings — food and rider, rated and submitted separately (C-38 adjacent).
 *
 * The contract has no rating-submission endpoint at any version (`api/ratings.ts` explains why
 * this is in-memory rather than a fabricated call), but the screen itself is the real thing: it
 * loads the real order via `getOrder` so the subject line names the actual restaurant and rider,
 * and `Rating variant="input"` is the library's own review-submission control.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, Button, Card, ErrorState, Input, Rating, Spinner, Toast, useTheme, useTypeStyle } from '@hg/ui-native';

import { getOrder, type OrderCustomerView } from '../api/orders';
import { getRating, submitRating } from '../api/ratings';
import { useAsync } from '../api/async';
import { useNavigation } from '../navigation/stack';

export function RateOrderScreen({ orderId }: { orderId: string }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { state, reload } = useAsync(() => getOrder(orderId), [orderId]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Rate your order" back={{ onPress: nav.back }} />
      {state.kind === 'loading' ? (
        <View style={{ flex: 1, padding: 16 }}>
          <Spinner label="Loading order" />
        </View>
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState errorCode={state.code} onRetry={reload} />
        </View>
      ) : (
        <RatingForm order={state.data} bottomInset={insets.bottom} onDone={() => nav.back()} />
      )}
    </View>
  );
}

function RatingForm({
  order,
  bottomInset,
  onDone,
}: {
  order: OrderCustomerView;
  bottomInset: number;
  onDone: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');

  const existing = getRating(order.id);
  const [foodRating, setFoodRating] = React.useState(existing?.foodRating ?? 0);
  const [riderRating, setRiderRating] = React.useState(existing?.riderRating ?? 0);
  const [comment, setComment] = React.useState(existing?.comment ?? '');
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(existing !== null);

  const hasRider = order.rider !== null;
  const canSubmit = foodRating > 0 && (!hasRider || riderRating > 0);

  async function submit(): Promise<void> {
    setSaving(true);
    try {
      await submitRating({
        orderId: order.id,
        foodRating,
        riderRating: hasRider ? riderRating : null,
        comment: comment.trim(),
      });
      setSubmitted(true);
      setToast('Thanks for rating your order.');
    } catch {
      setToast("Couldn't submit your rating — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + bottomInset, gap: 16 }}>
      <Text style={[heading, { color: theme.color.text.primary }]}>{order.restaurant.name}</Text>
      <Text style={[body, { color: theme.color.text.secondary }]}>Order {order.code}</Text>

      <Card variant="outlined">
        <View style={{ gap: 12 }}>
          <Text style={[body, { color: theme.color.text.primary, fontWeight: '700' }]}>
            How was the food?
          </Text>
          <Rating
            value={foodRating || null}
            variant="input"
            size="lg"
            onChange={setFoodRating}
            subject={`your order from ${order.restaurant.name}`}
          />
        </View>
      </Card>

      {hasRider ? (
        <Card variant="outlined">
          <View style={{ gap: 12 }}>
            <Text style={[body, { color: theme.color.text.primary, fontWeight: '700' }]}>
              How was your rider, {order.rider!.first_name}?
            </Text>
            <Rating
              value={riderRating || null}
              variant="input"
              size="lg"
              onChange={setRiderRating}
              subject={`your rider, ${order.rider!.first_name}`}
            />
          </View>
        </Card>
      ) : null}

      <Input
        label="Add a comment (optional)"
        value={comment}
        onChange={setComment}
        placeholder="Tell us more…"
        maxLength={500}
        characterCount
      />

      <Button variant="primary" onPress={submit} loading={saving} disabled={!canSubmit} fullWidth>
        {submitted ? 'Update rating' : 'Submit rating'}
      </Button>

      {submitted ? (
        <Button variant="tertiary" onPress={onDone} fullWidth>
          Done
        </Button>
      ) : null}

      {toast ? (
        <Toast
          variant={toast.startsWith("Couldn't") ? 'danger' : 'success'}
          title={toast}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </ScrollView>
  );
}
