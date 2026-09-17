import { useState } from 'react';
import { Button, Icon, Input } from '@hg/ui-web';
import { idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';

/**
 * Seal-bind (handoff / chain-of-custody, step 1). At packing, the restaurant scans or keys the
 * pre-coded `seal_code` on the physical tamper-evident label; the server binds that seal to this
 * order and mints the EdDSA-signed QR the rider later scans. Low-friction inline row — no printer,
 * no modal. See docs/design/handoff-verification.md. The confirmation uses a TINT (never a solid
 * green fill — invariant #10); the package seal is an integrity signal, not a halal claim.
 */
export function SealBindRow({
  orderId,
  onSealed,
}: {
  orderId: string;
  onSealed?: (seal: Schema['PackageSeal']) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Schema['PackageSeal'] | null>(null);

  async function bind() {
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError('Enter the code printed on the seal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const seal = (await unwrapOrThrow(
        api.POST('/v1/orders/{orderId}/handoff/seal', {
          params: { path: { orderId }, header: { 'Idempotency-Key': idempotencyKey() } },
          body: { seal_code: trimmed },
        }),
      )) as Schema['PackageSeal'];
      setSealed(seal);
      onSealed?.(seal);
    } catch (e) {
      // SEAL_NOT_FOUND / SEAL_ALREADY_BOUND arrive as typed API errors with a human message.
      setError(isApiError(e) ? e.message : 'Could not bind this seal.');
    } finally {
      setBusy(false);
    }
  }

  if (sealed) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-sm border border-feedback-success-border bg-feedback-success-tint px-3 py-2">
        <Icon name="check" size={16} />
        <span className="text-body-sm font-semibold text-feedback-success-tint-text">
          Sealed · <span data-hg-numeric="tabular">{sealed.seal_code}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-end gap-2">
        <Input
          label="Seal code"
          hideLabel
          variant="text"
          placeholder="Scan or key the seal code"
          fullWidth
          value={code}
          onChange={(v) => setCode(v)}
          errorText={error ?? undefined}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void bind();
          }}
        />
        <Button variant="secondary" loading={busy} onPress={() => void bind()}>
          Seal
        </Button>
      </div>
    </div>
  );
}
