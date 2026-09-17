import * as React from 'react';
import { View, Text } from 'react-native';
import { Button, Input, useTheme, useTypeStyle } from '@hg/ui-native';
import { reportSealTamper } from '../api/handoff';

/**
 * "Seal looks tampered?" — the customer-side exception path of the handoff feature. Photographs
 * the broken seal + a short note and opens a support review. Never auto-cancels the order.
 */
export function TamperReportCard({ orderId }: { orderId: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.md');
  const caption = useTypeStyle('caption');

  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const cardStyle = {
    padding: 16,
    borderRadius: 12,
    backgroundColor: theme.color.surface.raised,
    borderWidth: 1,
    borderColor: theme.color.border.decorative,
    gap: 10,
  } as const;

  async function submit(): Promise<void> {
    if (note.trim().length < 5) {
      setError('Add a short note about what you noticed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportSealTamper(orderId, note.trim());
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the report. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={cardStyle}>
        <Text style={{ ...heading, color: theme.color.text.primary }}>Thanks — reported</Text>
        <Text style={{ ...body, color: theme.color.text.secondary }}>
          Support will review the photo and follow up. Your order isn’t cancelled.
        </Text>
      </View>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" onPress={() => setOpen(true)}>
        Seal looks tampered?
      </Button>
    );
  }

  return (
    <View style={cardStyle}>
      <Text style={{ ...heading, color: theme.color.text.primary }}>Report a broken seal</Text>
      <Text style={{ ...body, color: theme.color.text.secondary }}>
        Take a photo of the seal and tell us what you saw. We’ll open a review — your order stays as is.
      </Text>
      <Input
        label="What did you notice?"
        value={note}
        onChange={setNote}
        placeholder="e.g. the seal was cut when it arrived"
        maxLength={500}
        errorText={error ?? undefined}
      />
      <Button variant="primary" loading={busy} onPress={() => void submit()}>
        Take photo &amp; report
      </Button>
      <Button variant="ghost" onPress={() => setOpen(false)}>
        Cancel
      </Button>
      <Text style={{ ...caption, color: theme.color.text.tertiary }}>
        This opens a support review, not an automatic cancellation.
      </Text>
    </View>
  );
}
