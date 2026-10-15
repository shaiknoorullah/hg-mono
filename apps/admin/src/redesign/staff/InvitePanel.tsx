/**
 * Invite a staff member (`Invite*` boards): `createStaffUser`, which the server allows for a
 * super admin only. The panel is never reachable for anyone else, and a 403 from the server
 * (the role changed while the page was open) ends in "You can't invite staff any more".
 *
 * Sending uses one Idempotency-Key per set of details, so pressing twice or retrying after a
 * timeout is the same request. The server does not yet replay a repeated key (it answers 409
 * because the first invite exists), so after an unknown outcome a 409 is checked against the list:
 * if the address now belongs to an Invited account that is the invite we sent, and it is said so.
 *
 * Not built: "Reactivate and send invite". The server refuses an email that belongs to a
 * deactivated account (409), and the response cannot say it reactivated anything.
 */
import { useEffect, useRef, useState } from 'react';

import { api } from '../data/api';
import { useMutation } from '../data/mutation';
import { clearDraft, loadDraft, saveDraft } from '../data/drafts';
import { getSession, startSession } from '../data/session';
import { useOnline } from '../auth/online';
import { Button, DetailPanel, InlineAlert, Input, RadioGroup } from '../ds';
import { getToken } from '../../lib/token';
import { unwrap } from '../../lib/load';
import { INVITE } from './copy';
import { ROLE_LABEL, sameEmail, STATUS_LABEL, validateInvite, type InviteDraft, type InviteErrors, type InviteRole, type StaffUser } from './model';

const DRAFT_KEY = 'staff-invite';
const ROLES: InviteRole[] = ['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'];

interface Props {
  rows: readonly StaffUser[];
  initialRole?: 'SUPER_ADMIN';
  onlyActiveSuper: boolean;
  onClose: () => void;
  onSent: (row: StaffUser) => void;
  onOpenAccount: (id: string) => void;
  reloadList: () => Promise<void>;
}

type Failure = 'duplicate' | 'rejected' | 'limited' | 'unknown' | 'forbidden' | null;

export function InvitePanel({ rows, initialRole, onlyActiveSuper, onClose, onSent, onOpenAccount, reloadList }: Props) {
  const online = useOnline();
  const [draft, setDraft] = useState<InviteDraft>(() => {
    const saved = loadDraft<InviteDraft>(DRAFT_KEY);
    return { full_name: saved?.full_name ?? '', email: saved?.email ?? '', role: initialRole ?? saved?.role ?? '' };
  });
  const [errors, setErrors] = useState<InviteErrors>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [wentOffline, setWentOffline] = useState(false);
  const [serverFields, setServerFields] = useState<InviteErrors>({});
  const unknownBefore = useRef(false);

  const send = useMutation(async (body: { email: string; full_name: string; role: InviteRole }, key: string) => {
    const result = await unwrap(api.POST('/v1/admin/staff', { params: { header: { 'Idempotency-Key': key } }, body }));
    return result.data;
  });

  useEffect(() => {
    saveDraft(DRAFT_KEY, draft);
  }, [draft]);

  function change(patch: Partial<InviteDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors({});
    setServerFields({});
    setFailure(null);
    unknownBefore.current = false;
    // What is being sent changed, so it is a different request: a new key.
    send.reset();
  }

  async function submit() {
    const found = validateInvite(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setFailure(null);
    const body = { email: draft.email.trim(), full_name: draft.full_name.trim(), role: draft.role as InviteRole };
    const outcome = await send.send(body);
    if (outcome.kind === 'done') {
      clearDraft(DRAFT_KEY);
      onSent(outcome.data as StaffUser);
      return;
    }
    if (outcome.kind === 'refused') {
      const status = outcome.error.status;
      if (status === 409 && unknownBefore.current) {
        // The earlier attempt may have gone through: look for the account it would have made.
        await reloadList();
        const made = await findInvited(body.email);
        if (made) {
          clearDraft(DRAFT_KEY);
          onSent(made);
          return;
        }
      }
      if (status === 409) setFailure('duplicate');
      else if (status === 403) setFailure('forbidden');
      else if (status === 429) setFailure('limited');
      else {
        setFailure('rejected');
        const fields: InviteErrors = {};
        for (const d of outcome.error.details ?? []) {
          if (d.field === 'email' || d.field === 'full_name' || d.field === 'role') fields[d.field] = d.message;
        }
        setServerFields(fields);
      }
      return;
    }
    unknownBefore.current = true;
    setWentOffline(!navigator.onLine);
    setFailure('unknown');
  }

  async function findInvited(email: string): Promise<StaffUser | null> {
    try {
      const page = await unwrap(api.GET('/v1/admin/staff', { params: { query: { limit: 25 } } }));
      return page.data.find((r) => sameEmail(r.email, email) && r.status === 'INVITED') ?? null;
    } catch {
      return null;
    }
  }

  async function onContinue() {
    // The role may have changed under the page: read it again, then leave the panel.
    try {
      const me = await unwrap(api.GET('/v1/auth/me'));
      const token = getToken();
      if (token && getSession().principal) startSession(token, me.data);
    } catch {
      /* the session store keeps what it had; the panel closes either way */
    }
    clearDraft(DRAFT_KEY);
    onClose();
  }

  const existing = failure === 'duplicate' ? (rows.find((r) => sameEmail(r.email, draft.email)) ?? null) : null;
  const fieldError = (k: keyof InviteErrors) => errors[k] ?? serverFields[k] ?? null;
  const sending = send.sending;
  const blocked = !online || sending;

  if (failure === 'forbidden') {
    return (
      <DetailPanel title={INVITE.title} onClose={onClose}>
        <InlineAlert
          tone="warning"
          blocking
          title={INVITE.forbidden.title}
          action={
            <Button variant="primary" onPress={() => void onContinue()}>
              {INVITE.forbidden.cont}
            </Button>
          }
        >
          {INVITE.forbidden.body}
        </InlineAlert>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel
      title={INVITE.title}
      onClose={onClose}
      busy={sending}
      footer={
        <>
          {!online ? <span className="me-auto text-body-sm text-fg-secondary">{INVITE.offlineHelp}</span> : null}
          <Button variant="tertiary" disabled={sending} onPress={() => { clearDraft(DRAFT_KEY); onClose(); }}>
            {INVITE.cancel}
          </Button>
          <Button variant="primary" loading={sending} disabled={blocked} onPress={() => void submit()}>
            {failure === 'unknown' ? INVITE.sendAgain : INVITE.send}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) void submit();
        }}
      >
        <p className="m-0 text-body-md text-fg-secondary">{INVITE.intro}</p>

        {Object.keys(errors).length > 0 ? (
          <InlineAlert tone="warning" blocking title={INVITE.rejected.title}>
            {INVITE.fixForm}
          </InlineAlert>
        ) : null}
        {sending ? (
          <p role="status" className="m-0 text-body-sm text-fg-secondary">
            {INVITE.sending}
          </p>
        ) : null}
        {failure === 'duplicate' ? (
          <InlineAlert
            tone="warning"
            blocking
            title={INVITE.duplicate.title}
            action={
              existing ? (
                <Button variant="tertiary" onPress={() => onOpenAccount(existing.id)}>
                  {INVITE.duplicate.open(existing.full_name)}
                </Button>
              ) : undefined
            }
          >
            {existing
              ? INVITE.duplicate.known(existing.full_name, ROLE_LABEL[existing.role as keyof typeof ROLE_LABEL] ?? existing.role, STATUS_LABEL[existing.status])
              : INVITE.duplicate.unknown}
            {existing ? null : <> {INVITE.duplicate.unloaded}</>}
          </InlineAlert>
        ) : null}
        {failure === 'rejected' ? (
          <InlineAlert tone="warning" blocking title={INVITE.rejected.title}>
            {INVITE.rejected.body}
          </InlineAlert>
        ) : null}
        {failure === 'limited' ? (
          <InlineAlert tone="warning" blocking title={INVITE.limited.title}>
            {INVITE.limited.body}
          </InlineAlert>
        ) : null}
        {failure === 'unknown' ? (
          <InlineAlert tone="warning" blocking title={INVITE.unknown.title}>
            {wentOffline || !online ? INVITE.unknown.offline : INVITE.unknown.body}
          </InlineAlert>
        ) : null}

        <Input label={INVITE.name} value={draft.full_name} onValueChange={(v) => change({ full_name: v })} errorText={fieldError('full_name')} required autoFocus autoComplete="off" disabled={sending} />
        <Input
          label={INVITE.email}
          variant="email"
          value={draft.email}
          onValueChange={(v) => change({ email: v })}
          errorText={fieldError('email')}
          helperText={onlyActiveSuper ? INVITE.secondSuper : undefined}
          required
          autoComplete="off"
          disabled={sending}
        />
        <RadioGroup
          label={INVITE.role}
          value={draft.role === '' ? null : draft.role}
          onValueChange={(v) => change({ role: v as InviteRole })}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          error={fieldError('role')}
          disabled={sending}
          required
        />
        <p className="m-0 text-body-sm text-fg-secondary">{INVITE.roleHelp}</p>
      </form>
    </DetailPanel>
  );
}

