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
 * only in part: the invitation has no lookup (so no work email, role or inviter to show) and
 * no invite-scoped two-step enrolment; both are #170. Until then the token sets the first
 * password through `resetPassword` (#350), which answers one generic error for an expired,
 * used or unknown link. The two states that follow from that, "this link doesn't work any
 * more" and "password set, two-step sign-in still to come", have no board yet. Setting the
 * password signs nobody in; the person goes to the normal sign-in gate.
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
        eyebrow="Step 1 of 2"
        title="Set up your HalalGoes admin account"
        intro="Choose a password, then set up two-step sign-in. You need both before you can use the console."
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
        <AuthHeading eyebrow="Step 1 of 2 done" title="Your password is set">
          One step is left: two-step sign-in. You need it before you can use the console, and it can't be set up
          from this page yet. The super admin who invited you will set it up with you, then you sign in with your
          work email, your password and a code from your authenticator app.
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
