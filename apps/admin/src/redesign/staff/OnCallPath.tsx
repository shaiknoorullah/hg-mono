/**
 * "Call the platform on-call engineer": the written path for the account changes the console
 * cannot make (`StaffDetailRemoveAccess`, `StaffDetailResetMfa`, `StaffDetailCancelInvite`, and the
 * call line under a suspended or unrecognised-role account).
 *
 * Nothing here sends a request. When the API gains these operations the panel becomes a confirmed
 * action; until then pressing a button that did nothing would be worse than the instructions.
 */
import { Button, DetailPanel, InlineAlert } from '../ds';
import { ONCALL } from './copy';
import { inviteExpired, isKnownRole, ROLE_LABEL, type StaffUser } from './model';
import { onCallContact, RUNBOOK_URL, telHref } from './onCall';

export type OnCallKind = 'remove' | 'reset' | 'cancel' | 'contact';

interface Props {
  kind: OnCallKind;
  row: StaffUser;
  /** Inline call line only (no panel, no steps). */
  embedded?: boolean;
  onBack?: () => void;
  onClose?: () => void;
}

function CallLine({ id }: { id?: string }) {
  const contact = onCallContact();
  return (
    <div className="flex flex-col gap-2">
      {contact ? (
        <div>
          <Button variant="tertiary" href={telHref(contact.phone)} accessibilityLabel={`${ONCALL.callButton(contact.name, contact.phone)}, platform on-call engineer`}>
            {ONCALL.callButton(contact.name, contact.phone)}
          </Button>
        </div>
      ) : (
        <InlineAlert tone="warning" title={ONCALL.noContact.title}>
          {ONCALL.noContact.body}
        </InlineAlert>
      )}
      <div>
        <Button variant="ghost" href={RUNBOOK_URL}>
          {ONCALL.runbook}
        </Button>
      </div>
      {id ? <span className="sr-only">{id}</span> : null}
    </div>
  );
}

export function OnCallPath({ kind, row, embedded = false, onBack, onClose }: Props) {
  if (embedded) return <CallLine />;

  const name = row.full_name;
  const role = isKnownRole(row.role) ? ROLE_LABEL[row.role] : row.role;
  const title = kind === 'remove' ? ONCALL.remove.title(name) : kind === 'reset' ? ONCALL.reset.title(name) : ONCALL.cancel.title(name);
  const expired = inviteExpired(row);

  const idStep = (
    <p className="m-0 mt-2 flex flex-wrap items-center gap-2">
      <span className="break-all font-mono text-body-md text-fg-primary">{row.id}</span>
    </p>
  );

  return (
    <DetailPanel
      key={`${kind}-${row.id}`}
      title={title}
      onClose={onClose}
      footer={
        <Button variant="tertiary" onPress={onBack}>
          {ONCALL.back}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === 'remove' ? (
          <InlineAlert tone="warning" title={ONCALL.remove.urgent}>
            {ONCALL.remove.until(name, role)}
          </InlineAlert>
        ) : null}
        {kind === 'cancel' ? (
          expired ? (
            <InlineAlert tone="neutral" title="The link has already expired">
              {ONCALL.cancel.expiredWarn}
            </InlineAlert>
          ) : (
            <InlineAlert tone="warning" title={ONCALL.cancel.urgent}>
              {ONCALL.cancel.until(name)}
            </InlineAlert>
          )
        ) : null}

        <p className="m-0 text-body-md text-fg-secondary">{kind === 'remove' ? ONCALL.remove.why : kind === 'reset' ? ONCALL.reset.intro : ONCALL.cancel.why}</p>

        <ol className="m-0 flex list-decimal flex-col gap-4 ps-5 text-body-md text-fg-primary">
          {kind === 'reset' ? (
            <li>
              <span className="font-semibold">{ONCALL.reset.confirm(name)}</span>
              <p className="m-0 text-fg-secondary">{ONCALL.reset.confirmBody(name)}</p>
            </li>
          ) : null}
          <li>
            <span className="font-semibold">{ONCALL.call}</span>
            <CallLine />
          </li>
          <li>
            <span className="font-semibold">{ONCALL.giveId}</span>
            {idStep}
          </li>
          {kind === 'reset' ? (
            <li>
              <span className="font-semibold">{ONCALL.reset.tell}</span>
              <p className="m-0 text-fg-secondary">{ONCALL.reset.tellBody}</p>
            </li>
          ) : (
            <li>
              <span className="font-semibold">{kind === 'remove' ? ONCALL.remove.ask : ONCALL.cancel.ask}</span>
              <p className="m-0 text-fg-secondary">{kind === 'remove' ? ONCALL.remove.askNote : ONCALL.cancel.askNote(name)}</p>
            </li>
          )}
          <li>
            <span className="font-semibold">{ONCALL.stay}</span>
            <p className="m-0 text-fg-secondary">{kind === 'remove' ? ONCALL.remove.after(name) : kind === 'reset' ? ONCALL.reset.after : ONCALL.cancel.after(name)}</p>
          </li>
        </ol>
      </div>
    </DetailPanel>
  );
}
