/**
 * Step 1, transcription (`RV/Transcription`, `Verify-Transcription`, `Verify-Saving`,
 * `Verify-SaveFailed`, `Verify-Propose*`): type exactly what the certificate says. Nothing is
 * inferred, read from the scan or filled in. Beside it, the application's own facts for the same
 * restaurant, so the person can compare the two.
 *
 * - Saving with a field empty is refused here: the summary (a status, so it doesn't take focus
 *   from the field) counts and lists every empty required field, each is marked, and focus moves
 *   to the first.
 * - Any body in the registry can be saved; only an Accepted one passes Issuer accepted. An issuer
 *   that is not listed is PROPOSED, never typed in as free text.
 * - Saving changes the server's suggestions and recomputes Dates valid and Unique, not reused,
 *   so step 2 is read-only until step 1 is saved.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { useMutation } from '../../data/mutation';
import { formatLongDate, formatTime } from '../../data/format';
import { Button, DateInput, ErrorState, InlineAlert, Input, KeyValueList, Select, Textarea } from '../../ds';
import { unwrap } from '../../../lib/load';
import { errorCode, fieldErrors } from '../shared/errors';
import { findCheck } from '../shared/checks';
import {
  bodyDescription,
  computedFailReason,
  issuerRestriction,
  SCOPE_LABEL,
  SCOPE_OPTIONS,
  scopeRestriction,
  shortBodyName,
  type Certificate,
  type ConsoleMode,
  type IssuingBody,
  type Scope,
} from './model';

type Application = Schema['RestaurantApplication'];

interface Form {
  number: string;
  bodyId: string | null;
  legalName: string;
  address: string;
  issuedOn: string | null;
  expiresOn: string | null;
  scope: Scope | null;
}

type FieldKey = keyof Form;

const FIELD_LABEL: Record<FieldKey, string> = {
  number: 'certificate number',
  bodyId: 'issuing body',
  legalName: 'legal name',
  address: 'certified address',
  issuedOn: 'issued on',
  expiresOn: 'expires on',
  scope: 'scope',
};

const FIELD_ORDER: FieldKey[] = ['number', 'bodyId', 'legalName', 'address', 'issuedOn', 'expiresOn', 'scope'];

const EMPTY_MESSAGE: Record<FieldKey, string> = {
  number: 'Enter the certificate number as printed.',
  bodyId: 'Choose the issuing body.',
  legalName: 'Enter the certified legal name.',
  address: 'Enter the certified address as printed.',
  issuedOn: 'Enter the date printed on the certificate.',
  expiresOn: 'Enter the date printed on the certificate.',
  scope: 'Choose the scope printed on the certificate.',
};

export function formFromCertificate(cert: Certificate): Form {
  return {
    number: cert.certificate_number ?? '',
    bodyId: cert.issuing_body?.id ?? null,
    legalName: cert.certified_legal_name ?? '',
    address: cert.certified_address ?? '',
    issuedOn: cert.issued_on ?? null,
    expiresOn: cert.expires_on ?? null,
    scope: cert.scope ?? null,
  };
}

function sameForm(a: Form, b: Form): boolean {
  return FIELD_ORDER.every((k) => (a[k] ?? '') === (b[k] ?? ''));
}

/** Empty required fields, in the order they appear on the page. */
export function emptyFields(form: Form): FieldKey[] {
  return FIELD_ORDER.filter((k) => !String(form[k] ?? '').trim());
}

interface Props {
  certificate: Certificate;
  application: Application | null;
  bodies: IssuingBody[];
  bodiesStatus: 'loading' | 'ready' | 'error';
  onRetryBodies: () => void;
  mode: ConsoleMode;
  /** "2:48 pm" when the claim has ended. */
  claimEndedAt: string | null;
  onSaved: (certificate: Certificate) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBodyProposed: (body: IssuingBody) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

export function Transcription({ certificate, application, bodies, bodiesStatus, onRetryBodies, mode, claimEndedAt, onSaved, onDirtyChange, onBodyProposed, headingRef }: Props) {
  const saved = useMemo(() => formFromCertificate(certificate), [certificate]);
  const [form, setForm] = useState<Form>(saved);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [summary, setSummary] = useState<{ tone: 'warning' | 'info'; blocking: boolean; title: string; body: string } | null>(null);
  const [savedNow, setSavedNow] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposedNote, setProposedNote] = useState<string | null>(null);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLDivElement | null>>>({});

  // A new record from the server (saved, reloaded) resets the form to it.
  useEffect(() => setForm(saved), [saved]);

  const dirty = !sameForm(form, saved);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const editable = mode === 'editing' && Boolean(certificate.document_id);
  const claimOver = mode === 'claim-ended';

  const save = useMutation(async (body: Schema['HalalTranscriptionInput'], key: string) => {
    const res = await unwrap(
      api.PUT('/v1/admin/halal-certificates/{certificateId}/transcription', {
        params: { path: { certificateId: certificate.id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    );
    return res.data;
  });

  function change(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as FieldKey[]) delete next[k];
      return next;
    });
    save.reset();
  }

  function focusField(key: FieldKey) {
    fieldRefs.current[key]?.querySelector<HTMLElement>('input, textarea, select, button, [role="combobox"]')?.focus();
  }

  async function onSave() {
    setSavedNow(null);
    const empty = emptyFields(form);
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const k of empty) nextErrors[k] = EMPTY_MESSAGE[k];
    if (empty.length === 0 && form.issuedOn && form.expiresOn && form.issuedOn > form.expiresOn) {
      nextErrors.issuedOn = 'The issue date is after the expiry date. Check the day and month.';
    }
    setErrors(nextErrors);
    if (empty.length > 0) {
      setSummary({
        tone: 'warning',
        blocking: false,
        title: `The transcription wasn’t saved: ${empty.length} ${empty.length === 1 ? 'field is' : 'fields are'} empty`,
        body: `Fill in the ${empty.map((k) => FIELD_LABEL[k]).join(', ')}. The fields are marked below. Nothing was changed.`,
      });
      focusField(empty[0]!);
      return;
    }
    if (nextErrors.issuedOn) {
      setSummary({ tone: 'warning', blocking: false, title: 'The transcription wasn’t saved: check the dates', body: 'Nothing was changed.' });
      focusField('issuedOn');
      return;
    }
    setSummary(null);
    const outcome = await save.send({
      certificate_number: form.number.trim(),
      issuing_body_id: form.bodyId!,
      certified_legal_name: form.legalName.trim(),
      certified_address: form.address.trim(),
      scope: form.scope!,
      issued_on: form.issuedOn!,
      expires_on: form.expiresOn!,
    });
    if (outcome.kind === 'done') {
      setSavedNow(formatTime(new Date()));
      setSummary(null);
      onSaved(outcome.data);
      return;
    }
    if (outcome.kind === 'refused') {
      const list = fieldErrors(outcome.error);
      const marked: Partial<Record<FieldKey, string>> = {};
      for (const f of list) {
        if (f.field === 'issuing_body_id') marked.bodyId = 'The server didn’t find this issuing body in the registry. Choose it again from the list.';
        else if (f.field === 'certificate_number') marked.number = f.message;
        else if (f.field === 'certified_legal_name') marked.legalName = f.message;
        else if (f.field === 'certified_address') marked.address = f.message;
        else if (f.field === 'issued_on') marked.issuedOn = f.message;
        else if (f.field === 'expires_on') marked.expiresOn = f.message;
        else if (f.field === 'scope') marked.scope = f.message;
      }
      setErrors(marked);
      const count = Math.max(1, Object.keys(marked).length);
      setSummary({
        tone: 'warning',
        blocking: true,
        title: `The server didn’t accept ${count} ${count === 1 ? 'field' : 'fields'}`,
        body: `${Object.keys(marked).length === 0 ? `${outcome.error.message} ` : ''}Fix the marked field and save again. Nothing was changed.`,
      });
      return;
    }
    setSummary({
      tone: 'warning',
      blocking: true,
      title: 'The transcription wasn’t saved',
      body: 'The connection dropped before the server answered. Everything you typed is still here. Save again when you’re back online.',
    });
  }

  const body = bodies.find((b) => b.id === (form.bodyId ?? saved.bodyId)) ?? certificate.issuing_body ?? null;
  const options = useMemo(() => {
    const list = [...bodies];
    if (certificate.issuing_body && !list.some((b) => b.id === certificate.issuing_body!.id)) list.push(certificate.issuing_body);
    return list.map((b) => ({ value: b.id, label: b.name, description: bodyDescription(b) }));
  }, [bodies, certificate.issuing_body]);

  // What saving did to the checks, in words.
  const h5 = findCheck(certificate.checks, 'H5_DATES_VALID');
  const afterSave = (() => {
    if (!savedNow) return null;
    if (h5 && (h5.computed_result ?? h5.result) === 'FAIL') {
      return { title: `Transcription saved at ${savedNow}`, body: `H5 Dates valid, computed: Fail. ${computedFailReason(certificate, 'H5_DATES_VALID')}` };
    }
    return {
      title: `Transcription saved at ${savedNow}`,
      body: 'The suggested issuer, name and address checks and the computed Dates valid and Unique, not reused are updated in step 2, from the server’s answer to this save.',
    };
  })();

  const footer = (() => {
    if (claimOver) return `Saving is off: your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}. What you typed stays on this page until you leave.`;
    if (dirty) return 'You changed the transcription. Save to update the suggestions and computed checks.';
    const issuer = issuerRestriction(certificate.issuing_body);
    const scope = scopeRestriction(certificate.scope);
    if (certificate.certificate_number && issuer && certificate.issuing_body) {
      return `Saved with ${shortBodyName(certificate.issuing_body.name)}, ${certificate.issuing_body.status === 'PROPOSED' ? 'a proposed body' : `which is ${certificate.issuing_body.status.charAt(0)}${certificate.issuing_body.status.slice(1).toLowerCase()} in the registry`}. Issuer accepted can’t pass.`;
    }
    if (certificate.certificate_number && scope && certificate.scope) {
      return `Saved with the scope ${SCOPE_LABEL[certificate.scope]}. It doesn’t pass Scope sufficient: step 2 offers only Fail or Not assessed for that check.`;
    }
    return 'Saving updates the suggested issuer, name and address checks and recomputes Dates valid and Unique, not reused.';
  })();

  const profile = application?.profile;
  const facts = application ? (
    <KeyValueList
      dense
      labelWidth="6.5rem"
      items={[
        { label: 'Legal name', value: profile?.legal_name },
        { label: 'Display name', value: profile?.display_name },
        {
          label: 'Premises',
          value: profile ? [profile.address.line1, profile.address.line2, `${profile.address.city} ${profile.address.province} ${profile.address.postal_code}`].filter(Boolean).join(', ') : null,
        },
      ]}
    />
  ) : (
    <p className="text-body-sm text-fg-secondary">The application’s facts did not load. Nothing was changed.</p>
  );

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-3" data-testid="Transcription">
      <section aria-labelledby="facts-heading" className="rounded-md border border-line-decorative bg-surface-subtle p-3">
        <h3 id="facts-heading" className="mb-1 text-label-lg text-fg-primary">
          The application says
        </h3>
        {facts}
      </section>

      <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-heading-sm text-fg-primary outline-none">
        <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-chrome text-label-md text-on-accent">
          1
        </span>
        Step 1: Transcribe the certificate
      </h2>
      <p className="text-body-sm text-fg-secondary">
        {!certificate.document_id
          ? 'No document, so there is nothing to type in.'
          : editable
            ? 'Type exactly what the certificate says. Nothing is filled in for you. Save the transcription before step 2: the system suggestions and the computed checks depend on it.'
            : 'Read-only. The fields as last saved.'}
      </p>

      {!certificate.document_id ? (
        <InlineAlert tone="neutral" icon="info" title="Nothing to transcribe">
          There’s no certificate document on this record. Ask the restaurant for a new certificate below.
        </InlineAlert>
      ) : null}

      {summary ? (
        <InlineAlert tone={summary.tone} blocking={summary.blocking} title={summary.title}>
          {summary.body}
        </InlineAlert>
      ) : null}
      {afterSave ? (
        <InlineAlert tone="info" title={afterSave.title}>
          {afterSave.body}
        </InlineAlert>
      ) : null}
      {proposedNote ? (
        <InlineAlert tone="neutral" icon="clock" title={proposedNote}>
          A super admin reviews it. While it’s only proposed, H2 Issuer accepted is suggested as Fail and the certificate can’t be approved.
        </InlineAlert>
      ) : null}

      {certificate.document_id ? (
        editable ? (
          <div className="flex flex-col gap-3">
            <div ref={(el) => void (fieldRefs.current.number = el)}>
              <Input label="Certificate number" required maxLength={100} value={form.number} helperText="Exactly as printed, including dashes." errorText={errors.number ?? null} onValueChange={(number) => change({ number })} />
            </div>
            <div ref={(el) => void (fieldRefs.current.bodyId = el)} className="flex flex-col gap-1">
              {bodiesStatus === 'error' ? (
                <ErrorState title="The issuing bodies didn’t load" description="Nothing was changed." onRetry={onRetryBodies} headingLevel={3} className="py-3" />
              ) : (
                <Select
                  label="Issuing body"
                  variant="listbox"
                  searchable
                  required
                  loading={bodiesStatus === 'loading'}
                  value={form.bodyId}
                  options={options}
                  placeholder="Choose the body printed on the certificate"
                  helperText="Choose the body printed on the certificate. Only Accepted bodies pass Issuer accepted."
                  errorText={errors.bodyId ?? null}
                  onValueChange={(bodyId) => change({ bodyId })}
                />
              )}
              {!proposing ? (
                <p className="text-body-sm text-fg-secondary">
                  The issuer isn’t listed.{' '}
                  <button type="button" className="text-link underline" onClick={() => setProposing(true)}>
                    Propose an issuing body
                  </button>
                </p>
              ) : null}
            </div>
            {proposing ? (
              <ProposeIssuer
                onCancel={() => setProposing(false)}
                onProposed={(proposed) => {
                  setProposing(false);
                  onBodyProposed(proposed);
                  change({ bodyId: proposed.id });
                  setProposedNote(`${shortBodyName(proposed.name)} proposed and chosen for this certificate`);
                }}
              />
            ) : null}
            <div ref={(el) => void (fieldRefs.current.legalName = el)}>
              <Input label="Certified legal name" required maxLength={200} value={form.legalName} errorText={errors.legalName ?? null} onValueChange={(legalName) => change({ legalName })} />
            </div>
            <div ref={(el) => void (fieldRefs.current.address = el)}>
              <Textarea label="Certified address" required rows={3} maxLength={300} characterCount value={form.address} helperText="Up to 300 characters, as printed." errorText={errors.address ?? null} onValueChange={(address) => change({ address })} />
            </div>
            <div ref={(el) => void (fieldRefs.current.issuedOn = el)}>
              <DateInput label="Issued on" name="issued" required value={form.issuedOn} helperText="Day, month, year" errorText={errors.issuedOn ?? null} onValueChange={(issuedOn) => change({ issuedOn })} />
              {form.issuedOn ? <p className="text-body-sm text-fg-secondary">Reads as {formatLongDate(form.issuedOn)}</p> : null}
            </div>
            <div ref={(el) => void (fieldRefs.current.expiresOn = el)}>
              <DateInput label="Expires on" name="expires" required value={form.expiresOn} helperText="Day, month, year" errorText={errors.expiresOn ?? null} onValueChange={(expiresOn) => change({ expiresOn })} />
              {form.expiresOn ? <p className="text-body-sm text-fg-secondary">Reads as {formatLongDate(form.expiresOn)}</p> : null}
            </div>
            <div ref={(el) => void (fieldRefs.current.scope = el)}>
              <Select
                label="Scope"
                required
                value={form.scope}
                options={SCOPE_OPTIONS.map((o) => ({ ...o }))}
                placeholder="Choose the scope printed"
                helperText="As printed. Only Whole establishment and Kitchen only pass Scope sufficient."
                errorText={errors.scope ?? null}
                onValueChange={(scope) => change({ scope: scope as Scope })}
              />
            </div>
            {body?.requires_issuer_confirmation ? (
              <section aria-labelledby="confirm-heading" className="flex flex-col gap-1 rounded-md border border-line-decorative p-3">
                <h3 id="confirm-heading" className="text-label-lg text-fg-primary">
                  Confirm this certificate with the issuer
                </h3>
                <p className="text-body-sm text-fg-secondary">
                  {shortBodyName(body.name)} is accepted with a condition: the registry says each certificate must be confirmed with the issuer, outside HalalGoes, before approval. Approve stays off until the confirmation is recorded here. Recording a confirmation isn’t available yet.
                </p>
              </section>
            ) : null}
            <p className="text-body-sm text-fg-secondary">{footer}</p>
            <div className="flex justify-end">
              <Button
                variant={certificate.certificate_number && !dirty ? 'secondary' : 'primary'}
                loading={save.sending}
                disabled={claimOver}
                {...(claimOver ? { accessibilityLabel: `Save transcription, unavailable: your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}` } : {})}
                onPress={() => void onSave()}
              >
                Save transcription
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <KeyValueList
              dense
              labelWidth="7rem"
              items={[
                { label: 'Certificate number', value: certificate.certificate_number, mono: true },
                { label: 'Issuing body', value: certificate.issuing_body?.name },
                { label: 'Legal name', value: certificate.certified_legal_name },
                { label: 'Certified address', value: certificate.certified_address },
                { label: 'Issued on', value: certificate.issued_on ? formatLongDate(certificate.issued_on) : null },
                { label: 'Expires on', value: certificate.expires_on ? formatLongDate(certificate.expires_on) : null },
                { label: 'Scope', value: certificate.scope ? SCOPE_LABEL[certificate.scope] : null },
              ]}
            />
            <p className="text-body-sm text-fg-secondary">{footer}</p>
            {claimOver ? (
              <Button variant="primary" disabled accessibilityLabel={`Save transcription, unavailable: your claim ended${claimEndedAt ? ` at ${claimEndedAt}` : ''}`}>
                Save transcription
              </Button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

function ProposeIssuer({ onCancel, onProposed }: { onCancel: () => void; onProposed: (body: IssuingBody) => void }) {
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const [website, setWebsite] = useState('');
  const [ref, setRef] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string; blocking: boolean } | null>(null);

  const send = useMutation(async (body: Schema['HalalIssuingBodyInput'], key: string) => {
    const res = await unwrap(api.POST('/v1/admin/halal-issuing-bodies', { params: { header: { 'Idempotency-Key': key } }, body }));
    return res.data;
  });

  const nameError = submitted && name.trim().length < 2 ? 'Enter the name as printed on the certificate.' : null;
  const whyError = submitted && why.trim().length < 20 ? `Add at least ${20 - why.trim().length} more characters. Say why HalalGoes should consider it.` : null;

  async function submit() {
    setSubmitted(true);
    if (name.trim().length < 2 || why.trim().length < 20) return;
    setProblem(null);
    const outcome = await send.send({
      name: name.trim(),
      justification: why.trim(),
      ...(website.trim() ? { website: website.trim() } : {}),
      ...(ref.trim() ? { accreditation_ref: ref.trim() } : {}),
    });
    if (outcome.kind === 'done') {
      onProposed(outcome.data);
      return;
    }
    if (outcome.kind === 'refused') {
      setProblem(
        outcome.error.status === 409 || errorCode(outcome.error) === 'ALREADY_EXISTS'
          ? {
              title: 'This issuing body is already in the registry',
              body: `“${name.trim()}” was already proposed or listed. Choose it from the Issuing body list instead. Nothing was changed.`,
              blocking: true,
            }
          : { title: 'The proposal wasn’t sent', body: `${outcome.error.message} Nothing was changed.`, blocking: true },
      );
      return;
    }
    setProblem({ title: 'The proposal wasn’t sent', body: 'The connection dropped before the server answered. Nothing was changed. Press Send for review to try again.', blocking: true });
  }

  return (
    <section aria-labelledby="propose-heading" className="flex flex-col gap-3 rounded-md border border-line-decorative p-3" data-testid="ProposeIssuer">
      <h3 id="propose-heading" className="text-label-lg text-fg-primary">
        Propose an issuing body
      </h3>
      <p className="text-body-sm text-fg-secondary">
        A super admin reviews it. Once sent, it’s chosen as the issuing body so you can save the transcription. Until it’s accepted, H2 Issuer accepted is suggested as Fail and the certificate can’t be approved.
      </p>
      {problem ? (
        <InlineAlert tone="warning" blocking={problem.blocking} title={problem.title}>
          {problem.body}
        </InlineAlert>
      ) : null}
      <Input label="Name, as printed on the certificate" required value={name} errorText={nameError} onValueChange={(v) => { setName(v); send.reset(); }} />
      <Textarea label="Why HalalGoes should consider it (required)" rows={3} maxLength={2000} characterCount value={why} minLength={20} errorText={whyError} onValueChange={(v) => { setWhy(v); send.reset(); }} />
      <Input label="Website (optional)" variant="text" value={website} onValueChange={(v) => { setWebsite(v); send.reset(); }} />
      <Input label="Accreditation reference (optional)" value={ref} onValueChange={(v) => { setRef(v); send.reset(); }} />
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onPress={onCancel} disabled={send.sending}>
          Cancel
        </Button>
        <Button variant="primary" loading={send.sending} onPress={() => void submit()}>
          Send for review
        </Button>
      </div>
    </section>
  );
}
