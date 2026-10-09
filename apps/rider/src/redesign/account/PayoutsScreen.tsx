/**
 * Payouts with Stripe: one screen, two entry points (PA canvas, "F3 · Step 5" and "F15 ·
 * Account"). R14 is the application's step 5 (`context: 'application'`, AppBar "Your
 * application · Payouts"); R47 is Account › Payouts (`context: 'account'`, AppBar "Payouts").
 * The Earnings tab's payout-account link (R40) opens the account one.
 *
 * Sequence (PA note n_payout): GET /connect/status → 404 means no account yet ("Get paid" /
 * "Payouts are not set up", never the error). Continue → POST /connect/account with an
 * Idempotency-Key (kept until it succeeds, so a retry never makes a second account) → POST
 * /connect/onboarding-link → open the link in the browser. 409 from either → "Payouts open after
 * approval"; any other failure on create → "We couldn't set up your payout account"; on the link
 * → "Stripe didn't open". Back from Stripe (the app returns to the foreground) the status is read
 * again and the screen says what Stripe still needs, or "Checking with Stripe" (slow after two
 * minutes), or ready. The redirect itself is never trusted: readiness is the status alone.
 *
 * Requirement keys are never shown (contract: verbatim, never paraphrased; board: raw keys only
 * on the clipboard for support). Plain-language labels per key are Needs API (manifest §5 #45),
 * so the "What Stripe needs" list is not drawn: the count says how many, Stripe shows what.
 */
import * as React from 'react';
import { AppState, Linking, ScrollView, Text, View } from 'react-native';
import { idempotencyKey } from '@hg/api-client';

import { AppBar, Badge, Banner, Button, Divider, ErrorState, Skeleton, space, typeStyle, useTheme, type TypeName } from '../ds';
import { callSupport, useSupport, type Support } from '../data/config';
import { useOnline } from '../data/connectivity';
import { toRiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { useOptionalSession } from '../session/Session';
import { PAYOUTS, SUPPORT, intervalWords, longDate } from './copy';
import { createConnectAccount, createOnboardingLink, fetchConnectStatus, payoutView, supportDetails, type PayoutView } from './data';
import type { PayoutsContext } from './routes';

/** How often the status is read again while Stripe is checking. */
export const CHECK_POLL_MS = 5_000;
/** "Checking" becomes "still checking" after this long (manifest R14: ">2 min slow"). */
export const SLOW_CHECK_MS = 120_000;
/** Back from Stripe, a not-yet-submitted status may be the webhook still on its way. */
export const RETURN_GRACE_MS = 30_000;

type Action = 'idle' | 'opening' | 'notYet' | 'createFailed' | 'linkFailed';

function useText() {
  const theme = useTheme();
  return (name: TypeName, secondary = false) => [
    typeStyle(theme, name),
    { color: secondary ? theme.color.text.secondary : theme.color.text.primary },
  ];
}

export function PayoutsScreen({ params }: ScreenProps<'payouts'>): React.ReactElement {
  const context: PayoutsContext = params?.context ?? 'account';
  const app = context === 'application';
  const theme = useTheme();
  const text = useText();
  const nav = useNav();
  const session = useOptionalSession();
  const support = useSupport();
  const online = useOnline();

  const [action, setAction] = React.useState<Action>('idle');
  const [returnedAt, setReturnedAt] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const keyRef = React.useRef(idempotencyKey());
  const createdRef = React.useRef(false);
  const awayRef = React.useRef(false);
  const checkingSince = React.useRef(0);

  const now = Date.now();
  const status = useApiQuery('connect-status', fetchConnectStatus, {
    pollMs: (data) => {
      const v = data === undefined ? null : payoutView(data).kind;
      return v === 'checking' || (v === 'returned' && now - returnedAt < RETURN_GRACE_MS) ? CHECK_POLL_MS : null;
    },
  });

  // Back from Stripe: the query re-reads the status on foreground; remember when, so a status
  // that has not caught up yet reads "Checking with Stripe", not "Stripe isn't finished yet".
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && awayRef.current) {
        awayRef.current = false;
        setReturnedAt(Date.now());
      }
    });
    return () => sub.remove();
  }, []);

  let view: PayoutView | null = status.data === undefined ? null : payoutView(status.data);
  if (view?.kind === 'returned' && returnedAt > 0 && now - returnedAt < RETURN_GRACE_MS) view = { kind: 'checking' };
  if (view?.kind === 'checking') {
    if (!checkingSince.current) checkingSince.current = now;
  } else {
    checkingSince.current = 0;
  }
  const slow = view?.kind === 'checking' && now - checkingSince.current >= SLOW_CHECK_MS;

  // Time alone changes what shows (checking → still checking; the return grace ending), so
  // re-render when it does, whatever the polling is doing.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  const checking = view?.kind === 'checking';
  React.useEffect(() => {
    if (!checking || slow) return;
    const id = setTimeout(tick, Math.max(0, checkingSince.current + SLOW_CHECK_MS - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [checking, slow]);
  React.useEffect(() => {
    if (!returnedAt) return;
    const id = setTimeout(tick, Math.max(0, returnedAt + RETURN_GRACE_MS - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [returnedAt]);

  const openStripe = async () => {
    setAction('opening');
    if (status.data === null && !createdRef.current) {
      try {
        await createConnectAccount(keyRef.current);
        createdRef.current = true;
      } catch (e) {
        setAction(toRiderError(e).status === 409 ? 'notYet' : 'createFailed');
        return;
      }
    }
    try {
      const url = await createOnboardingLink();
      awayRef.current = true;
      await Linking.openURL(url);
      setAction('idle');
    } catch (e) {
      awayRef.current = false;
      setAction(toRiderError(e).status === 409 ? 'notYet' : 'linkFailed');
    }
  };

  const copyDetails = async () => {
    // Required on use: expo-clipboard's native module loads only when the rider copies, so
    // importing this screen never needs it (tests, web, a build without the module).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    await Clipboard.setStringAsync(supportDetails(status.data ?? null));
    setCopied(true);
  };

  const goHome = async () => {
    await session?.refresh();
    nav.closeFlow();
    nav.switchTab('home');
  };

  const opening = action === 'opening';
  const notYet = action === 'notYet';

  /* ---------------------------------------------------------------- chrome ---------------- */

  const header = (
    <>
      {/* ds-request(native): AppBar tone="field" with a 56px back — PA Payout-*, Account-Payouts* */}
      <AppBar
        title={app ? PAYOUTS.appTitle : PAYOUTS.title}
        subtitle={app && view?.kind !== 'ready' ? PAYOUTS.title : undefined}
        back={nav.canGoBack ? { onPress: () => nav.pop() } : undefined}
        progress={app && view?.kind !== 'ready' ? (notYet ? 0.6 : 0.8) : undefined}
      />
    </>
  );

  const stepLine =
    app && view?.kind !== 'ready' ? (
      // ds-request(native): ProgressSteps (Step N of 5) — PA Payout-* boards
      <Text style={text('label.lg', true)} testID="payout-step">
        {notYet ? PAYOUTS.step4 : PAYOUTS.step5}
      </Text>
    ) : null;

  const offline = !online ? (
    // ds-request(native): InlineAlert (slate, persistent) — PA/Payout-Offline
    <Banner variant="neutral" title={PAYOUTS.offlineTitle} description={PAYOUTS.offlineBody} testID="payout-offline" />
  ) : null;

  const failure =
    action === 'createFailed' ? (
      <Banner variant="neutral" title={PAYOUTS.createFailedTitle} description={PAYOUTS.createFailedBody} testID="payout-create-failed" />
    ) : action === 'linkFailed' ? (
      <Banner variant="neutral" title={PAYOUTS.linkFailedTitle} description={PAYOUTS.linkFailedBody} testID="payout-link-failed" />
    ) : null;

  const failed = action === 'createFailed' || action === 'linkFailed';

  const continueButton = (label: string = PAYOUTS.continue, variant: 'primary' | 'tertiary' = 'primary') => (
    <Button variant={variant} size="xl" fullWidth loading={opening} accessibilityLabel={opening ? PAYOUTS.opening : undefined} onPress={() => void openStripe()} testID="payout-continue">
      {failed && variant === 'primary' ? PAYOUTS.retry : label}
    </Button>
  );

  const forSupport = (lead?: string) => (
    // ds-request(native): Disclosure ("For support") — PA Payout-Due, -PastDue, -Rejected, Account-Payouts-Due
    <View style={{ gap: space['2'] }} testID="payout-for-support">
      <Text style={text('label.lg', true)}>{PAYOUTS.forSupport}</Text>
      {lead ? <Text style={text('body.md')}>{lead}</Text> : null}
      <Button variant="tertiary" size="xl" fullWidth onPress={() => void copyDetails()} testID="payout-copy" accessibilityHint={copied ? 'Copied' : undefined}>
        {PAYOUTS.copy}
      </Button>
    </View>
  );

  const call = (variant: 'ghost' | 'secondary' = 'ghost', hours = false) => <SupportButton support={support} variant={variant} hours={hours} />;

  const page = (testID: string, body: React.ReactNode, footer?: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }} testID={testID}>
      {header}
      <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['4'], paddingBottom: space['8'] }}>
        {offline}
        {stepLine}
        {body}
      </ScrollView>
      {footer ? <View style={{ padding: space['4'], gap: space['3'] }}>{footer}</View> : null}
    </View>
  );

  /* ---------------------------------------------------------------- states ---------------- */

  if (status.status === 'loading' || view === null) {
    if (status.status === 'error') {
      return page(
        'payout-error',
        // ds-request(native): ErrorState rider variant (56px action) — PA/Payout-StatusError, Account-Payouts-Error
        <ErrorState
          variant="page"
          title={PAYOUTS.errorTitle}
          description={app ? PAYOUTS.errorBodyApp : PAYOUTS.errorBodyAccount}
          onRetry={() => void status.refetch()}
          retrying={status.refreshing}
        />,
        app ? call() : undefined,
      );
    }
    return page(
      'payout-loading',
      <View accessible accessibilityRole="progressbar" accessibilityLabel={PAYOUTS.loading} style={{ gap: space['4'] }}>
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="rect" height={120} />
      </View>,
    );
  }

  const heading = (s: string) => (
    <Text accessibilityRole="header" style={text('heading.xl')}>
      {s}
    </Text>
  );
  const para = (s: string, secondary = false, testID?: string) => (
    <Text style={text('body.lg', secondary)} testID={testID}>
      {s}
    </Text>
  );

  switch (view.kind) {
    case 'start': {
      if (notYet) {
        return page(
          'payout-not-yet',
          <>
            {heading(PAYOUTS.getPaid)}
            {para(PAYOUTS.getPaidBody)}
            <Banner variant="neutral" title={PAYOUTS.notYetTitle} description={PAYOUTS.notYetBody} testID="payout-not-yet-alert" />
          </>,
          <>
            <Button
              variant="tertiary"
              size="xl"
              fullWidth
              onPress={() => {
                setAction('idle');
                if (!nav.pop()) void session?.refresh();
              }}
              testID="payout-back-to-review"
            >
              {PAYOUTS.backToReview}
            </Button>
            {call()}
          </>,
        );
      }
      if (!app) {
        return page(
          'payout-not-set-up',
          <>
            {heading(PAYOUTS.notSetUp)}
            {para(PAYOUTS.notSetUpBody)}
            <Facts rows={[[PAYOUTS.bankAccount, PAYOUTS.noneYet], [PAYOUTS.stripe, <Badge key="b" label={PAYOUTS.off} variant="outline" size="lg" />]]} />
            {failure}
          </>,
          continueButton(PAYOUTS.setUp),
        );
      }
      return page(
        'payout-start',
        <>
          {para(PAYOUTS.approved)}
          {para(PAYOUTS.oneLeft)}
          {heading(PAYOUTS.getPaid)}
          {para(PAYOUTS.getPaidBody)}
          {failure}
        </>,
        <>
          {continueButton()}
          {call()}
        </>,
      );
    }

    case 'returned':
      return page(
        'payout-returned',
        <>
          {heading(PAYOUTS.returned)}
          {para(PAYOUTS.returnedBody)}
          {failure}
        </>,
        <>
          {continueButton(PAYOUTS.continueWith)}
          {call()}
        </>,
      );

    case 'checking':
      return page(
        slow ? 'payout-checking-slow' : 'payout-checking',
        <>
          {heading(slow ? PAYOUTS.slow : PAYOUTS.checking)}
          {para(slow ? PAYOUTS.slowBody : PAYOUTS.checkingBody)}
          {slow ? para(PAYOUTS.slowNotify) : <Skeleton variant="rect" height={56} />}
        </>,
        <>
          <Button variant={slow ? 'secondary' : 'tertiary'} size="xl" fullWidth loading={status.refreshing} onPress={() => void status.refetch()} testID="payout-check-again">
            {PAYOUTS.checkAgain}
          </Button>
          {call()}
        </>,
      );

    case 'due': {
      if (!app && view.payoutsOn && view.deadline) {
        // Account › Payouts, payouts still on with a deadline (PA/Account-Payouts-Due). The board's
        // "If Stripe pauses them, you can still take offers…" sentence waits on Needs API #15
        // (going online while payouts are paused), so it is not said.
        return page(
          'payout-due-by',
          <>
            {heading(PAYOUTS.dueBy(view.count, longDate(view.deadline)))}
            {para(PAYOUTS.dueByBody)}
            {para(PAYOUTS.dueBody)}
            {failure}
            {forSupport()}
          </>,
          <>
            {continueButton()}
            {call()}
          </>,
        );
      }
      return page(
        'payout-due',
        <>
          {heading(PAYOUTS.due(view.count))}
          {para(PAYOUTS.dueBody)}
          {view.later > 0 ? para(PAYOUTS.later(view.later)) : null}
          {view.onHold ? para(PAYOUTS.onHold) : null}
          {failure}
          {forSupport()}
        </>,
        <>
          {continueButton()}
          {call()}
        </>,
      );
    }

    case 'pastDue':
      return page(
        'payout-past-due',
        <>
          {heading(PAYOUTS.pastDue(view.count))}
          {para(view.deadline ? PAYOUTS.pastDueBy(longDate(view.deadline)) : PAYOUTS.pastDueNoDate)}
          {para(PAYOUTS.dueBody)}
          {view.deadline ? <Facts rows={[[PAYOUTS.deadline, PAYOUTS.deadlinePassed(longDate(view.deadline))]]} /> : null}
          {failure}
          {forSupport()}
        </>,
        <>
          {continueButton()}
          {call()}
        </>,
      );

    case 'rejected':
      return page(
        'payout-rejected',
        <>
          {heading(PAYOUTS.rejected)}
          {para(PAYOUTS.rejectedBody)}
          {call('secondary', true)}
          {forSupport(PAYOUTS.rejectedSupport)}
        </>,
      );

    case 'ready': {
      const last4 = status.data?.bank_last4 ?? null;
      const interval = intervalWords(status.data?.payout_interval);
      if (app) {
        return page(
          'payout-ready',
          <>
            {heading(PAYOUTS.ready)}
            {para(last4 ? PAYOUTS.readyBank(last4, interval.lower) : PAYOUTS.readyNoBank(interval.lower))}
            {para(PAYOUTS.readyGo)}
          </>,
          <>
            <Button variant="primary" size="xl" fullWidth onPress={() => void goHome()} testID="payout-go-home">
              {PAYOUTS.goHome}
            </Button>
            {call()}
          </>,
        );
      }
      return page(
        view.later > 0 ? 'payout-eventually' : 'payout-on',
        <>
          <Facts
            rows={[
              ...(last4 ? [[PAYOUTS.bankAccount, PAYOUTS.ending(last4)] as const] : []),
              [PAYOUTS.schedule, interval.title] as const,
              [PAYOUTS.stripe, <Badge key="b" label={PAYOUTS.on} variant="outline" size="lg" />] as const,
            ]}
          />
          {view.later > 0 ? (
            <>
              {heading(PAYOUTS.eventually(view.later))}
              {para(PAYOUTS.eventuallyBody)}
              {failure}
              {continueButton(PAYOUTS.addNow, 'tertiary')}
              {forSupport()}
            </>
          ) : (
            <>
              {para(PAYOUTS.holds)}
              {failure}
              {continueButton(PAYOUTS.changeBank, 'tertiary')}
            </>
          )}
        </>,
      );
    }
  }
}

/* Local helpers (this file only). */

/** ds-request(native): KeyValueList — PA/Account-Payouts, Payout-PastDue. */
function Facts({ rows }: { rows: readonly (readonly [string, React.ReactNode])[] }): React.ReactElement {
  const text = useText();
  return (
    <View style={{ gap: space['3'] }}>
      {rows.map(([k, v], i) => (
        <View key={k} style={{ gap: space['1'] }}>
          {i > 0 ? <Divider /> : null}
          <Text style={text('label.md', true)}>{k}</Text>
          {typeof v === 'string' ? <Text style={text('body.lg')}>{v}</Text> : <View style={{ alignSelf: 'flex-start' }}>{v}</View>}
        </View>
      ))}
    </View>
  );
}

function SupportButton({ support, variant, hours }: { support: Support; variant: 'ghost' | 'secondary'; hours: boolean }): React.ReactElement | null {
  const text = useText();
  if (!support.phone) return <Text style={text('body.md', true)}>{SUPPORT.off}</Text>;
  return (
    <View style={{ gap: space['2'] }}>
      <Button variant={variant} size="xl" fullWidth onPress={() => callSupport(support)} testID="call-support">
        {SUPPORT.call}
      </Button>
      {hours && support.hours ? <Text style={text('body.md', true)}>{SUPPORT.hours(support.hours)}</Text> : null}
    </View>
  );
}

