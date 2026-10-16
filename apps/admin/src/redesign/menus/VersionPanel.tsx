/**
 * One pending menu version, read and decided (`MenuReview`, `MenuReview-Reject`,
 * `MenuReview-States`). Approve sends at once, as the board draws it ("Approving makes this
 * version live at once"); Reject opens an in-page panel for the reason and the note, and nothing
 * is sent until that panel's own button. Approve and Reject are off while the panel is open.
 *
 * The decision is refused in three ways this panel names: the restaurant's menu is locked
 * (suspended or banned), the version was already decided, or the item was removed. None of them
 * is drawn red. Sending is safe to repeat: a retry after a timeout reuses the same
 * `Idempotency-Key`.
 */
import { useRef, useState } from 'react';
import { HgApiError } from '@hg/api-client';

import { api } from '../data/api';
import { useMutation } from '../data/mutation';
import { formatShortDateTime } from '../data/format';
import { Badge, Button, DetailPanel, InlineAlert, KeyValueList, Select, Textarea } from '../ds';
import { REVIEWS } from './copy';
import {
  checkReject,
  classifyDecisionRefusal,
  dietaryTagLabel,
  humanize,
  NOTE_MAX,
  NOTE_MIN_OTHER,
  REJECTION_REASONS,
  rejectInput,
  type RejectDraft,
  type RejectionReason,
  type Version,
} from './model';

export interface VersionPanelProps {
  version: Version;
  /** After the server recorded a decision. */
  onDecided: (version: Version, decision: 'APPROVE' | 'REJECT') => void;
  /** After a 409: the queue should be re-read. */
  onSettle: () => void;
  /** Null when the version names no restaurant: there is no item page to open. */
  editHref: string | null;
}

type Input = { decision: 'APPROVE' } | { decision: 'REJECT'; draft: RejectDraft };

export function VersionPanel({ version, onDecided, onSettle, editHref }: VersionPanelProps) {
  const [rejecting, setRejecting] = useState(false);
  const [draft, setDraft] = useState<RejectDraft>({ reason: '', note: '' });
  const [submitted, setSubmitted] = useState(false);
  const rejectButton = useRef<HTMLButtonElement | null>(null);

  const send = useMutation(async (input: Input, key: string) => {
    const body = input.decision === 'APPROVE' ? ({ decision: 'APPROVE' } as const) : rejectInput(input.draft);
    const res = await api.POST('/v1/admin/menu-reviews/{versionId}/decision', {
      params: { path: { versionId: version.id }, header: { 'Idempotency-Key': key } },
      body,
    });
    if (res.error || res.data == null) throw new HgApiError(res.response.status, res.error as never);
    return res.data.data;
  });

  const out = send.outcome;
  const sending = out.kind === 'sending';
  const refusal = out.kind === 'refused' ? classifyDecisionRefusal(out.error) : null;
  const settled = refusal?.kind === 'already-decided' || refusal?.kind === 'item-deleted';
  const errors = submitted ? checkReject(draft) : {};

  async function decide(input: Input) {
    const outcome = await send.send(input);
    if (outcome.kind === 'done') onDecided(outcome.data, input.decision);
  }

  function edit(patch: Partial<RejectDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    send.reset();
  }

  function submitReject() {
    setSubmitted(true);
    if (Object.keys(checkReject(draft)).length > 0) return;
    void decide({ decision: 'REJECT', draft });
  }

  const submittedAt = version.submitted_at ? formatShortDateTime(version.submitted_at) : 'Not recorded';
  const locked = refusal?.kind === 'locked' ? REVIEWS.locked(refusal.accountState) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4" data-testid="VersionPanel">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-heading-sm font-semibold text-fg-primary" id="menu-version-heading" tabIndex={-1}>
          {version.name}
        </h2>
        <p className="m-0 flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
          <span>
            Version {version.version} · submitted {submittedAt} · restaurant {version.restaurant_id ? <span className="font-mono">{version.restaurant_id}</span> : 'not recorded'}
          </span>
          {version.review_status === 'PENDING_REVIEW' ? (
            <Badge variant="info" size="sm">
              {REVIEWS.waiting}
            </Badge>
          ) : null}
        </p>
      </header>

      {locked ? (
        <InlineAlert tone="slate" blocking title={locked.title}>
          {locked.body}
        </InlineAlert>
      ) : null}
      {refusal?.kind === 'already-decided' ? (
        <InlineAlert tone="warning" blocking title={REVIEWS.alreadyDecided.title} action={<Button variant="tertiary" onPress={onSettle}>{REVIEWS.backToQueue}</Button>}>
          {REVIEWS.alreadyDecided.body}
        </InlineAlert>
      ) : null}
      {refusal?.kind === 'item-deleted' ? (
        <InlineAlert tone="warning" blocking title={REVIEWS.itemDeleted.title} action={<Button variant="tertiary" onPress={onSettle}>{REVIEWS.backToQueue}</Button>}>
          {REVIEWS.itemDeleted.body}
        </InlineAlert>
      ) : null}
      {refusal?.kind === 'forbidden' ? (
        <InlineAlert tone="warning" blocking title={REVIEWS.forbidden.title}>
          {REVIEWS.forbidden.body}
        </InlineAlert>
      ) : null}
      {refusal?.kind === 'other' ? (
        <InlineAlert tone="warning" blocking title="The decision was refused">
          {refusal.message} Nothing was changed.
        </InlineAlert>
      ) : null}
      {out.kind === 'unknown' ? (
        <InlineAlert tone="warning" blocking title={REVIEWS.unknown.title}>
          {REVIEWS.unknown.body}
        </InlineAlert>
      ) : null}

      <KeyValueList
        items={[
          { label: 'Name', value: version.name },
          { label: 'Description', value: version.description ?? null },
          { label: 'Ingredients', value: version.ingredients_text ?? null },
          {
            label: 'Dietary tags',
            value:
              version.dietary_tags && version.dietary_tags.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(version.dietary_tags)).map((t) => (
                    <Badge key={t} variant="outline" size="sm">
                      {dietaryTagLabel(t)}
                    </Badge>
                  ))}
                </span>
              ) : (
                'None'
              ),
          },
          {
            label: 'Allergens',
            value:
              version.allergen_tags && version.allergen_tags.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(version.allergen_tags)).map((t) => (
                    <Badge key={t} variant="outline" size="sm">
                      {humanize(t)}
                    </Badge>
                  ))}
                </span>
              ) : (
                'Not provided'
              ),
          },
        ]}
      />

      {rejecting ? null : version.image_url ? (
        <figure className="m-0 flex flex-col gap-1">
          <img src={version.image_url} alt={`Photo of ${version.name} as the customer will see it`} className="max-h-64 w-auto max-w-full rounded-md border border-line-decorative object-cover" />
          <figcaption className="text-body-sm text-fg-secondary">Photo as the customer will see it</figcaption>
        </figure>
      ) : (
        <p className="m-0 text-body-md text-fg-secondary">No photo was sent with this version.</p>
      )}

      <p className="m-0 text-body-sm text-fg-secondary">{REVIEWS.notCertificate}</p>

      {rejecting ? (
        <DetailPanel
          open
          headingLevel={3}
          title={REVIEWS.rejectTitle(version.name, version.version)}
          onClose={() => {
            setRejecting(false);
            send.reset();
            rejectButton.current?.focus();
          }}
          returnFocusRef={rejectButton}
          busy={sending}
          footer={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={sending} disabled={sending || settled} onPress={submitReject}>
                Reject version
              </Button>
              <Button
                variant="tertiary"
                disabled={sending}
                onPress={() => {
                  setRejecting(false);
                  send.reset();
                  rejectButton.current?.focus();
                }}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body-md text-fg-secondary">{REVIEWS.rejectBody}</p>
            <Select
              label="Reason"
              required
              value={draft.reason === '' ? null : draft.reason}
              placeholder="Choose a reason"
              options={REJECTION_REASONS.map((r) => ({ value: r.value, label: r.label }))}
              errorText={errors.reason ?? null}
              onValueChange={(v) => edit({ reason: v as RejectionReason })}
            />
            <Textarea
              label={draft.reason === 'OTHER' ? `Note to the restaurant (at least ${NOTE_MIN_OTHER} characters for Other)` : 'Note to the restaurant (optional)'}
              value={draft.note}
              maxLength={NOTE_MAX}
              rows={5}
              errorText={errors.note ?? null}
              helperText="Say exactly what to change."
              onValueChange={(v) => edit({ note: v })}
            />
          </div>
        </DetailPanel>
      ) : (
        <>
          <p className="m-0 text-body-md text-fg-secondary">{REVIEWS.consequence}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={rejectButton} variant="tertiary" disabled={sending || settled || locked !== null} onPress={() => { setRejecting(true); send.reset(); }}>
              Reject…
            </Button>
            <Button variant="primary" loading={sending} disabled={sending || settled || locked !== null} onPress={() => void decide({ decision: 'APPROVE' })}>
              {out.kind === 'unknown' ? 'Try again' : 'Approve'}
            </Button>
            {editHref ? (
              <Button variant="ghost" href={editHref}>
                {REVIEWS.editItem}
              </Button>
            ) : null}
          </div>
        </>
      )}
      {rejecting ? <p className="m-0 text-body-sm text-fg-secondary">{REVIEWS.decisionOff}</p> : null}
    </div>
  );
}
