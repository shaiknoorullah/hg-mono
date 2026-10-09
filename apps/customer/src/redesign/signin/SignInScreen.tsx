/**
 * S1 Sign in, S2 Code and S6 Signed out (boards `SI/Main`, `SI/SignIn-*`, `SI/SignInCode`,
 * `SI/Code-*`, `SI/Main-signedout`, `SI/Main-notyou`), ported from #635's `SignInScreen` state
 * machine onto design-system components.
 *
 * The Shell renders this whenever there is no session, so it owns the signed-out stack:
 * Sign in (or Signed out) → Code → back, and Terms and privacy (signed out). One flow signs in and
 * creates the account (`verifyOtp` finds or creates by phone), so the heading says both.
 *
 * - Phone: a `tel` field with a fixed +1, Canadian mobiles only. Send code stays enabled and
 *   validates on press; only offline and a 429 wait disable it, with the reason as its hint.
 * - Code: valid 5 minutes, resend after `resend_after_s`, at most 3 sends per sign-in, 5 tries. A
 *   resend re-sends the same code. Every wait is a static clock time from the server, never a
 *   ticking numeral and never a client-side 15-minute timer.
 * - After the code the server decides the landing (`signin/landing.ts`). `beginVerify()` runs
 *   first, so the token listener does not jump to Home before the landing is known.
 *
 * Nothing here is green or red.
 */
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import {
  authFailureOf,
  requestOtp,
  retryPendingLogout,
  useLogoutPending,
  verifyOtp,
  type ReceivedChallenge,
} from '../api/auth';
import { callSupport, useSupport } from '../api/config';
import { AppBar, Banner, Button, Icon, Input, Toast, Wordmark, tokens, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { formatTime } from '../lib/time';
import { NavContext, type Nav } from '../navigation/context';
import type { Route } from '../navigation/routes';
import { beginVerify, cancelVerify, clearSignedOutNote, useSession, type SignedOutNote } from '../session/session';
import { useFocusOnMount } from './a11y';
import { applyLanding, landingFor } from './landing';
import { checkPhone, displayPhone, nationalDigits, waitUntil } from './phone';
import { TermsScreen } from './TermsScreen';
import { usePassed } from './useClock';

/** How often a phone that went offline checks whether the API is reachable again. */
const ONLINE_PROBE_MS = 5000;

/** While offline, ask the API now and then, so the screen comes back by itself; then finish a sign-out. */
function useOnlineProbe(): void {
  const { online } = useConnectivity();
  React.useEffect(() => {
    if (online) {
      retryPendingLogout();
      return;
    }
    const id = setInterval(() => {
      void api.GET('/v1/config/public').catch(() => {});
    }, ONLINE_PROBE_MS);
    return () => clearInterval(id);
  }, [online]);
}

interface CodeState {
  phoneE164: string;
  sent: ReceivedChallenge;
}

/** The signed-out flow the Shell renders: Sign in → Code, Terms and privacy, Signed out. */
export function SignInScreen(): React.ReactElement {
  const session = useSession();
  const [stack, setStack] = React.useState<Route[]>(() => [
    session.signedOut ? { name: 'signedOut', reason: session.signedOut } : { name: 'signIn' },
  ]);
  const [phone, setPhone] = React.useState('');
  const [phoneWait, setPhoneWait] = React.useState<number | null>(null);
  const [code, setCode] = React.useState<CodeState | null>(null);
  useOnlineProbe();

  const top = stack[stack.length - 1]!;
  const nav = React.useMemo<Nav>(
    () => ({
      current: top,
      tab: 'home',
      canGoBack: stack.length > 1,
      push: (route) => setStack((s) => [...s, route]),
      replace: (route) => setStack((s) => [...s.slice(0, -1), route]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      selectTab: () => {},
      open: (route) => setStack((s) => [...s, route]),
      reset: (route) => setStack([route]),
    }),
    [top, stack.length],
  );

  let page: React.ReactElement;
  if (top.name === 'terms') {
    page = <TermsScreen signedOut />;
  } else if (top.name === 'code' && code) {
    page = (
      <CodeStep
        key={code.sent.challenge.challenge_id}
        phoneE164={code.phoneE164}
        sent={code.sent}
        onSent={(sent) => setCode({ ...code, sent })}
        onBack={(wait) => {
          setPhone(nationalDigits(code.phoneE164));
          setPhoneWait(wait ?? null);
          setStack([{ name: 'signIn' }]);
        }}
      />
    );
  } else {
    page = (
      <PhoneStep
        phone={phone}
        onPhoneChange={setPhone}
        wait={phoneWait}
        onWait={setPhoneWait}
        note={top.name === 'signedOut' ? (top.reason ?? 'signedOut') : null}
        onSent={(phoneE164, sent) => {
          clearSignedOutNote();
          setPhoneWait(null);
          setCode({ phoneE164, sent });
          setStack([{ name: 'signIn' }, { name: 'code' }]);
        }}
        onTerms={() => nav.push({ name: 'terms', signedOut: true })}
      />
    );
  }
  return <NavContext.Provider value={nav}>{page}</NavContext.Provider>;
}

// ---------------------------------------------------------------------------------------------
// Page frame: content scrolls, the footer stays at the bottom above the keyboard.
// ---------------------------------------------------------------------------------------------

function Frame({
  appBar,
  footer,
  children,
  testID,
}: {
  appBar?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: theme.color.surface.base }]}
      testID={testID}
    >
      {appBar}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: tokens.space['4'],
          paddingTop: appBar ? tokens.space['2'] : tokens.space['12'],
          paddingBottom: tokens.space['4'],
          gap: tokens.space['6'],
        }}
      >
        {children}
      </ScrollView>
      <View style={{ paddingHorizontal: tokens.space['4'], paddingBottom: tokens.space['4'], paddingTop: tokens.space['2'], gap: tokens.space['3'] }}>
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------------------------
// S1 Phone (and S6 Signed out)
// ---------------------------------------------------------------------------------------------

type PhoneProblem = 'unavailable' | 'sendFail' | null;

const PHONE_INCOMPLETE = 'Enter all 10 digits of your mobile number, like 416 555 0134.';
const PHONE_UNSUPPORTED = 'HalalGoes works with Canadian mobile numbers (+1) only for now.';

function PhoneStep({
  phone,
  onPhoneChange,
  wait,
  onWait,
  note,
  onSent,
  onTerms,
}: {
  phone: string;
  onPhoneChange: (next: string) => void;
  wait: number | null;
  onWait: (until: number | null) => void;
  note: SignedOutNote | null;
  onSent: (phoneE164: string, sent: ReceivedChallenge) => void;
  onTerms: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const strong = useTypeStyle('label.md');
  const { online } = useConnectivity();
  const logoutPending = useLogoutPending();
  const support = useSupport();
  const heading = React.useRef<Text>(null);
  useFocusOnMount(heading);

  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<PhoneProblem>(null);
  const [sending, setSending] = React.useState(false);
  const waitOver = usePassed(wait);
  const limited = wait !== null && !waitOver;
  const offline = !online;

  async function send(): Promise<void> {
    const check = checkPhone(phone);
    if (!check.ok) {
      setFieldError(check.reason === 'unsupported' ? PHONE_UNSUPPORTED : PHONE_INCOMPLETE);
      return;
    }
    setFieldError(null);
    setProblem(null);
    setSending(true);
    try {
      const sent = await requestOtp(check.e164);
      setSending(false);
      onSent(check.e164, sent);
    } catch (e) {
      setSending(false);
      const f = authFailureOf(e);
      if (f.kind === 'invalid_phone') setFieldError(PHONE_INCOMPLETE);
      else if (f.kind === 'unsupported_country') setFieldError(PHONE_UNSUPPORTED);
      else if (f.kind === 'rate_limited') onWait(waitUntil(f.at, f.retryAfterS));
      else if (f.kind === 'unavailable') setProblem('unavailable');
      else setProblem('sendFail');
    }
  }

  const unavailable = problem === 'unavailable' && !offline;
  const blockedReason = offline
    ? 'Connect to Wi-Fi or mobile data to get your code.'
    : limited
      ? `You can ask for a new code at ${formatTime(wait!)}.`
      : undefined;
  const supportOpen = support?.kind === 'open' ? support : null;

  return (
    <Frame
      testID="SignInScreen"
      footer={
        <>
          {unavailable ? (
            <>
              <Button variant="primary" size="lg" fullWidth loading={sending} onPress={send} testID="SignIn-retry">
                Try again
              </Button>
              {supportOpen ? (
                <>
                  <Button variant="ghost" size="lg" fullWidth onPress={() => callSupport(supportOpen.phoneE164)} testID="SignIn-call">
                    Call support
                  </Button>
                  {supportOpen.hours ? (
                    <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>
                      Support hours: {supportOpen.hours}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={sending}
              disabled={limited || offline}
              accessibilityHint={blockedReason}
              onPress={send}
              testID="SignIn-send"
            >
              {sending ? 'Sending code' : problem === 'sendFail' ? 'Try again' : 'Send code'}
            </Button>
          )}
          <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>
            By signing in you agree to our Terms of use and Privacy policy.
          </Text>
          <View style={styles.selfCenter}>
            <Button variant="ghost" size="sm" onPress={onTerms} testID="SignIn-terms">
              Terms and privacy
            </Button>
          </View>
        </>
      }
    >
      <Wordmark height={32} />

      {note === 'signedOut' ? (
        <Banner
          variant="neutral"
          title="You're signed out"
          description={
            logoutPending
              ? "Your addresses are saved to your account. Sign in with your number to order again.\nWe'll finish signing this phone out on our side when you're back online."
              : 'Your addresses are saved to your account. Sign in with your number to order again.'
          }
          testID="SignIn-signedout"
        />
      ) : note === 'notYou' ? (
        <Banner variant="neutral" title="You're signed out" description="Enter the right mobile number to continue." testID="SignIn-notyou" />
      ) : null}

      <View style={{ gap: tokens.space['2'] }}>
        <Text ref={heading} accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
          Sign in or create an account
        </Text>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Enter your mobile number and we'll send a 6-digit code. New to HalalGoes? The same code creates your account.
        </Text>
      </View>

      {limited ? (
        <View style={{ gap: tokens.space['1'] }}>
          <Banner
            variant="warning"
            title="Too many codes asked for"
            description="For your security, wait before asking for another code."
            icon={<Icon name="clock" size={24} color={theme.color.text.secondary} />}
            testID="SignIn-limited"
          />
          <Text style={[small, { color: theme.color.text.secondary }]}>
            You can ask for a new code at <Text style={[strong, { color: theme.color.text.primary }]}>{formatTime(wait!)}</Text>.
          </Text>
        </View>
      ) : null}

      {unavailable ? (
        <View style={{ gap: tokens.space['2'] }}>
          <Banner
            variant="warning"
            title="We can't send codes right now"
            description="The problem is on our side, not with your number. Try again in a few minutes."
            testID="SignIn-unavailable"
          />
          {support?.kind === 'closed' ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>
              Our phone line is closed right now. It's open {support.hours}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {offline ? (
        <Banner variant="neutral" title="You're offline" description="Connect to Wi-Fi or mobile data to get your code." testID="SignIn-offline" />
      ) : null}

      {problem === 'sendFail' && !offline ? (
        <Banner
          variant="warning"
          title="We couldn't send your code"
          description="The connection dropped or something went wrong on our side. Your number is still here, so try again."
          testID="SignIn-sendfail"
        />
      ) : null}

      <View style={{ gap: tokens.space['2'] }}>
        <Input
          label="Mobile number"
          variant="tel"
          size="lg"
          required
          autoComplete="tel-national"
          value={phone}
          onChange={(next) => {
            onPhoneChange(next);
            if (fieldError) setFieldError(null);
          }}
          readOnly={sending}
          helperText={fieldError ? undefined : 'Canadian mobile numbers only.'}
          errorText={fieldError ?? undefined}
          testID="SignIn-phone"
        />
        {wait !== null && waitOver ? (
          <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
            You can ask for a code again.
          </Text>
        ) : null}
      </View>

      <View style={styles.row}>
        <Text style={[small, styles.grow, { color: theme.color.text.secondary }]}>
          The code comes by WhatsApp or text message. Standard message rates may apply.
        </Text>
      </View>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// S2 Code
// ---------------------------------------------------------------------------------------------

type CodeProblem =
  | { kind: 'attempts0' }
  | { kind: 'timedOut'; until: number }
  | { kind: 'resendLimit'; until: number }
  | { kind: 'verifyFail' }
  | { kind: 'resendFail' }
  | null;

function CodeStep({
  phoneE164,
  sent,
  onSent,
  onBack,
}: {
  phoneE164: string;
  sent: ReceivedChallenge;
  onSent: (sent: ReceivedChallenge) => void;
  onBack: (wait?: number | null) => void;
}): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const strong = useTypeStyle('label.md');
  const { online } = useConnectivity();
  const heading = React.useRef<Text>(null);
  useFocusOnMount(heading);
  const live = React.useRef(true);
  React.useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const [code, setCode] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);
  const [problem, setProblem] = React.useState<CodeProblem>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [verifyWait, setVerifyWait] = React.useState<number | null>(null);
  const [resentToast, setResentToast] = React.useState(false);

  const resendAt = waitUntil(sent.receivedAt, sent.challenge.resend_after_s);
  const resendOpen = usePassed(resendAt);
  const verifyOpen = usePassed(verifyWait);
  const offline = !online;

  const attempts0 = problem?.kind === 'attempts0';
  const timedOut = problem?.kind === 'timedOut' ? problem : null;
  const resendLimit = problem?.kind === 'resendLimit' ? problem : null;
  const resendRefused = problem?.kind === 'resendFail' || problem?.kind === 'verifyFail';

  async function verify(): Promise<void> {
    if (code.length !== 6) {
      setFieldError('Enter all 6 digits of the code.');
      return;
    }
    setFieldError(null);
    setProblem(null);
    setVerifying(true);
    beginVerify();
    let grant;
    try {
      grant = await verifyOtp(sent.challenge.challenge_id, code);
    } catch (e) {
      cancelVerify();
      if (!live.current) return;
      setVerifying(false);
      const f = authFailureOf(e);
      switch (f.kind) {
        case 'incorrect':
          if (f.attemptsRemaining === 0) {
            setCode('');
            setProblem({ kind: 'attempts0' });
          } else {
            setFieldError(
              f.attemptsRemaining === null
                ? "That code isn't right. Check it and try again."
                : `That code isn't right. You have ${f.attemptsRemaining} ${f.attemptsRemaining === 1 ? 'try' : 'tries'} left.`,
            );
          }
          return;
        case 'expired':
          setExpired(true);
          return;
        case 'rate_limited':
          setVerifyWait(waitUntil(f.at, f.retryAfterS));
          return;
        case 'blocked':
          // The API client has already raised the account's full-screen route.
          return;
        default:
          setProblem({ kind: 'verifyFail' });
          return;
      }
    }
    // Signed in: the server's next_route decides the landing; this screen unmounts when it does.
    applyLanding(await landingFor(grant));
  }

  async function resend(): Promise<void> {
    setResending(true);
    try {
      const next = await requestOtp(phoneE164);
      if (!live.current) return;
      setProblem(null);
      setExpired(false);
      setFieldError(null);
      setResentToast(true);
      onSent(next);
    } catch (e) {
      if (!live.current) return;
      const f = authFailureOf(e);
      if (f.kind === 'rate_limited') {
        const until = waitUntil(f.at, f.retryAfterS);
        // A spent code with no resend left: this sign-in is over (the time comes from Retry-After).
        setProblem(expired ? { kind: 'timedOut', until } : { kind: 'resendLimit', until });
      } else {
        setProblem({ kind: 'resendFail' });
      }
    } finally {
      if (live.current) setResending(false);
    }
  }

  const showField = !timedOut;
  const showVerify = !expired && !timedOut && !attempts0;
  const showResend = !timedOut && !resendLimit && !expired && !attempts0;
  const canResend = (resendOpen || resendRefused) && !offline;
  const verifyBlocked = verifyWait !== null && !verifyOpen;
  const offlineWhy = 'Connect to Wi-Fi or mobile data to check your code. What you typed stays here.';

  return (
    <View style={styles.fill}>
      <Frame
        testID="CodeStep"
        appBar={<AppBar title="" isPageHeading={false} back={{ onPress: () => onBack(), previousTitle: 'phone number' }} />}
        footer={
          <>
            {showVerify ? (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={verifying}
                  disabled={verifyBlocked || offline}
                  accessibilityHint={
                    offline ? offlineWhy : verifyBlocked ? `You can try the code again at ${formatTime(verifyWait!)}.` : undefined
                  }
                  onPress={verify}
                  testID="Code-verify"
                >
                  {verifying ? 'Checking code' : problem?.kind === 'verifyFail' ? 'Try again' : 'Verify and continue'}
                </Button>
                {verifyBlocked ? (
                  <Text accessibilityLiveRegion="polite" style={[small, styles.center, { color: theme.color.text.secondary }]}>
                    You can try the code again at{' '}
                    <Text style={[strong, { color: theme.color.text.primary }]}>{formatTime(verifyWait!)}</Text>.
                  </Text>
                ) : null}
              </>
            ) : null}
            {expired && !timedOut ? (
              <Button variant="primary" size="lg" fullWidth loading={resending} disabled={offline} onPress={resend} testID="Code-sendagain">
                Send the code again
              </Button>
            ) : null}
            {attempts0 || timedOut ? (
              <Button variant="primary" size="lg" fullWidth onPress={() => onBack(timedOut?.until ?? null)} testID="Code-startagain">
                Start again
              </Button>
            ) : null}
            {resendLimit ? (
              <Button variant="ghost" size="lg" fullWidth onPress={() => onBack(resendLimit.until)} testID="Code-startagain">
                Start again
              </Button>
            ) : null}
            {showResend ? (
              <>
                <Button
                  variant="ghost"
                  size="lg"
                  fullWidth
                  loading={resending}
                  disabled={!canResend}
                  accessibilityHint={
                    offline ? offlineWhy : canResend ? undefined : `You can resend the code at ${formatTime(resendAt)}.`
                  }
                  onPress={resend}
                  testID="Code-resend"
                >
                  Resend code
                </Button>
                {!canResend && !offline ? (
                  <Text style={[small, styles.center, { color: theme.color.text.secondary }]}>
                    You can resend the code at <Text style={[strong, { color: theme.color.text.primary }]}>{formatTime(resendAt)}</Text>.
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        }
      >
        <View style={{ gap: tokens.space['2'] }}>
          <Text ref={heading} accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
            Enter the 6-digit code
          </Text>
          <Text style={[body, { color: theme.color.text.secondary }]}>
            We sent it to <Text style={[strong, { color: theme.color.text.primary }]}>{displayPhone(phoneE164)}</Text>.
          </Text>
          <Text style={[body, { color: theme.color.text.primary }]}>Check WhatsApp and your text messages.</Text>
          <View style={styles.selfStart}>
            <Button variant="ghost" size="sm" onPress={() => onBack()} testID="Code-change">
              Change number
            </Button>
          </View>
        </View>

        {attempts0 ? (
          <Banner
            variant="warning"
            title="Too many wrong codes"
            description="You can try a code up to 5 times. For your security this code no longer works. Start again with your number to get a new code."
            testID="Code-attempts0"
          />
        ) : null}
        {timedOut ? (
          <Banner
            variant="neutral"
            title="This sign-in timed out"
            description="Sign-in attempts last 15 minutes. Start again with your number and we'll send a fresh code."
            icon={<Icon name="clock" size={24} color={theme.color.text.secondary} />}
            testID="Code-timedout"
          />
        ) : null}
        {resendLimit ? (
          <Banner
            variant="neutral"
            title="No more resends for this sign-in"
            description={`We've sent it 3 times, the most for one sign-in. Enter the code if it arrives, or start again.\nYou can ask for a fresh code after ${formatTime(resendLimit.until)}.`}
            testID="Code-limit"
          />
        ) : null}
        {problem?.kind === 'verifyFail' ? (
          <Banner
            variant="warning"
            title="We couldn't check your code"
            description="The problem is with the connection or on our side, not your code. It's still here, so try again."
            testID="Code-verifyfail"
          />
        ) : null}
        {problem?.kind === 'resendFail' ? (
          <Banner
            variant="warning"
            title="We couldn't send the code again"
            description="The problem is on our side. The code we already sent still works for 5 minutes after it was sent, so enter it if it arrives."
            testID="Code-resendfail"
          />
        ) : null}
        {offline ? <Banner variant="neutral" title="You're offline" description={offlineWhy} testID="Code-offline" /> : null}

        {showField ? (
          <Input
            label="6-digit code"
            variant="otp"
            size="lg"
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(next) => {
              setCode(next);
              if (fieldError && !expired) setFieldError(null);
            }}
            disabled={attempts0}
            readOnly={verifying}
            helperText={
              fieldError || expired || attempts0 ? undefined : 'The code works for 5 minutes. We fill it in for you if your phone offers it.'
            }
            errorText={
              expired ? 'This code has run out or was already used. Send it again to get 5 more minutes.' : (fieldError ?? undefined)
            }
            testID="Code-input"
          />
        ) : null}
      </Frame>
      {resentToast ? (
        <View style={[styles.toastTop, { top: tokens.space['16'] }]} pointerEvents="box-none">
          <Toast
            variant="success"
            title="Code sent again"
            description="It's the same code as before. It works for 5 minutes from now."
            onDismiss={() => setResentToast(false)}
            testID="Code-resent"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  selfCenter: { alignSelf: 'center' },
  selfStart: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  grow: { flex: 1 },
  toastTop: { position: 'absolute', left: 16, right: 16 },
});
