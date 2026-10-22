/**
 * Live alerts' own "sign in again" dialog (`ORD/LiveAlertsSessionEnded`): the server sent
 * `reauth_required`, or closed the socket `4401` (`contracts/websocket.md`, sections 1.3 and 1.5).
 *
 * That means the SESSION is over, not the connection. Retrying would mint a ticket for the same dead
 * session and be refused the same way, so there is no "try again" here: the person signs in, and only
 * then is the connection restarted (`reconnectNow`), which mints a fresh ticket. The alerts already on
 * the page are kept underneath.
 *
 * It sits beneath the console's session-ended dialog: when a call has already marked the session ended,
 * that dialog is the one shown, and this one waits behind it.
 */
import { useNavigate } from 'react-router-dom';
import { useRealtimeControls } from '@hg/ui-web/live';

import { SignInAgainForm } from '../app/SessionEndedDialog';
import { landingPath } from '../app/nav';
import { finishSignOut } from '../app/signOut';
import { formatTime } from '../data/format';
import { clearAllDrafts } from '../data/drafts';
import { getSession, staffRoleOf } from '../data/session';
import { Button, Modal } from '../ds';
import { resetQueueDepth } from '../realtime/queueDepth';
import { ALERTS } from './copy';
import { resetAlerts, setAlertsFailure } from './store';

export function ReauthDialog({ at }: { at: Date }) {
  const controls = useRealtimeControls();
  const navigate = useNavigate();
  const copy = ALERTS.failure.reauth;
  return (
    <Modal
      open
      variant="dialog"
      dismissible={false}
      size="md"
      title={copy.title}
      description={copy.body(formatTime(at))}
      testId="LiveAlertsReauth"
    >
      <SignInAgainForm
        submitLabel={copy.submit}
        codeNote={copy.lostAuthenticator}
        secondary={
          <Button
            variant="tertiary"
            onPress={() => {
              navigate('/', { replace: true });
              finishSignOut();
            }}
          >
            {copy.signOut}
          </Button>
        }
        onSignedIn={(sameAccount) => {
          if (!sameAccount) {
            // Someone else: nothing of the previous person's stays in this tab.
            resetQueueDepth();
            resetAlerts();
            clearAllDrafts();
            navigate(landingPath(staffRoleOf(getSession().principal)), { replace: true });
          }
          // The sign-in worked: ask for a fresh ticket. If that fails, the ticket screen says so.
          setAlertsFailure(null);
          controls.reconnectNow();
        }}
      />
    </Modal>
  );
}
