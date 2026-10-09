/**
 * The `signIn` route: phone (R01) → code (R02), and the closed-account answer from verify
 * (SO `SignIn-Deactivated`). `SessionGate` renders it with no navigator underneath, so the two
 * steps are local state; a successful verify flips the token and the gate moves on to the splash.
 *
 * `getPublicConfig` is read here once for both steps (support). While the phone is offline it is
 * re-read every few seconds: its answer is how the app learns the connection is back, so "Send
 * code" and "Verify" come back on their own.
 */
import * as React from 'react';

import { fetchPublicConfig, supportFrom } from '../data/config';
import { useOnline } from '../data/connectivity';
import { useApiQuery } from '../data/query';
import type { ScreenProps } from '../nav/registry';
import { CodeStep, challengeFrom, type Challenge } from './CodeStep';
import { PhoneStep } from './PhoneStep';
import { TerminalScreen } from './TerminalScreen';

export const OFFLINE_PROBE_MS = 5_000;

type Step = { name: 'phone' } | { name: 'code'; challenge: Challenge } | { name: 'closed' };

export function SignInScreen({ params }: ScreenProps<'signIn'>): React.ReactElement {
  const online = useOnline();
  const config = useApiQuery('public-config', fetchPublicConfig, { pollMs: online ? null : OFFLINE_PROBE_MS });
  const support = supportFrom(config.data);
  const [digits, setDigits] = React.useState('');
  const [step, setStep] = React.useState<Step>({ name: 'phone' });
  // The "signed out" note belongs to the first visit only; a rider who has moved on has read it.
  const [signedOut, setSignedOut] = React.useState(params?.reason === 'signed-out');
  // Back to the phone and "Send code" again inside the window re-sends the same challenge: keep
  // counting its sends rather than starting from 1.
  const last = React.useRef<Challenge | null>(null);
  const show = (challenge: Challenge) => {
    last.current = challenge;
    setStep({ name: 'code', challenge });
  };

  if (step.name === 'closed') {
    return (
      <TerminalScreen
        params={{ kind: 'closed' }}
        onBackToSignIn={() => {
          setDigits('');
          setStep({ name: 'phone' });
        }}
      />
    );
  }
  if (step.name === 'code') {
    return (
      <CodeStep
        key={step.challenge.firstSentAt}
        challenge={step.challenge}
        online={online}
        support={support}
        onChallenge={show}
        onBack={() => setStep({ name: 'phone' })}
        onDifferentNumber={() => {
          setDigits('');
          setStep({ name: 'phone' });
        }}
        onClosed={() => setStep({ name: 'closed' })}
      />
    );
  }
  return (
    <PhoneStep
      digits={digits}
      onDigits={setDigits}
      signedOut={signedOut}
      online={online}
      support={support}
      onSent={(phoneE164, challenge) => {
        setSignedOut(false);
        const previous = last.current?.phoneE164 === phoneE164 ? last.current : null;
        show(challengeFrom(phoneE164, challenge, previous));
      }}
    />
  );
}
