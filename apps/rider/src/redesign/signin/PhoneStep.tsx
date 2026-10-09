/**
 * R01 Sign in or apply — phone. Boards: SO `Main`, `Main-Keyboard`, `Main-LargeText`,
 * `SignIn-Phone-Sending`, `-Invalid`, `-TooMany`, `-Unavailable`, `-Offline`, `-SignedOut`,
 * `SignIn-Phone-Light`, `SignIn-Phone-TooMany-Light`.
 *
 * One screen for new and returning riders. "Send code" keeps its label while loading; progress is
 * announced, not drawn. "Call support" is the last footer item (WCAG 3.2.6) and is hidden when
 * support is off.
 */
import * as React from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Banner, Button, Icon, Input, Wordmark, space, typeStyle, useTheme } from '../ds';
import { callSupport, type Support } from '../data/config';
import { useNow } from './clock';
import { CALL_SUPPORT, PHONE, minutesFromMs } from './copy';
import { requestCode, type OtpChallenge, type RequestOutcome } from './otp';

type Alert =
  | { kind: 'invalid' }
  | { kind: 'too-many'; until: number }
  | { kind: 'unavailable' }
  | { kind: 'other'; title: string; message: string };

/** No `Retry-After`: the contract's challenge window (15 minutes) is the longest a wait can be. */
const DEFAULT_WAIT_S = 15 * 60;

export interface PhoneStepProps {
  digits: string;
  onDigits: (digits: string) => void;
  signedOut: boolean;
  online: boolean;
  support: Support;
  onSent: (phoneE164: string, challenge: OtpChallenge) => void;
}

export function PhoneStep({ digits, onDigits, signedOut, online, support, onSent }: PhoneStepProps): React.ReactElement {
  const theme = useTheme();
  const [sending, setSending] = React.useState(false);
  const [alert, setAlert] = React.useState<Alert | null>(null);
  const now = useNow(alert?.kind === 'too-many');

  const waitingUntil = alert?.kind === 'too-many' ? alert.until : 0;
  const waiting = waitingUntil > now;
  React.useEffect(() => {
    if (alert?.kind === 'too-many' && !waiting) setAlert(null);
  }, [alert, waiting]);

  const send = async () => {
    if (digits.length !== 10) {
      setAlert({ kind: 'invalid' });
      return;
    }
    setAlert(null);
    setSending(true);
    AccessibilityInfo.announceForAccessibility(PHONE.sending);
    const phoneE164 = `+1${digits}`;
    const outcome: RequestOutcome = await requestCode(phoneE164);
    setSending(false);
    if (outcome.ok) {
      onSent(phoneE164, outcome.challenge);
      return;
    }
    switch (outcome.kind) {
      case 'invalid':
        setAlert({ kind: 'invalid' });
        break;
      case 'too-many':
        setAlert({ kind: 'too-many', until: Date.now() + (outcome.retryAfterS ?? DEFAULT_WAIT_S) * 1000 });
        break;
      case 'unavailable':
        setAlert({ kind: 'unavailable' });
        break;
      case 'offline':
        break; // the offline alert follows `online`
      default:
        setAlert({ kind: 'other', title: outcome.error.title, message: outcome.error.message });
    }
  };

  const h1 = typeStyle(theme, 'heading.xl');
  const lead = typeStyle(theme, 'body.lg');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.color.surface.base }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space['5'], gap: space['5'] }}
        keyboardShouldPersistTaps="handled"
      >
        {online ? null : (
          // ds-request(native): InlineAlert — SO SignIn-Phone-Offline (Banner stands in)
          <Banner testID="signin-offline" variant="neutral" title={PHONE.offlineTitle} description={PHONE.offlineBody} />
        )}
        <View style={{ gap: space['6'] }}>
          <Wordmark height={44} />
          <View style={{ gap: space['2'] }}>
            <Text accessibilityRole="header" style={{ ...h1, color: theme.color.text.primary }}>
              {PHONE.title}
            </Text>
            <Text style={{ ...lead, color: theme.color.text.primary }}>{PHONE.lead}</Text>
          </View>
        </View>
        {/* ds-request(native): Input size field (56) — SO Main (lg is 52 today) */}
        <Input
          testID="phone"
          label={PHONE.label}
          variant="tel"
          size="lg"
          required
          autoComplete="tel-national"
          value={digits}
          onChange={(next) => {
            onDigits(next.slice(0, 10));
            if (alert?.kind === 'invalid') setAlert(null);
          }}
          readOnly={sending}
          helperText={PHONE.helper}
          errorText={alert?.kind === 'invalid' ? PHONE.invalid : undefined}
        />
        {signedOut && online ? (
          // ds-request(native): InlineAlert — SO SignIn-Phone-SignedOut
          <Banner testID="signin-signed-out" variant="neutral" title={PHONE.signedOutTitle} description={PHONE.signedOutBody} />
        ) : null}
        {alert?.kind === 'too-many' && waiting ? (
          // ds-request(native): InlineAlert — SO SignIn-Phone-TooMany
          <Banner
            testID="signin-too-many"
            variant="neutral"
            icon={<Icon name="clock" color={theme.color.text.primary} />}
            title={PHONE.tooManyTitle}
            description={PHONE.tooManyBody(minutesFromMs(waitingUntil - now))}
          />
        ) : null}
        {alert?.kind === 'unavailable' ? (
          // ds-request(native): InlineAlert — SO SignIn-Phone-Unavailable
          <Banner testID="signin-unavailable" variant="warning" title={PHONE.unavailableTitle} description={PHONE.unavailableBody} />
        ) : null}
        {alert?.kind === 'other' ? <Banner testID="signin-error" variant="warning" title={alert.title} description={alert.message} /> : null}
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
        <Button
          testID="send-code"
          variant="primary"
          size="xl"
          fullWidth
          loading={sending}
          disabled={!online || waiting}
          onPress={() => void send()}
        >
          {alert?.kind === 'unavailable' ? PHONE.tryAgain : PHONE.send}
        </Button>
        {support.phone ? (
          <Button testID="call-support" variant="ghost" size="xl" onPress={() => callSupport(support)}>
            {CALL_SUPPORT}
          </Button>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
