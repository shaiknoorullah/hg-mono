/**
 * Reveal the delivery address (`ORD/Reveal*`): a reason, then the order is read again with the
 * address in it. The reason is audited against the account and the order. Nothing about the
 * address is drawn anywhere until this succeeds.
 */
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { unwrap } from '../../../lib/load';
import { api } from '../../data/api';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { asContract } from '../model';
import { Button, DetailPanel, InlineAlert, Textarea } from '../../ds';
import { useHoldWhatsNewNotice } from '../../whatsnew/hold';

type Order = Schema['OrderAdminView'];

const MIN = 10;
const MAX = 500;

export interface RevealPanelProps {
  orderId: string;
  code: string;
  onClose: () => void;
  onRevealed: (order: Order) => void;
}

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'refused'; status: number; message: string; retryAfter: number | null } | { kind: 'failed' };

export function RevealPanel({ orderId, code, onClose, onRevealed }: RevealPanelProps) {
  // An update that arrives while this panel holds unsent input waits until it closes.
  useHoldWhatsNewNotice();
  const draftKey = `order-reveal:${orderId}`;
  const [text, setText] = useState(() => loadDraft<string>(draftKey) ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inFlight = useRef(false);

  useEffect(() => {
    saveDraft(draftKey, text);
  }, [draftKey, text]);

  const tooShort = text.trim().length < MIN;
  const error = (submitted && tooShort) || (phase.kind === 'refused' && phase.status === 422) ? `Write at least ${MIN} characters about why you need it. Nothing was revealed.` : null;

  async function reveal() {
    setSubmitted(true);
    if (tooShort || inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: 'loading' });
    try {
      const body = await unwrap(
        api.GET('/v1/admin/orders/{orderId}', {
          params: { path: { orderId }, query: { reveal_pii: true, justification: text.trim() } },
        }),
      );
      clearDraft(draftKey);
      onRevealed(asContract<Order>(body.data));
    } catch (err) {
      if (isApiError(err) && err.status >= 400 && err.status < 500) {
        const d = (err.details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds;
        setPhase({ kind: 'refused', status: err.status, message: err.message, retryAfter: typeof d === 'number' ? d : null });
      } else {
        setPhase({ kind: 'failed' });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const loading = phase.kind === 'loading';
  return (
    <DetailPanel
      open
      title="Reveal the delivery address"
      subtitle={`Order ${code}`}
      onClose={onClose}
      busy={loading}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={loading} disabled={loading} onPress={() => void reveal()}>
            Reveal address
          </Button>
          <Button variant="tertiary" disabled={loading} onPress={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-fg-secondary">
          This shows the full delivery address for {code}. Your reason is recorded against your account and the order.
        </p>
        {phase.kind === 'refused' && phase.status === 429 ? (
          <InlineAlert tone="warning" blocking title="Too many requests in a short time">
            The server paused this for a moment. Nothing was revealed and nothing was logged. Your reason is kept
            {phase.retryAfter !== null ? `; you can try again in ${phase.retryAfter} seconds.` : '; try again in a moment.'}
          </InlineAlert>
        ) : null}
        {phase.kind === 'refused' && phase.status !== 429 && phase.status !== 422 ? (
          <InlineAlert tone="warning" blocking title="The address wasn’t revealed">
            Nothing was revealed. {phase.message} Your reason is kept.
          </InlineAlert>
        ) : null}
        {phase.kind === 'failed' ? (
          <InlineAlert tone="danger" blocking title="The address didn’t load">
            The server didn’t answer. Nothing was revealed. Your reason is kept; press Reveal address to try again.
          </InlineAlert>
        ) : null}
        <Textarea
          label="Why do you need it?"
          value={text}
          minLength={MIN}
          maxLength={MAX}
          rows={3}
          errorText={error}
          onValueChange={(v) => {
            setText(v);
            if (phase.kind === 'refused' || phase.kind === 'failed') setPhase({ kind: 'idle' });
          }}
        />
        {loading ? (
          <span role="status" className="text-body-sm text-fg-secondary">
            Loading the order again with the address. The panel stays open until it answers.
          </span>
        ) : null}
      </div>
    </DetailPanel>
  );
}
