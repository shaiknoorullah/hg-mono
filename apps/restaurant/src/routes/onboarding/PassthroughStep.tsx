import { useState } from 'react';
import { isApiError } from '@hg/api-client';
import { Button, Card } from '@hg/ui-web';

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
    <Card className="hg-fade-up">
      <h2 className="mb-1 text-heading-sm font-extrabold text-fg-primary">{title}</h2>
      <p className="mb-5 text-body-sm text-fg-secondary">{description}</p>
      {error ? (
        <p role="alert" className="mb-3 text-body-sm font-semibold text-feedback-danger-text">
          {error}
        </p>
      ) : null}
      <Button fullWidth loading={busy} onPress={handle}>
        {ctaLabel}
      </Button>
    </Card>
  );
}
