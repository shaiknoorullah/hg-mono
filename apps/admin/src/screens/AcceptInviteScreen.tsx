import { useState } from 'react';
import { Button, Icon } from '@hg/ui-web';
import { isWellFormedToken, useLinkToken } from '@hg/ui-web/email-links';

import { logout } from '../lib/auth';
import { isAuthed } from '../lib/token';
import { AuthCard, AuthHeading, SignedInPrompt } from '../components/AuthFrame';
import { SetPasswordForm } from './ResetPasswordScreen';

/**
 * `/accept-invite?token=…`, the link in the staff invitation email (issue #329).
 *
 * Board: "Invitee sets up their account" in the Staff canvas
 * (https://claude.ai/artifact/Y7wjQPGX2UAtS238ZDVhU1). Only step 1 is buildable today, and
 * only in part: the invitation has no lookup (so no work email, role or inviter to show; #170).
 * The token sets the first password through `resetPassword` (#350), which answers one generic
 * error for an expired, used or unknown link. Two-step sign-in is opt-in for staff (#623): it
 * is never set up from the invitation, so setting the password is the whole of accepting.
 * Setting the password signs nobody in; the person goes to the normal sign-in gate.
 */
type Step = 'signed-in' | 'set' | 'invalid' | 'rejected' | 'done';

export function AcceptInviteScreen() {
  const token = useLinkToken('/accept-invite');
  const [step, setStep] = useState<Step>(() =>
    !isWellFormedToken(token) ? 'invalid' : isAuthed() ? 'signed-in' : 'set',
  );

  if (step === 'signed-in') {
    return (
      <SignedInPrompt
        onSignOut={() => {
          logout();
          setStep('set');
        }}
      />
    );
  }

  if (step === 'set' && isWellFormedToken(token)) {
    return (
      <SetPasswordForm
        token={token}
        title="Set up your HalalGoes admin account"
        intro="Choose a password. You then sign in with your work email and this password."
        submitLabel="Continue"
        onInvalid={() => setStep('rejected')}
        onDone={() => setStep('done')}
      />
    );
  }

  if (step === 'rejected') {
    return (
      <AuthCard>
        <Icon name="clock" size={32} className="text-fg-secondary" />
        <AuthHeading title="This invite link doesn't work any more">
          Invite links work for 72 hours and only once. If you already chose your password with this link, you don't
          need it again. Otherwise, ask the super admin who invited you for a new invite. Nothing was changed.
        </AuthHeading>
      </AuthCard>
    );
  }

  if (step === 'done') {
    return (
      <AuthCard>
        <Icon name="check" size={32} className="text-fg-secondary" />
        <AuthHeading title="Your password is set">
          Sign in with your work email and your password. Two-step sign-in is optional, but approving refunds and
          running payouts need it.
        </AuthHeading>
        <Button size="lg" fullWidth href="/">
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  // No token, or one cut short: Accept — link not recognised.
  return (
    <AuthCard>
      <AuthHeading title="This invite link doesn't work">
        It may be incomplete or mistyped. Open it again from the invite email. If it still doesn't work, ask the super
        admin who invited you for a new one.
      </AuthHeading>
    </AuthCard>
  );
}
