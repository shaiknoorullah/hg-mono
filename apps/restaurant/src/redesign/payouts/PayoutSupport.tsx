/**
 * Contact support from a payout (canvas `PY` `Support-Payout`). The numbers come from
 * `getPublicConfig` only; when a payout is open its reference is shown (and put in the email, if
 * the server has an address) so support can find it. Nothing about support is hard-coded.
 */
import { Button, DetailPanel, SupportBlock } from '../ds';
import { useConsole } from '../data/console';
import { supportFrom } from '../auth/api';

export function PayoutSupport({ onClose, payoutId, onBack }: { onClose: () => void; payoutId?: string; onBack?: () => void }) {
  const { config } = useConsole();
  const support = supportFrom(config);
  const email = config.data?.support_email ?? null;
  const subject = payoutId ? `Payout ${payoutId}` : 'Payouts';
  return (
    <DetailPanel
      title="Contact support"
      label="Contact support"
      closeLabel="Close contact support"
      onClose={onClose}
      width="task"
      testId="payout-support-panel"
      footer={
        <Button variant="tertiary" size="lg" fullWidth onPress={onBack ?? onClose}>
          {onBack ? 'Back to the payout' : 'Close'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-body-md">Call us and a person will help.{payoutId ? ' Read them the payout reference below.' : ''}</p>
        <SupportBlock contact={support} label="Partner support" unavailableTitle="Support’s phone number isn’t available right now" unavailableBody="Try again in a few minutes." />
        {email ? (
          <a className="hg-focus text-body-md font-semibold underline" href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>
            Email {email}
          </a>
        ) : null}
        {payoutId ? (
          <dl className="m-0 flex flex-col gap-1">
            <dt className="text-body-sm text-fg-secondary">Payout reference</dt>
            <dd className="m-0 break-all font-mono text-body-md" data-testid="support-reference">
              {payoutId}
            </dd>
          </dl>
        ) : null}
      </div>
    </DetailPanel>
  );
}
