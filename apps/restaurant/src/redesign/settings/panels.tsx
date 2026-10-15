/**
 * The panels that open beside a settings section (settings board `PartEditPanel`, `Security-*`,
 * `Support-*`, `Renew-*`): edit owner name, phone numbers and kitchen time; change password;
 * contact support; upload a renewed halal certificate.
 *
 * Only the fields that save at once are editable here. The name customers see, the legal name,
 * the address, the description and the GST/HST number change only after review, and the
 * contract has no operation for a reviewed change: those rows say "Request a change", which
 * opens the support panel. They are never sent over `submitRestaurantProfile`.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button, DetailPanel, Input, InlineConfirm, SupportBlock, useToast } from '../ds';
import { client, createClientWithoutReplay, keepSession } from '../data/client';
import { call } from '../data/call';
import { attempt } from '../auth/api';
import { getSession } from '../../lib/api';
import { useConsole } from '../data/console';
import { OnboardingProvider } from '../onboarding/context';
import { RenewPanel } from '../onboarding/RenewPanel';
import { displayPhone } from '../onboarding/profile';
import { supportFrom } from '../auth/api';
import {
  passwordFailure,
  profileBody,
  validateImmediate,
  type EditGroup,
  type ImmediatePatch,
  type RestaurantProfile,
} from './model';

export const EDIT_TITLE: Record<EditGroup, string> = {
  names: 'Edit owner name',
  contact: 'Edit phone numbers',
  kitchen: 'Edit kitchen',
};

const SAVED: Record<EditGroup, { title: string; description: string }> = {
  names: { title: 'Owner name saved', description: 'HalalGoes uses it when we contact you. Customers don’t see it.' },
  contact: { title: 'Phone numbers saved', description: 'HalalGoes calls the business number about orders and your account.' },
  kitchen: { title: 'Preparation time saved', description: 'New orders use it from now on. Orders already accepted keep their time.' },
};

function opt(e: string | undefined): { errorText: string } | Record<string, never> {
  return e ? { errorText: e } : {};
}

interface PanelShellProps {
  title: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  footer?: ReactNode;
  busy?: boolean;
  closeDisabled?: boolean;
  testId: string;
  children: ReactNode;
}

function Shell({ title, label, closeLabel, onClose, footer, busy, closeDisabled, testId, children }: PanelShellProps) {
  return (
    <DetailPanel title={title} label={label} closeLabel={closeLabel} onClose={onClose} footer={footer} busy={busy} closeDisabled={closeDisabled} testId={testId} as="section" width="task">
      {children}
    </DetailPanel>
  );
}

// ── Edit: owner name, phones, kitchen ─────────────────────────────────────────────────────

export function EditPanel({ group, profile, onClose, onSaved }: { group: EditGroup; profile: RestaurantProfile; onClose: () => void; onSaved: (p: RestaurantProfile) => void }) {
  const toast = useToast();
  const initial: ImmediatePatch = {
    owner_first_name: profile.owner_first_name ?? '',
    owner_last_name: profile.owner_last_name ?? '',
    phone: displayPhone(profile.phone_e164),
    public_phone: displayPhone(profile.public_phone_e164),
    avg_prep_minutes: profile.avg_prep_minutes ? String(profile.avg_prep_minutes) : '',
  };
  const [v, setV] = useState<ImmediatePatch>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'failed' | 'rejected'>('idle');
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof ImmediatePatch, x: string) => setV((s) => ({ ...s, [k]: x }));

  const close = () => (dirty && state !== 'saving' ? setDiscard(true) : onClose());

  const save = async () => {
    const found = validateImmediate(group, v);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setState('saving');
    try {
      // Read again just before writing: the write replaces the whole profile, so it must start
      // from what the server holds now, not from what this screen loaded a while ago.
      const fresh: RestaurantProfile = await call(client.GET('/v1/restaurant/profile', {}));
      const patch: ImmediatePatch =
        group === 'names' ? { owner_first_name: v.owner_first_name ?? '', owner_last_name: v.owner_last_name ?? '' } : group === 'contact' ? { phone: v.phone ?? '', public_phone: v.public_phone ?? '' } : { avg_prep_minutes: v.avg_prep_minutes ?? '' };
      const saved: RestaurantProfile = await call(client.PUT('/v1/restaurant/profile', { body: profileBody(fresh, patch) }));
      toast.show({ variant: 'success', ...SAVED[group] });
      onSaved(saved);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setState(status !== undefined && status >= 400 && status < 500 ? 'rejected' : 'failed');
    }
  };

  const footer = discard ? undefined : (
    <div className="flex justify-end gap-2">
      <Button variant="tertiary" size="lg" onPress={close}>
        Cancel
      </Button>
      <Button variant="primary" size="lg" loading={state === 'saving'} onPress={() => void save()}>
        Save
      </Button>
    </div>
  );

  return (
    <Shell title={EDIT_TITLE[group]} label={EDIT_TITLE[group]} closeLabel="Close without saving" onClose={close} footer={footer} busy={state === 'saving'} closeDisabled={state === 'saving'} testId="edit-panel">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {discard ? (
          <InlineConfirm
            icon="info"
            title="Discard your changes?"
            body="Nothing has been saved yet."
            cancel={{ label: 'Keep editing', onPress: () => setDiscard(false), variant: 'tertiary' }}
            actions={[{ label: 'Discard changes', onPress: onClose, variant: 'primary' }]}
            testId="edit-discard"
          />
        ) : null}
        {state === 'failed' ? (
          <p role="alert" className="m-0 rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2 text-body-md text-fg-primary" data-testid="edit-failed">
            Couldn’t save. Nothing was changed. Check your connection and try again.
          </p>
        ) : null}
        {state === 'rejected' ? (
          <p role="alert" className="m-0 rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2 text-body-md text-fg-primary" data-testid="edit-rejected">
            HalalGoes didn’t accept this change. Nothing was changed. Check the details and try again, or contact support.
          </p>
        ) : null}
        {group === 'names' ? (
          <>
            <p className="m-0 text-body-md text-fg-secondary">HalalGoes uses the owner’s name when we contact you. Customers don’t see it.</p>
            <Input id="owner_first_name" label="Owner’s first name" value={v.owner_first_name ?? ''} onChange={(x: string) => set('owner_first_name', x)} {...opt(errors['owner_first_name'])} />
            <Input id="owner_last_name" label="Owner’s last name" value={v.owner_last_name ?? ''} onChange={(x: string) => set('owner_last_name', x)} {...opt(errors['owner_last_name'])} />
          </>
        ) : null}
        {group === 'contact' ? (
          <>
            <Input id="phone" variant="tel" label="Business phone" helperText="HalalGoes calls this number about orders and your account." value={v.phone ?? ''} onChange={(x: string) => set('phone', x)} {...opt(errors['phone_e164'])} />
            <Input id="public_phone" variant="tel" label="Phone customers can call (optional)" value={v.public_phone ?? ''} onChange={(x: string) => set('public_phone', x)} {...opt(errors['public_phone_e164'])} />
          </>
        ) : null}
        {group === 'kitchen' ? (
          <Input id="prep" variant="numeric" label="Usual preparation time, in minutes" helperText="New orders use this time. Orders already accepted keep theirs." value={v.avg_prep_minutes ?? ''} onChange={(x: string) => set('avg_prep_minutes', x.replace(/\D/g, ''))} {...opt(errors['avg_prep_minutes'])} />
        ) : null}
      </form>
    </Shell>
  );
}

// ── Change password ───────────────────────────────────────────────────────────────────────

const PASSWORD_COPY = {
  wrong: 'That isn’t your current password. Check it and try again.',
  weak: 'This password appears in known data breaches, or is too short. Choose a different one.',
  limited: 'Too many tries. Wait a few minutes and try again.',
  failed: 'Couldn’t change your password. Nothing was changed. Check your connection and try again.',
  short: 'Use at least 12 characters.',
  empty: 'Enter your current password.',
};

export function PasswordPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const noReplay = useRef(createClientWithoutReplay());

  const save = async () => {
    const found: { current?: string; next?: string } = {};
    if (!current) found.current = PASSWORD_COPY.empty;
    if (next.length < 12) found.next = PASSWORD_COPY.short;
    setErrors(found);
    if (found.current || found.next) return;
    setState('saving');
    const res = await attempt(() => noReplay.current.POST('/v1/auth/password/change', { body: { current_password: current, new_password: next } }));
    if (res.ok) {
      // The calling session is re-issued; every other device is signed out.
      const grant = res.data as { access_token: string; principal: { account_id: string } };
      keepSession({ ...getSession(), accessToken: grant.access_token, accountId: grant.principal.account_id });
      onChanged();
      return;
    }
    const kind = passwordFailure(res.network ? null : res.status, res.network ? '' : res.code);
    if (kind === 'wrong-current') setErrors({ current: PASSWORD_COPY.wrong });
    else if (kind === 'weak') setErrors({ next: PASSWORD_COPY.weak });
    else if (kind === 'rate-limited') setErrors({ current: PASSWORD_COPY.limited });
    if (kind === 'network' || kind === 'failed') {
      setState('failed');
      return;
    }
    setState('idle');
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="tertiary" size="lg" onPress={onClose}>
        Cancel
      </Button>
      <Button variant="primary" size="lg" loading={state === 'saving'} onPress={() => void save()}>
        Change password
      </Button>
    </div>
  );
  return (
    <Shell title="Change password" label="Change password" closeLabel="Close without changing" onClose={onClose} footer={footer} busy={state === 'saving'} closeDisabled={state === 'saving'} testId="password-panel">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {state === 'failed' ? (
          <p role="alert" className="m-0 rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2 text-body-md text-fg-primary" data-testid="password-failed">
            {PASSWORD_COPY.failed}
          </p>
        ) : null}
        <Input id="current_password" variant="password" label="Current password" value={current} onChange={(x: string) => setCurrent(x)} {...opt(errors.current)} />
        <Input id="new_password" variant="password" label="New password" helperText="At least 12 characters. Any characters are fine; we refuse passwords known from data breaches." value={next} onChange={(x: string) => setNext(x)} {...opt(errors.next)} />
        <p className="m-0 text-body-sm text-fg-secondary">Changing it signs you out on every other device, including a kitchen tablet that takes orders. Sign in there again straight away so new orders reach it.</p>
      </form>
    </Shell>
  );
}

// ── Contact support ───────────────────────────────────────────────────────────────────────

export function SupportPanel({ about, onClose }: { about: 'change' | 'general'; onClose: () => void }) {
  const { config } = useConsole();
  const support = supportFrom(config);
  const id = useId();
  return (
    <Shell
      title="Contact support"
      label="Contact support"
      closeLabel="Close contact support"
      onClose={onClose}
      testId="support-panel"
      footer={
        <Button variant="tertiary" size="lg" fullWidth onPress={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p id={id} className="m-0 text-body-md text-fg-primary">
          {about === 'change'
            ? 'A person at HalalGoes changes the name customers see, the legal name, the address, the description and the GST/HST number after checking them, so they can’t be edited here. Call us and say what should change.'
            : 'Call us and a person will help.'}
        </p>
        <SupportBlock contact={support} label="Partner support" unavailableTitle="Support’s phone number isn’t available right now" unavailableBody="Try again in a few minutes." />
      </div>
    </Shell>
  );
}

// ── Renew the halal certificate ───────────────────────────────────────────────────────────

/**
 * The renewal road is the one onboarding uses (`createUpload`, `confirmUpload`,
 * `attachRestaurantDocument`, `submitRestaurantDocuments`). Whether the server accepts it for a
 * live restaurant is not confirmed in the contract; a refusal reads as "can't send from here".
 */
export function RenewHalalPanel({ onClose }: { onClose: () => void }) {
  const { core } = useConsole();
  if (!core.data) return null;
  return (
    <Shell title="Upload renewed halal certificate" label="Upload renewed halal certificate" closeLabel="Close without sending" onClose={onClose} testId="renew-shell">
      <OnboardingProvider data={core.data}>
        <RenewPanel context="live" />
      </OnboardingProvider>
    </Shell>
  );
}
