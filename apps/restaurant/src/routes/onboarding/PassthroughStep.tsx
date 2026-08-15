import { useState } from 'react';
import { isApiError } from '@hg/api-client';
import { Button, Card, FieldError } from '../../components/primitives';

export function PassthroughStep({
  title,
  description,
  ctaLabel,
  onContinue,
  onNavigate,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  onContinue?: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (onNavigate) return onNavigate();
    if (!onContinue) return;
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="hg-fade-up p-6">
      <h2 className="mb-1 text-[16px] font-extrabold text-[var(--ink)]">{title}</h2>
      <p className="mb-5 text-[13.5px] text-[var(--ink2)]">{description}</p>
      <FieldError>{error}</FieldError>
      <Button className="w-full" loading={busy} onClick={handle}>
        {ctaLabel}
      </Button>
    </Card>
  );
}
