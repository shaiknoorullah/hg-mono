/**
 * R02 Enter your code. Boards: SO `SignIn-Code`, `-Pasted`, `-Verifying`, `-Incorrect`,
 * `-TriesUsed`, `-Expired`, `-Resend`, `-ResendLimit`, `-Locked`, `-Offline`, `-Keyboard`,
 * `SignIn-Code-Incorrect-Light`.
 *
 * - Verify is off until 6 digits; the 6th digit (typed, pasted or one-time-code autofill) checks
 *   the code by itself.
 * - The resend line counts down from the server's `resend_after_s`. Inside the challenge the
 *   server re-sends the same code, at most 3 sends; after that the rider waits out the 15-minute
 *   window (`ResendLimit`), never starts again.
 * - A wrong code clears the field and says how many tries are left; `attempts_remaining` 0 means
 *   the challenge is used up ("That code no longer works", Send a new code).
 * - 429 on verify is "Too many tries" (locked); a closed account goes to `SignIn-Deactivated`.
 */
import * as React from 'react';
import { AccessibilityInfo, BackHandler, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { AppBar, Banner, Button, Icon, Input, space, typeStyle, useTheme } from '../ds';
import { callSupport, type Support } from '../data/config';
import { GENERIC } from '../data/errors';
import { useNow } from './clock';
import { CALL_SUPPORT, CHALLENGE_WINDOW_MS, CODE, MAX_SENDS, PHONE, minutesFromMs } from './copy';
import { requestCode, verifyCode, type OtpChallenge } from './otp';

/** What the sign-in flow knows about the open challenge. */
export interface Challenge {
  phoneE164: string;
  challengeId: string;
  /** ms epoch: when "Send the code again" opens. */
  resendAt: number;
  /** ms epoch: when this code stops working. */
  expiresAt: number;
  /** Sends inside this challenge (max 3). */
  sends: number;
  /** ms epoch: the first send, which starts the 15-minute window. */
  firstSentAt: number;
}

export function challengeFrom(phoneE164: string, c: OtpChallenge, previous: Challenge | null, now = Date.now()): Challenge {
  const same = previous !== null && previous.challengeId === c.challenge_id;
  // Inside the 60 s cooldown the server answers with the same challenge and sends nothing (Back,
  // then "Send code" again straight away): that is not a send, so it must not count towards the
  // three. Only a request made once the cooldown was over is a real (re-)send.
  const resent = same && now >= previous.resendAt - 1000;
  const expires = Date.parse(c.expires_at);
  return {
    phoneE164,
    challengeId: c.challenge_id,
    resendAt: now + Math.max(0, c.resend_after_s) * 1000,
    // A device clock can be wrong; never trust an expiry that is already behind us on arrival.
    expiresAt: Number.isFinite(expires) && expires > now ? expires : same ? previous.expiresAt : now + 5 * 60_000,
    sends: same ? previous.sends + (resent ? 1 : 0) : 1,
    firstSentAt: same ? previous.firstSentAt : now,
  };
}

type Problem =
  | { kind: 'incorrect'; remaining: number | null }
  | { kind: 'tries-used' }
  | { kind: 'expired' }
  | { kind: 'locked'; until: number }
  | { kind: 'other'; title: string; message: string };

export interface CodeStepProps {
  challenge: Challenge;
  online: boolean;
  support: Support;
  onChallenge: (c: Challenge) => void;
  onBack: () => void;
  onDifferentNumber: () => void;
  onClosed: () => void;
}

export function CodeStep({ challenge, online, support, onChallenge, onBack, onDifferentNumber, onClosed }: CodeStepProps): React.ReactElement {
  const theme = useTheme();
  const [code, setCode] = React.useState('');
  const [pasted, setPasted] = React.useState(false);
  const [busy, setBusy] = React.useState<'verifying' | 'resending' | null>(null);
  const [problem, setProblem] = React.useState<Problem | null>(null);
  // A 429 on resend (ms epoch until it lifts). Kept apart from `problem` so the state it lands on
  // (tries used, expired) is still there when it lifts.
  const [limitedUntil, setLimitedUntil] = React.useState(0);
  const now = useNow(true);

  // Android Back goes to the phone step, like the AppBar's back.
  // While the code is being checked Back does nothing, like "Use a different number" (SO
  // SignIn-Code-Verifying): leaving mid-check would sign the rider in behind the phone step.
  const backRef = React.useRef(onBack);
  backRef.current = onBack;
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!inFlight.current) backRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const sendsUsed = challenge.sends >= MAX_SENDS;
  const locked = problem?.kind === 'locked' && problem.until > now;
  const triesUsed = problem?.kind === 'tries-used';
  const expired = problem?.kind === 'expired' || (!triesUsed && !locked && busy !== 'verifying' && now >= challenge.expiresAt);
  const needsNewCode = expired || triesUsed;
  const fieldDisabled = triesUsed || locked;
  // The resend limit lasts until its window ends, then lifts on its own: a 429 on resend carries
  // the server's wait; three sends inside the challenge wait out the 15-minute window. While it
  // holds, "Send a new code" is not offered either: the server would only answer 429 again.
  const limitUntil = Math.max(limitedUntil, sendsUsed ? challenge.firstSentAt + CHALLENGE_WINDOW_MS : 0);
  const resendLimit: { until: number } | null = !locked && limitUntil > now ? { until: limitUntil } : null;
  const offerNewCode = needsNewCode && !resendLimit;
  const resendOpen = !needsNewCode && !locked && !resendLimit && now >= challenge.resendAt;
  const resendWait = !needsNewCode && !locked && !resendLimit && now < challenge.resendAt;

  // One check at a time: the 6th digit and a tap on Verify can land in the same frame, before
  // `busy` has re-rendered.
  const inFlight = React.useRef(false);
  const verify = React.useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy || inFlight.current) return;
      inFlight.current = true;
      setBusy('verifying');
      AccessibilityInfo.announceForAccessibility(CODE.checking);
      const outcome = await verifyCode(challenge.challengeId, value);
      inFlight.current = false;
      if (outcome.ok) return; // the session gate takes over from here
      setBusy(null);
      setPasted(false);
      switch (outcome.kind) {
        case 'incorrect':
          setCode('');
          if (outcome.attemptsRemaining === 0) setProblem({ kind: 'tries-used' });
          else setProblem({ kind: 'incorrect', remaining: outcome.attemptsRemaining });
          break;
        case 'expired':
          setCode('');
          setProblem({ kind: 'expired' });
          break;
        case 'locked':
          setCode('');
          setProblem({ kind: 'locked', until: Date.now() + (outcome.retryAfterS ?? 15 * 60) * 1000 });
          break;
        case 'closed':
          onClosed();
          break;
        case 'offline':
          break; // the code stays; Verify comes back when the connection does
        case 'unavailable':
          setProblem({ kind: 'other', title: GENERIC.title, message: GENERIC.message });
          break;
        default:
          setProblem({ kind: 'other', title: outcome.error.title, message: outcome.error.message });
      }
    },
    [busy, challenge.challengeId, onClosed],
  );

  const resend = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('resending');
    const outcome = await requestCode(challenge.phoneE164);
    inFlight.current = false;
    setBusy(null);
    if (outcome.ok) {
      const next = challengeFrom(challenge.phoneE164, outcome.challenge, challenge);
      setProblem(null);
      setCode('');
      onChallenge(next);
      AccessibilityInfo.announceForAccessibility(CODE.sentTo(challenge.phoneE164.slice(-4)));
      return;
    }
    if (outcome.kind === 'too-many') {
      setLimitedUntil(Date.now() + (outcome.retryAfterS ?? CHALLENGE_WINDOW_MS / 1000) * 1000);
    } else if (outcome.kind === 'unavailable') {
      setProblem({ kind: 'other', title: PHONE.unavailableTitle, message: PHONE.unavailableBody });
    } else if (outcome.kind === 'other') {
      setProblem({ kind: 'other', title: outcome.error.title, message: outcome.error.message });
    }
  };

  const onChange = (next: string) => {
    if (busy || fieldDisabled) return;
    const wasShort = code.length <= 1;
    setCode(next);
    if (problem?.kind === 'incorrect' || problem?.kind === 'other') setProblem(null);
    if (next.length === 6) {
      setPasted(wasShort);
      if (online && !needsNewCode) void verify(next);
    } else {
      setPasted(false);
    }
  };

  const h1 = typeStyle(theme, 'heading.xl');
  const body = typeStyle(theme, 'body.lg');
  const verifying = busy === 'verifying';

  let errorText: string | undefined;
  if (problem?.kind === 'incorrect') errorText = problem.remaining == null ? CODE.incorrectNoCount : CODE.incorrect(problem.remaining);
  const helperText = pasted ? CODE.pasted : problem ? undefined : CODE.helper;

  const clock = <Icon name="clock" color={theme.color.text.primary} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.color.surface.base }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ds-request(native): AppBar tone=field, back target 56 — SO SignIn-Code */}
      <AppBar title={CODE.appBar} isPageHeading={false} back={{ onPress: onBack, previousTitle: CODE.backTo }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space['5'], gap: space['5'] }} keyboardShouldPersistTaps="handled">
        {online ? null : (
          // ds-request(native): InlineAlert — SO SignIn-Code-Offline
          <Banner testID="code-offline" variant="neutral" title={PHONE.offlineTitle} description={PHONE.offlineBody} />
        )}
        <View style={{ gap: space['2'] }}>
          <Text accessibilityRole="header" style={{ ...h1, color: theme.color.text.primary }}>
            {CODE.title}
          </Text>
          <Text style={{ ...body, color: theme.color.text.primary }}>{CODE.sentTo(challenge.phoneE164.slice(-4))}</Text>
        </View>
        {/* ds-request(native): Input otp size field (56), autoFocus on open and after an error — SO SignIn-Code */}
        <Input
          testID="code"
          label={CODE.label}
          variant="otp"
          size="lg"
          autoComplete="one-time-code"
          value={code}
          onChange={onChange}
          disabled={fieldDisabled}
          errorText={errorText}
          helperText={helperText}
        />
        {resendOpen ? (
          <Button testID="resend" variant="tertiary" size="xl" fullWidth loading={busy === 'resending'} disabled={!online || verifying} onPress={() => void resend()}>
            {CODE.resend}
          </Button>
        ) : null}
        {resendWait && !verifying ? (
          <Text testID="resend-wait" style={{ ...body, color: theme.color.text.primary }}>
            {CODE.resendIn(Math.ceil((challenge.resendAt - now) / 1000))}
          </Text>
        ) : null}
        {resendLimit ? null : triesUsed ? (
          // ds-request(native): InlineAlert — SO SignIn-Code-TriesUsed
          <Banner testID="code-tries-used" variant="neutral" title={CODE.triesUsedTitle} description={CODE.triesUsedBody} />
        ) : expired ? (
          // ds-request(native): InlineAlert — SO SignIn-Code-Expired
          <Banner testID="code-expired" variant="neutral" icon={clock} title={CODE.expiredTitle} description={CODE.expiredBody} />
        ) : null}
        {locked && problem?.kind === 'locked' ? (
          // ds-request(native): InlineAlert — SO SignIn-Code-Locked
          <Banner testID="code-locked" variant="neutral" icon={clock} title={CODE.lockedTitle} description={CODE.lockedBody(minutesFromMs(problem.until - now))} />
        ) : null}
        {resendLimit ? (
          // ds-request(native): InlineAlert — SO SignIn-Code-ResendLimit
          <Banner
            testID="code-resend-limit"
            variant="neutral"
            icon={clock}
            title={CODE.resendLimitTitle}
            description={CODE.resendLimitBody(minutesFromMs(resendLimit.until - now))}
          />
        ) : null}
        {problem?.kind === 'other' ? <Banner testID="code-error" variant="warning" title={problem.title} description={problem.message} /> : null}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: space['5'],
          paddingTop: space['4'],
          paddingBottom: space['6'],
          gap: space['3'],
          borderTopWidth: 1,
          borderTopColor: theme.color.border.decorative,
          backgroundColor: theme.color.surface.base,
        }}
      >
        {offerNewCode ? (
          <Button testID="send-new" variant="primary" size="xl" fullWidth loading={busy === 'resending'} disabled={!online} onPress={() => void resend()}>
            {CODE.sendNew}
          </Button>
        ) : locked ? null : (
          <Button
            testID="verify"
            variant="primary"
            size="xl"
            fullWidth
            loading={verifying}
            disabled={!online || needsNewCode || code.length !== 6 || busy === 'resending'}
            onPress={() => void verify(code)}
          >
            {CODE.verify}
          </Button>
        )}
        <Button testID="different-number" variant="tertiary" size="xl" fullWidth disabled={verifying} onPress={onDifferentNumber}>
          {CODE.differentNumber}
        </Button>
        {support.phone ? (
          <View style={{ alignItems: 'center' }}>
            <Button testID="call-support" variant="ghost" size="xl" onPress={() => callSupport(support)}>
              {CALL_SUPPORT}
            </Button>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
