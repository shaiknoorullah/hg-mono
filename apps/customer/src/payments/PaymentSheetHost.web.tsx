/**
 * The web card sheet: Stripe.js Payment Element inside the @hg/ui-native `Sheet`.
 *
 * Mount once, inside the ThemeProvider (App.tsx). It renders nothing until `payWithSheet`
 * (pay.web.ts) asks for a payment through sheetController.ts; then it opens a sheet for that
 * PaymentIntent and settles the request exactly once: `paid`, `failed` (declined, 3-D Secure
 * failed, Stripe unavailable) or `canceled` (closed). An incomplete card form stays open with
 * Stripe's inline message. Stripe.js is loaded from js.stripe.com on the first payment only, and
 * only on web: this file is the only importer of @stripe/stripe-js and @stripe/react-stripe-js.
 *
 * The card details live in Stripe's iframe; nothing about the card reaches this app or our API.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { loadStripe, type Appearance, type Stripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Banner, Button, Sheet, useTheme, useTypeStyle } from '@hg/ui-native';

import { confirmOutcome } from './confirmResult';
import { getSnapshot, registerHost, settle, subscribe, type PaymentRequest } from './sheetController';
import { isStripeTestMode, stripePublishableKey } from './types';

let stripePromise: Promise<Stripe | null> | null = null;

/** One Stripe.js instance per page; a failed load is retried on the next payment. */
function getStripe(key: string): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(key).catch(() => null);
    void stripePromise.then((s) => {
      if (!s) stripePromise = null;
    });
  }
  return stripePromise;
}

export function PaymentSheetHost(): React.ReactElement | null {
  React.useEffect(() => registerHost(), []);
  const request = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const key = stripePublishableKey();
  if (!request || !key) return null;
  return <CardSheet key={request.id} request={request} publishableKey={key} />;
}

type ThemeT = ReturnType<typeof useTheme>;

/** Stripe's iframe styled from the same tokens as the rest of the app. */
function appearanceFrom(theme: ThemeT): Appearance {
  return {
    theme: 'stripe',
    variables: {
      colorPrimary: theme.color.action.primary,
      colorBackground: theme.color.surface.raised,
      colorText: theme.color.text.primary,
      colorTextSecondary: theme.color.text.secondary,
      colorTextPlaceholder: theme.color.text.placeholder,
      colorDanger: theme.color.feedback.danger.text,
      fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      borderRadius: '8px',
    },
  };
}

function CardSheet({
  request,
  publishableKey,
}: {
  request: PaymentRequest;
  publishableKey: string;
}): React.ReactElement {
  const theme = useTheme();
  const stripe = React.useMemo(() => getStripe(publishableKey), [publishableKey]);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void stripe.then((s) => {
      if (live && !s) setLoadFailed(true);
    });
    return () => {
      live = false;
    };
  }, [stripe]);

  // Elements reads its options once; the request id keys this component, so each payment
  // gets a fresh Elements for its own client secret.
  const options = React.useMemo<StripeElementsOptions>(
    () => ({
      clientSecret: request.clientSecret,
      appearance: appearanceFrom(theme),
      fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600&display=swap' }],
      loader: 'auto',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request.clientSecret],
  );

  return (
    <Elements stripe={stripe} options={options}>
      <CardForm loadFailed={loadFailed} />
    </Elements>
  );
}

function CardForm({ loadFailed }: { loadFailed: boolean }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.sm');
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [elementError, setElementError] = React.useState<string | null>(null);

  const unavailable = loadFailed || elementError !== null;

  const close = React.useCallback(() => {
    if (!busy) settle({ status: 'canceled' });
  }, [busy]);

  const submit = React.useCallback(async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await stripe.confirmPayment({
        elements,
        // A card never leaves the page (3-D Secure runs in Stripe's own overlay); the URL is
        // only for a redirect-based method Stripe might offer for this intent.
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      });
      const out = confirmOutcome(res);
      if (out.status === 'retry') {
        setMessage(out.message);
        setBusy(false);
        return;
      }
      settle(out);
    } catch (e) {
      settle({ status: 'failed', message: e instanceof Error ? e.message : undefined });
    }
  }, [stripe, elements]);

  return (
    <Sheet
      open
      title="Pay by card"
      description="Your card is authorised now and charged only when the restaurant accepts your order."
      onClose={close}
      dismissible={!busy}
      snapPoints={[0.9]}
      testID="CardSheet"
      footer={
        <Button
          variant="primary"
          fullWidth
          loading={busy}
          disabled={unavailable || !ready || !stripe || !elements}
          onPress={() => void submit()}
          testID="CardSheet-pay"
        >
          Pay
        </Button>
      }
    >
      {unavailable ? (
        <Banner
          variant="danger"
          title="The card form could not load"
          description={elementError ?? 'Check your connection, close this and try again. Nothing was charged.'}
        />
      ) : null}
      {isStripeTestMode() ? (
        <Banner
          variant="info"
          title="Stripe test mode"
          description="4242 4242 4242 4242 authorises, 4000 0025 0000 3155 asks for 3-D Secure, 4000 0000 0000 0002 is declined. Any future date, any CVC, any postal code."
        />
      ) : null}
      <PaymentElement
        options={{ layout: 'tabs' }}
        onReady={() => setReady(true)}
        onLoadError={(e) => setElementError(e.error.message ?? 'The card form could not load.')}
      />
      {message ? (
        <Text accessibilityRole="alert" style={[body, { color: theme.color.feedback.danger.text }]}>
          {message}
        </Text>
      ) : null}
    </Sheet>
  );
}
