/**
 * The review panel (`Bodies-Review`) and Change status: an in-page panel beside the list, never an
 * overlay. A proposed body is accepted or rejected; any other body moves to one of the other
 * statuses. Every change carries a written justification (20 to 2000 characters) that the server
 * records. Nothing is sent until this panel's own Save decision.
 *
 * Sending is safe to repeat: a retry after a timeout reuses the same `Idempotency-Key`; changing
 * anything mints a new one.
 */
import { useState } from 'react';
import { HgApiError } from '@hg/api-client';

import { api } from '../data/api';
import { useMutation } from '../data/mutation';
import { Button, Checkbox, DetailPanel, InlineAlert, KeyValueList, RadioGroup, Textarea } from '../ds';
import { BODY_PANEL } from './copy';
import {
  classifyStatusRefusal,
  isKnownStatus,
  justificationError,
  MAX_JUSTIFICATION,
  MIN_JUSTIFICATION,
  STATUS_LABEL,
  targetsFor,
  type Body,
  type BodyStatus,
} from './model';

export interface BodyPanelProps {
  body: Body;
  onClose: () => void;
  /** The server's answer: the list replaces the row with it. */
  onChanged: (body: Body) => void;
}

export function BodyPanel({ body, onClose, onChanged }: BodyPanelProps) {
  const proposal = body.status === 'PROPOSED';
  const targets = isKnownStatus(body.status) ? targetsFor(body.status) : targetsFor(undefined);
  const [target, setTarget] = useState<BodyStatus | null>(null);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(body.requires_issuer_confirmation === true);
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState<Body | null>(null);

  const send = useMutation(async (input: { status: BodyStatus; justification: string; confirm: boolean }, key: string) => {
    const res = await api.POST('/v1/admin/halal-issuing-bodies/{bodyId}/status', {
      params: { path: { bodyId: body.id }, header: { 'Idempotency-Key': key } },
      body: {
        status: input.status,
        justification: input.justification,
        ...(input.status === 'ACCEPTED' ? { requires_issuer_confirmation: input.confirm } : {}),
      },
    });
    if (res.error || res.data == null) throw new HgApiError(res.response.status, res.error as never);
    return res.data.data;
  });

  const out = send.outcome;
  const sending = out.kind === 'sending';
  const refusal = out.kind === 'refused' ? classifyStatusRefusal(out.error) : null;
  const justErr = submitted ? justificationError(text) : null;
  const targetErr = submitted && target === null ? 'Choose what this body becomes.' : null;

  function edit(fn: () => void) {
    fn();
    send.reset();
  }

  async function save() {
    setSubmitted(true);
    if (target === null || justificationError(text) !== null) return;
    const outcome = await send.send({ status: target, justification: text.trim(), confirm });
    if (outcome.kind === 'done') {
      setDone(outcome.data);
      onChanged(outcome.data);
    }
  }

  const title = proposal ? `Review a proposed issuing body: ${body.name}` : `Change status: ${body.name}`;

  if (done) {
    return (
      <DetailPanel open title={title} onClose={onClose} footer={<Button variant="primary" onPress={onClose}>Done</Button>}>
        <InlineAlert tone="success-tint" title="Saved">
          {BODY_PANEL.saved(done.name, isKnownStatus(done.status) ? STATUS_LABEL[done.status] : 'updated')}
        </InlineAlert>
        {done.status !== 'ACCEPTED' ? <p className="mt-3 text-body-sm text-fg-secondary">{BODY_PANEL.narrows}</p> : null}
      </DetailPanel>
    );
  }

  const options = targets.map((s) => ({ value: s, label: proposal ? (s === 'ACCEPTED' ? 'Accept' : 'Reject') : STATUS_LABEL[s] }));

  return (
    <DetailPanel
      open
      title={title}
      subtitle={proposal ? BODY_PANEL.reviewSubtitle : BODY_PANEL.changeSubtitle(isKnownStatus(body.status) ? STATUS_LABEL[body.status] : 'unknown')}
      onClose={onClose}
      busy={sending}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={sending} disabled={sending} onPress={() => void save()}>
            {BODY_PANEL.save}
          </Button>
          <Button variant="tertiary" disabled={sending} onPress={onClose}>
            {BODY_PANEL.cancel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {refusal?.kind === 'mfa' ? (
          <InlineAlert tone="warning" blocking title={BODY_PANEL.mfa.title}>
            {BODY_PANEL.mfa.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'forbidden' ? (
          <InlineAlert tone="warning" blocking title={BODY_PANEL.forbidden.title}>
            {BODY_PANEL.forbidden.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'gone' ? (
          <InlineAlert tone="warning" blocking title={BODY_PANEL.gone.title}>
            {BODY_PANEL.gone.body}
          </InlineAlert>
        ) : null}
        {refusal?.kind === 'invalid' || refusal?.kind === 'other' ? (
          <InlineAlert tone="warning" blocking title="The change was refused">
            {refusal.message} Nothing was changed.
          </InlineAlert>
        ) : null}
        {out.kind === 'unknown' ? (
          <InlineAlert tone="warning" blocking title={BODY_PANEL.unknown.title}>
            {BODY_PANEL.unknown.body}
          </InlineAlert>
        ) : null}

        <KeyValueList
          dense
          items={[
            { label: 'Name', value: body.name },
            { label: 'Printed as', value: body.aliases && body.aliases.length > 0 ? body.aliases.join(', ') : null },
            { label: 'Region', value: [body.region, body.country].filter(Boolean).join(', ') || null },
            { label: 'Website', value: body.website ?? null },
            { label: 'Accreditation', value: body.accreditation_ref ?? 'None given' },
            { label: 'Notes', value: body.notes ?? 'None' },
          ]}
        />

        <RadioGroup
          label={BODY_PANEL.statusLabel}
          required
          value={target}
          options={options}
          error={targetErr}
          onValueChange={(v) => edit(() => setTarget(v as BodyStatus))}
        />

        {target === 'ACCEPTED' ? (
          <>
            <p className="text-body-sm text-fg-secondary">{BODY_PANEL.widens}</p>
            <Checkbox
              label={BODY_PANEL.confirmation}
              description={BODY_PANEL.confirmationHelp}
              checked={confirm}
              onCheckedChange={(v) => edit(() => setConfirm(v))}
            />
          </>
        ) : null}
        {target !== null && target !== 'ACCEPTED' ? <p className="text-body-sm text-fg-secondary">{BODY_PANEL.narrows}</p> : null}

        <Textarea
          label={BODY_PANEL.justification}
          required
          value={text}
          minLength={MIN_JUSTIFICATION}
          maxLength={MAX_JUSTIFICATION}
          helperText={BODY_PANEL.justificationHelp}
          errorText={justErr}
          rows={5}
          onValueChange={(v) => edit(() => setText(v))}
        />
      </div>
    </DetailPanel>
  );
}
