/**
 * Sign in or create an account, by phone (C-01, C-02), as the approved Sign-in canvas draws it:
 * the phone step, the 6-digit code step, and every way each can fail. One flow signs in and
 * creates the account (`verifyOtp` finds or creates by phone), so the heading says both.
 *
 * Phone: a `tel` field with a fixed +1, Canadian mobiles only. Send code stays enabled and
 * validates on press; only a 429 wait blocks it, and its banner says why. 503
 * RATE_LIMITER_UNAVAILABLE is "We can't send codes right now" with Call support; any other failure
 * keeps the number and offers Try again.
 *
 * Code: valid 5 minutes, resend after `resend_after_s`, at most 3 sends in a 15-minute window, 5
 * tries. A resend re-sends the same code. Waits are a static clock time, never a ticking numeral.
 *
 * After the code the server decides where the customer lands (`principal.next_route`): profile
 * capture for a new account (or any account with no first name), Home with a welcome, the active
 * order, or a full-screen route for an account that cannot be used. Nothing here is green or red.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import {
  AppBar,
  Button,
  Icon,
  Input,
  Toast,
  tokens,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import {
  authFailureOf,
  requestOtp,
  verifyOtp,
  type AuthFailure,
  type ReceivedChallenge,
  type SessionGrant,
} from '../api/auth';
import { getProfile } from '../api/profile';
import { getActiveOrder } from '../api/orders';
import { setToken } from '../api/token';
import { callSupport, useSupport } from '../api/support';
import { FlowLayout } from '../components/FlowLayout';
import { Notice } from '../components/Notice';
import { checkPhone, clockTime, displayPhone, waitUntil } from '../signin/phone';
import {
  clearSignedOutNote,
  enterApp,
  enterProfileCapture,
  useSession,
} from '../signin/session';
import { usePassed } from '../signin/useClock';
import { AccountBlockedScreen, type BlockedReason } from './AccountBlockedScreen';

/** A challenge window is 15 minutes from the first send (contract, `requestOtp`). */
const CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

type Step =
  | { kind: 'phone'; waitUntil: number | null }
  | { kind: 'code'; phoneE164: string; sent: ReceivedChallenge; firstSentAt: number }
  | { kind: 'blocked'; reason: BlockedReason };

export function SignInScreen(): React.ReactElement {
  const [phone, setPhone] = React.useState('');
  const [step, setStep] = React.useState<Step>({ kind: 'phone', waitUntil: null });

  const backToPhone = (wait: number | null = null): void => setStep({ kind: 'phone', waitUntil: wait });

  if (step.kind === 'blocked') {
    return <AccountBlockedScreen reason={step.reason} onSignOut={() => backToPhone()} />;
  }
  if (step.kind === 'code') {
    return (
      <CodeStep
        key={step.sent.challenge.challenge_id}
        phoneE164={step.phoneE164}
        sent={step.sent}
        firstSentAt={step.firstSentAt}
        onBack={backToPhone}
        onResent={(sent) => setStep({ ...step, sent })}
        onNewChallenge={(sent) => setStep({ ...step, sent, firstSentAt: sent.receivedAt })}
        onBlocked={(reason) => setStep({ kind: 'blocked', reason })}
      />
    );
  }
  return (
    <PhoneStep
      phone={phone}
      onPhoneChange={setPhone}
      initialWait={step.waitUntil}
      onSent={(phoneE164, sent) =>
        setStep({ kind: 'code', phoneE164, sent, firstSentAt: sent.receivedAt })
      }
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------------------------

type PhoneProblem = 'unavailable' | 'sendFail' | null;

function PhoneStep({
  phone,
  onPhoneChange,
  initialWait,
  onSent,
}: {
  phone: string;
  onPhoneChange: (next: string) => void;
  initialWait: number | null;
  onSent: (phoneE164: string, sent: ReceivedChallenge) => void;
}): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const strong = useTypeStyle('label.md');
  const { signedOut } = useSession();

  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<PhoneProblem>(null);
  const support = useSupport(problem === 'unavailable');
  const [sending, setSending] = React.useState(false);
  const [wait, setWait] = React.useState<number | null>(initialWait);
  const waitOver = usePassed(wait);
  const limited = wait !== null && !waitOver;

  async function send(): Promise<void> {
    const check = checkPhone(phone);
    if (!check.ok) {
      setFieldError(
        check.reason === 'unsupported'
          ? 'HalalGoes works with Canadian mobile numbers (+1) only for now.'
          : 'Enter all 10 digits of your mobile number, like 416 555 0134.',
      );
      return;
    }
    setFieldError(null);
    setProblem(null);
    setSending(true);
    try {
      const sent = await requestOtp(check.e164);
      clearSignedOutNote();
      onSent(check.e164, sent);
    } catch (e) {
      const f = authFailureOf(e);
      if (f.kind === 'invalid_phone') {
        setFieldError('Enter all 10 digits of your mobile number, like 416 555 0134.');
      } else if (f.kind === 'rate_limited') {
        setWait(waitUntil(Date.now(), f.retryAfterS));
      } else if (f.kind === 'unavailable') {
        setProblem('unavailable');
      } else {
        setProblem('sendFail');
      }
    } finally {
      setSending(false);
    }
  }

  const unavailable = problem === 'unavailable';
  const supportPhone = support?.phoneE164 ?? null;

  return (
    <FlowLayout
      wordmark
      testID="SignInScreen"
      footer={
        <>
          {unavailable ? (
            <>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={sending}
                iconStart={<Icon name="refresh" size={20} color={theme.color.text.onBrand} />}
                onPress={send}
              >
                Try again
              </Button>
              {supportPhone ? (
                <>
                  <Button variant="ghost" size="lg" fullWidth onPress={() => callSupport(supportPhone)}>
                    Call support
                  </Button>
                  {support?.hours ? (
                    <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
                      Support hours: {support.hours}
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
              disabled={limited}
              accessibilityHint={limited ? `You can ask for a new code at ${clockTime(wait!)}.` : undefined}
              iconStart={
                problem === 'sendFail' ? (
                  <Icon name="refresh" size={20} color={theme.color.text.onBrand} />
                ) : undefined
              }
              onPress={send}
              testID="SignIn-send"
            >
              {sending ? 'Sending code' : problem === 'sendFail' ? 'Try again' : 'Send code'}
            </Button>
          )}
          <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
            By signing in you agree to our Terms of use and Privacy policy.
          </Text>
        </>
      }
    >
      {signedOut === 'signedOut' ? (
        <Notice
          tone="neutral"
          icon="info"
          title="You're signed out"
          description="Your addresses are saved to your account. Sign in with your number to order again."
        />
      ) : signedOut === 'notYou' ? (
        <Notice
          tone="neutral"
          icon="info"
          title="You're signed out"
          description="Enter the right mobile number to continue."
        />
      ) : null}

      <View style={{ gap: tokens.space['2'] }}>
        <Text accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
          Sign in or create an account
        </Text>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Enter your mobile number and we'll send a 6-digit code. New to HalalGoes? The same code
          creates your account.
        </Text>
      </View>

      {limited ? (
        <View style={{ gap: tokens.space['2'] }}>
          <Notice
            tone="warning"
            icon="clock"
            title="Too many codes asked for"
            description="For your security, wait before asking for another code."
            testID="SignIn-limited"
          />
          <Text style={[small, { color: theme.color.text.secondary }]}>
            You can ask for a new code at{' '}
            <Text style={[strong, { color: theme.color.text.primary }]}>{clockTime(wait!)}</Text>.
          </Text>
        </View>
      ) : null}
      {unavailable ? (
        <View style={{ gap: tokens.space['2'] }}>
          <Notice
            tone="warning"
            icon="warning"
            title="We can't send codes right now"
            description="The problem is on our side, not with your number. Try again in a few minutes."
            testID="SignIn-unavailable"
          />
          {support && !supportPhone && support.hours ? (
            <Text style={[small, { color: theme.color.text.secondary }]}>
              Our phone line is closed right now. It's open {support.hours}.
            </Text>
          ) : null}
        </View>
      ) : null}
      {problem === 'sendFail' ? (
        <Notice
          tone="warning"
          icon="warning"
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

      <View style={{ flexDirection: 'row', gap: tokens.space['2'], alignItems: 'flex-start' }}>
        <View style={{ marginTop: 2 }}>
          <Icon name="info" size={16} color={theme.color.text.secondary} />
        </View>
        <Text style={[small, { color: theme.color.text.secondary, flex: 1 }]}>
          The code comes by WhatsApp or text message. Standard message rates may apply.
        </Text>
      </View>
    </FlowLayout>
  );
}

// ---------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------

type CodeProblem =
  | { kind: 'attempts0' }
  | { kind: 'timedOut' }
  | { kind: 'resendLimit'; until: number }
  | { kind: 'verifyFail' }
  | { kind: 'resendFail' }
  | null;

function CodeStep({
  phoneE164,
  sent,
  firstSentAt,
  onBack,
  onResent,
  onNewChallenge,
  onBlocked,
}: {
  phoneE164: string;
  sent: ReceivedChallenge;
  firstSentAt: number;
  onBack: (wait?: number | null) => void;
  onResent: (sent: ReceivedChallenge) => void;
  onNewChallenge: (sent: ReceivedChallenge) => void;
  onBlocked: (reason: BlockedReason) => void;
}): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const strong = useTypeStyle('label.md');

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

  const attempts0 = problem?.kind === 'attempts0';
  const timedOut = problem?.kind === 'timedOut';
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
    let grant: SessionGrant;
    try {
      grant = await verifyOtp(sent.challenge.challenge_id, code);
    } catch (e) {
      setVerifying(false);
      const f: AuthFailure = authFailureOf(e);
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
          if (Date.now() - firstSentAt >= CHALLENGE_WINDOW_MS) setProblem({ kind: 'timedOut' });
          else setExpired(true);
          return;
        case 'rate_limited':
          setVerifyWait(waitUntil(Date.now(), f.retryAfterS));
          return;
        case 'blocked':
          onBlocked(f.code === 'ACCOUNT_SUSPENDED' ? 'suspended' : 'unavailable');
          return;
        default:
          setProblem({ kind: 'verifyFail' });
          return;
      }
    }
    await land(grant);
  }

  /** Route by the server's `next_route`; the app has no branching tree of its own. */
  async function land(grant: SessionGrant): Promise<void> {
    const { next_route: route, status } = grant.principal;
    if (route === 'SUSPENDED') {
      setToken(null);
      onBlocked(status === 'SUSPENDED' ? 'suspended' : status === 'BANNED' ? 'banned' : 'unavailable');
      return;
    }
    if (route === 'PROFILE_CAPTURE') {
      enterProfileCapture();
      return;
    }
    if (route !== 'HOME' && route !== 'ORDER_TRACKING') {
      // APP_UPDATE_REQUIRED, or a route this build doesn't know: "please update", never a crash.
      setToken(null);
      onBlocked('update');
      return;
    }
    // A customer who never finished "Your details" has no first name: ask again, whatever the
    // route said. A failed read must not hold sign-in up; Home just greets without a name.
    let firstName: string | null = null;
    try {
      firstName = (await getProfile()).first_name.trim();
    } catch {
      firstName = null;
    }
    if (firstName === '') {
      enterProfileCapture();
      return;
    }
    if (route === 'ORDER_TRACKING') {
      const order = await getActiveOrder().catch(() => null);
      if (order) {
        enterApp(
          { name: 'tracking', orderId: order.id },
          { variant: 'neutral', title: "You're signed in", description: "Here's the order you have on the way." },
        );
        return;
      }
    }
    enterApp(
      { name: 'discovery' },
      {
        variant: 'neutral',
        title: "You're signed in",
        description: firstName ? `Welcome back, ${firstName}.` : undefined,
      },
    );
  }

  async function resend(): Promise<void> {
    setResending(true);
    try {
      const next = await requestOtp(phoneE164);
      setProblem(null);
      setExpired(false);
      setFieldError(null);
      // A spent challenge is replaced by a new one, with a new 15-minute window.
      if (next.challenge.challenge_id !== sent.challenge.challenge_id) onNewChallenge(next);
      else onResent(next);
      setResentToast(true);
    } catch (e) {
      const f = authFailureOf(e);
      if (f.kind === 'rate_limited') setProblem({ kind: 'resendLimit', until: waitUntil(Date.now(), f.retryAfterS) });
      else setProblem({ kind: 'resendFail' });
    } finally {
      setResending(false);
    }
  }

  const showField = !timedOut;
  const showVerify = !expired && !timedOut && !attempts0;
  const showResend = !timedOut && !resendLimit && !expired && !attempts0;
  const canResend = resendOpen || resendRefused;
  const verifyBlocked = verifyWait !== null && !verifyOpen;

  return (
    <View style={{ flex: 1 }}>
      <FlowLayout
        testID="CodeStep"
        appBar={
          <AppBar
            tone="cream"
            title=""
            isPageHeading={false}
            back={{ onPress: () => onBack(), previousTitle: 'phone number' }}
          />
        }
        footer={
          <>
            {showVerify ? (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={verifying}
                  disabled={verifyBlocked}
                  onPress={verify}
                  testID="Code-verify"
                >
                  {verifying ? 'Checking code' : problem?.kind === 'verifyFail' ? 'Try again' : 'Verify and continue'}
                </Button>
                {verifyBlocked ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}
                  >
                    You can try the code again at{' '}
                    <Text style={[strong, { color: theme.color.text.primary }]}>{clockTime(verifyWait!)}</Text>.
                  </Text>
                ) : null}
              </>
            ) : null}
            {expired ? (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={resending}
                iconStart={<Icon name="refresh" size={20} color={theme.color.text.onBrand} />}
                onPress={resend}
              >
                Send the code again
              </Button>
            ) : null}
            {attempts0 || timedOut ? (
              <Button variant="primary" size="lg" fullWidth onPress={() => onBack()}>
                Start again
              </Button>
            ) : null}
            {resendLimit ? (
              <Button variant="ghost" size="lg" fullWidth onPress={() => onBack(resendLimit.until)}>
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
                  accessibilityHint={canResend ? undefined : `You can resend the code at ${clockTime(resendAt)}.`}
                  onPress={resend}
                  testID="Code-resend"
                >
                  Resend code
                </Button>
                {!canResend ? (
                  <Text style={[small, { color: theme.color.text.secondary, textAlign: 'center' }]}>
                    You can resend the code at{' '}
                    <Text style={[strong, { color: theme.color.text.primary }]}>{clockTime(resendAt)}</Text>.
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        }
      >
        <View style={{ gap: tokens.space['2'] }}>
          <Text accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]}>
            Enter the 6-digit code
          </Text>
          <Text style={[body, { color: theme.color.text.secondary }]}>
            We sent it to{' '}
            <Text style={{ color: theme.color.text.primary, fontWeight: '600' }}>{displayPhone(phoneE164)}</Text>.
          </Text>
          <Text style={[body, { color: theme.color.text.primary }]}>
            Check WhatsApp and your text messages.
          </Text>
          <View style={{ alignSelf: 'flex-start', marginLeft: -tokens.space['3'] }}>
            <Button variant="ghost" size="sm" onPress={() => onBack()}>
              Change number
            </Button>
          </View>
        </View>

        {attempts0 ? (
          <Notice
            tone="warning"
            icon="lock"
            title="Too many wrong codes"
            description="You can try a code up to 5 times. For your security this code no longer works. Start again with your number to get a new code."
            testID="Code-attempts0"
          />
        ) : null}
        {timedOut ? (
          <Notice
            tone="neutral"
            icon="clock"
            title="This sign-in timed out"
            description="Sign-in attempts last 15 minutes. Start again with your number and we'll send a fresh code."
          />
        ) : null}
        {resendLimit ? (
          <Notice
            tone="neutral"
            icon="info"
            title="No more resends for this sign-in"
            description={`We've sent it 3 times, the most for one sign-in. Enter the code if it arrives, or start again. You can ask for a fresh code after ${clockTime(resendLimit.until)}.`}
          />
        ) : null}
        {problem?.kind === 'verifyFail' ? (
          <Notice
            tone="warning"
            icon="warning"
            title="We couldn't check your code"
            description="The problem is with the connection or on our side, not your code. It's still here, so try again."
            testID="Code-verifyfail"
          />
        ) : null}
        {problem?.kind === 'resendFail' ? (
          <Notice
            tone="warning"
            icon="warning"
            title="We couldn't send the code again"
            description="The problem is on our side. The code we already sent still works for 5 minutes after it was sent, so enter it if it arrives."
          />
        ) : null}

        {showField ? (
          <Input
            label="6-digit code"
            variant="otp"
            size="lg"
            required
            value={code}
            onChange={(next) => {
              setCode(next);
              if (fieldError && !expired) setFieldError(null);
            }}
            disabled={attempts0}
            readOnly={verifying}
            helperText={
              fieldError || expired || attempts0
                ? undefined
                : 'The code works for 5 minutes. We fill it in for you if your phone offers it.'
            }
            errorText={
              expired
                ? 'This code has run out or was already used. Send it again to get 5 more minutes.'
                : (fieldError ?? undefined)
            }
            testID="Code-input"
          />
        ) : null}
      </FlowLayout>
      {resentToast ? (
        <View style={{ position: 'absolute', left: 16, right: 16, top: 64 }}>
          <Toast
            variant="success"
            title="Code sent again"
            description="It's the same code as before. It works for 5 minutes from now."
            onDismiss={() => setResentToast(false)}
          />
        </View>
      ) : null}
    </View>
  );
}
