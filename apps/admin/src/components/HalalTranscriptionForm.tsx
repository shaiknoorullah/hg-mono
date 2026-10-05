/**
 * A-15 step 1 — transcribe the certificate's printed fields (`transcribeHalalCertificate`).
 * The issuing body comes from the registry (`listHalalIssuingBodies`); free text would make the
 * badge meaningless. Saving reloads the certificate so the seven checks evaluate the record.
 */
import { useCallback, useState } from 'react';
import type { Schema } from '@hg/api-client';
import { Banner, Button, Card, ErrorState, Input, Select, Skeleton, useToast } from '@hg/ui-web';

import { api } from '../lib/api.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import { toAsyncError, unwrap, useLoad } from '../lib/load.js';

type HalalCertificate = Schema['HalalCertificate'];
type Scope = Schema['HalalTranscriptionInput']['scope'];

const SCOPES = [
  { value: 'WHOLE_ESTABLISHMENT', label: 'Whole establishment' },
  { value: 'KITCHEN_ONLY', label: 'Kitchen only' },
  { value: 'SPECIFIC_MENU_ITEMS', label: 'Specific menu items' },
  { value: 'SUPPLIER_CHAIN_ONLY', label: 'Supplier chain only' },
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function HalalTranscriptionForm({ certificate, onSaved }: { certificate: HalalCertificate; onSaved: () => void }) {
  const toast = useToast();
  const fetchBodies = useCallback(
    async () =>
      (await unwrap(api.GET('/v1/admin/halal-issuing-bodies', { params: { query: { status: ['ACCEPTED'], limit: 100 } } })))
        .data,
    [],
  );
  const bodies = useLoad<Schema['HalalIssuingBody'][]>(fetchBodies);

  const [bodyId, setBodyId] = useState(certificate.issuing_body?.id ?? '');
  const [number, setNumber] = useState(certificate.certificate_number ?? '');
  const [name, setName] = useState(certificate.certified_legal_name ?? '');
  const [address, setAddress] = useState(certificate.certified_address ?? '');
  const [scope, setScope] = useState<string>(certificate.scope ?? 'WHOLE_ESTABLISHMENT');
  const [issued, setIssued] = useState(certificate.issued_on ?? '');
  const [expires, setExpires] = useState(certificate.expires_on ?? '');
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const errors = {
    body: bodyId ? undefined : 'Choose the issuing body from the registry.',
    number: number.trim() ? undefined : 'Enter the certificate number.',
    name: name.trim() ? undefined : 'Enter the certified legal name.',
    address: address.trim() ? undefined : 'Enter the certified address.',
    issued: ISO_DATE.test(issued) ? undefined : 'Use the format YYYY-MM-DD.',
    expires: ISO_DATE.test(expires) ? undefined : 'Use the format YYYY-MM-DD.',
  };
  const invalid = Object.values(errors).some(Boolean);
  const shown = (e: string | undefined) => (showErrors ? e : undefined);

  const save = async () => {
    setShowErrors(true);
    if (invalid) return;
    setSaving(true);
    try {
      await unwrap(
        api.PUT('/v1/admin/halal-certificates/{certificateId}/transcription', {
          params: { path: { certificateId: certificate.id }, header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: {
            certificate_number: number.trim(),
            issuing_body_id: bodyId,
            certified_legal_name: name.trim(),
            certified_address: address.trim(),
            scope: scope as Scope,
            issued_on: issued,
            expires_on: expires,
          },
        }),
      );
      toast.show({ variant: 'success', title: 'Certificate transcribed' });
      onSaved();
    } catch (err) {
      toast.show({ variant: 'danger', title: 'Could not save the transcription', description: toAsyncError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card header={<h2 className="text-heading-sm text-fg-primary">Transcribe the certificate</h2>}>
      <div className="adm-stack">
        <p className="text-body-md text-fg-secondary">
          Copy the fields exactly as printed on the certificate. The seven checks below are evaluated against this record.
        </p>
        {bodies.status === 'loading' ? <Skeleton height={44} /> : null}
        {bodies.status === 'error' ? (
          <ErrorState variant="inline" errorCode={bodies.error.code} description={bodies.error.message} onRetry={bodies.reload} />
        ) : null}
        {bodies.status === 'ready' && bodies.data.length === 0 ? (
          <Banner
            variant="warning"
            title="No accepted issuing bodies"
            description="The registry has no accepted issuing body, so a certificate cannot be transcribed yet."
          />
        ) : null}
        {bodies.status === 'ready' && bodies.data.length > 0 ? (
          <Select
            label="Issuing body"
            required
            placeholder="Choose an issuing body"
            options={bodies.data.map((b) => ({ value: b.id, label: b.name }))}
            value={bodyId}
            onChange={setBodyId}
            errorText={shown(errors.body)}
          />
        ) : null}
        <Input label="Certificate number" value={number} onChange={setNumber} errorText={shown(errors.number)} />
        <Input label="Certified legal name" value={name} onChange={setName} errorText={shown(errors.name)} />
        <Input label="Certified address" value={address} onChange={setAddress} errorText={shown(errors.address)} />
        <Select label="Scope" options={SCOPES} value={scope} onChange={setScope} />
        <Input label="Issued on" placeholder="YYYY-MM-DD" value={issued} onChange={setIssued} errorText={shown(errors.issued)} />
        <Input label="Expires on" placeholder="YYYY-MM-DD" value={expires} onChange={setExpires} errorText={shown(errors.expires)} />
        <div className="adm-form-actions">
          <Button variant="primary" disabled={saving} onPress={() => void save()}>
            {saving ? 'Saving…' : 'Save transcription'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
