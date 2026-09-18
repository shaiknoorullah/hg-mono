import * as React from 'react';
import { View, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Banner, Button, Card, Checkbox, Input, useTheme, useTypeStyle } from '@hg/ui-native';
import { idempotencyKey, isApiError, unwrap } from '@hg/api-client';
import { api } from '../api';

/**
 * Handoff / chain-of-custody, rider side. The rider scans the tamper-evident seal's QR at pickup
 * and again at delivery; the server confirms the token belongs to this assigned order (identity)
 * and records whether the seal was intact (integrity). Only the rider scans — the customer's proof
 * is the OTP already in the POD flow. See docs/design/handoff-verification.md.
 *
 * `seal_intact:false` never blocks the handoff — the physical exchange happened — it's recorded as
 * tamper evidence. Orders with no bound seal use the "No seal on this package" escape hatch.
 */
export function SealScanCard({
  orderId,
  phase,
  onScanned,
  onSkip,
}: {
  orderId: string;
  phase: 'pickup' | 'delivery';
  onScanned: () => void;
  onSkip: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.md');
  const caption = useTypeStyle('caption');

  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = React.useState(false);
  const [token, setToken] = React.useState('');
  const [sealIntact, setSealIntact] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submittedRef = React.useRef(false);

  const path = phase === 'pickup'
    ? ('/v1/orders/{orderId}/handoff/pickup-scan' as const)
    : ('/v1/orders/{orderId}/handoff/delivery-scan' as const);

  const submit = React.useCallback(
    async (qrToken: string) => {
      const t = qrToken.trim();
      if (t.length < 16) {
        setError('That doesn’t look like a valid seal code.');
        return;
      }
      if (submittedRef.current || busy) return;
      submittedRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await unwrap(
          api.POST(path, {
            params: { path: { orderId }, header: { 'Idempotency-Key': idempotencyKey() } },
            body: { qr_token: t, seal_intact: sealIntact },
          }),
        );
        onScanned();
      } catch (e) {
        submittedRef.current = false;
        setError(isApiError(e) ? e.message : 'Could not verify the seal. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [busy, orderId, path, sealIntact, onScanned],
  );

  const title = phase === 'pickup' ? 'Scan the seal at pickup' : 'Scan the seal at the door';
  const canScan = permission?.granted && !manual;

  return (
    <Card variant="outlined">
      <View style={{ gap: theme.target.spacing }}>
        <Text style={{ ...heading, color: theme.color.text.primary }}>{title}</Text>
        <Text style={{ ...body, color: theme.color.text.secondary }}>
          Check the tamper-evident label across the bag opening, then scan its QR code.
        </Text>

        <Checkbox
          checked={sealIntact}
          onChange={setSealIntact}
          label="The seal is intact"
        />

        {error ? <Banner variant="warning" title="Seal not verified" description={error} /> : null}

        {canScan ? (
          <View
            style={{
              height: 220,
              borderRadius: 16,
              overflow: 'hidden',
              backgroundColor: theme.color.surface.sunken,
            }}
          >
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : ({ data }) => void submit(data)}
            />
          </View>
        ) : manual ? (
          <View style={{ gap: theme.target.spacing }}>
            <Input
              label="Seal code"
              value={token}
              onChange={setToken}
              placeholder="Paste or type the code under the QR"
            />
            <Button variant="primary" size="lg" fullWidth loading={busy} onPress={() => void submit(token)}>
              Verify seal
            </Button>
          </View>
        ) : (
          <Button variant="primary" size="lg" fullWidth onPress={() => void requestPermission()}>
            Enable camera to scan
          </Button>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Button variant="ghost" size="md" onPress={() => setManual((m) => !m)}>
            {canScan || !manual ? 'Enter code manually' : 'Use camera'}
          </Button>
          <Button variant="ghost" size="md" onPress={onSkip}>
            No seal on this package
          </Button>
        </View>
        <Text style={{ ...caption, color: theme.color.text.tertiary }}>
          A broken seal never blocks the handoff — it’s recorded so support can follow up.
        </Text>
      </View>
    </Card>
  );
}
