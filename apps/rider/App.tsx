/**
 * Halal Goes — Rider app root.
 *
 * The whole tree renders under the RIDER register (`theme="rider"`) in the light scheme, so every
 * `@hg/ui-native` component below picks up the field-register density and 56pt touch targets.
 *
 * An OTP LoginGate guards the app tree: a rider signs in with their phone number (X-HG-Client
 * `rider-app`), the returned bearer is held in memory, and only then does the work-loop stack
 * (Availability → Offer → Assignment) mount. A reload signs the rider out (V0 — in-memory token).
 */
import * as React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider, Wordmark } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import { NavProvider } from './src/nav';
import { RiderShell } from './src/RiderShell';
import { requestOtp, verifyOtp } from './src/auth';
import { subscribe, isAuthed } from './src/token';

// ---------------------------------------------------------------------------
// OTP LoginGate
// ---------------------------------------------------------------------------

type Phase = 'phone' | 'code';

function LoginGate(): React.ReactElement {
  const [phase, setPhase] = React.useState<Phase>('phone');
  const [phone, setPhone] = React.useState('');
  const [challengeId, setChallengeId] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleSendCode(): Promise<void> {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = await requestOtp(phone.trim());
      setChallengeId(id);
      setPhase('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(): Promise<void> {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(challengeId, code.trim());
      // token.ts notifies subscribers → useSyncExternalStore fires → App re-renders
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <View style={styles.brand}>
          <Wordmark height={56} />
        </View>
        <Text style={styles.title}>Rider sign in</Text>

        {phase === 'phone' ? (
          <>
            <Text style={styles.label}>Phone number (e.g. +14165550100)</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 416 555 0100"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!busy}
              accessibilityLabel="Phone number"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send code</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>Enter the code sent to {phone}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              editable={!busy}
              accessibilityLabel="Verification code"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </Pressable>
            <Pressable
              style={styles.link}
              onPress={() => { setPhase('phone'); setError(null); setCode(''); }}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>Change number</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  // The logo from @hg/ui-native — the same geometry as every other surface (packages/brand).
  brand: { alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#111', marginBottom: 8 },
  label: { fontSize: 14, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
  },
  button: {
    backgroundColor: '#1a7a4a',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 13 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: '#1a7a4a', fontSize: 14 },
});

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement | null {
  const authed = React.useSyncExternalStore(subscribe, isAuthed, isAuthed);
  // Plus Jakarta Sans (--hg-font-ui's RN counterpart) must be registered before anything under
  // `ThemeProvider` renders — `typeStyle()` names these exact face strings. Render nothing (the
  // Expo splash screen stays up) until it resolves; a font load error still renders safely, RN
  // falls back to the system font, so we don't block on it.
  const { fontsLoaded } = useHgFonts();

  if (!fontsLoaded) {
    return null;
  }

  if (!authed) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <LoginGate />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider theme="rider" scheme="light">
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <View style={{ flex: 1 }}>
            <NavProvider>
              <RiderShell />
            </NavProvider>
          </View>
        </SafeAreaView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
