/**
 * HalalGoes — Rider app root.
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
import { ThemeProvider, useTheme, Wordmark } from '@hg/ui-native';
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
  // Inside ThemeProvider (see the root below), so colours come from the rider
  // register. They were raw hexes because this branch mounted outside it.
  const theme = useTheme();
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
      style={[styles.flex, { backgroundColor: theme.color.surface.base }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <View style={styles.brand}>
          <Wordmark height={56} />
        </View>
        <Text style={[styles.title, { color: theme.color.text.primary }]}>Rider sign in</Text>

        {phase === 'phone' ? (
          <>
            <Text style={[styles.label, { color: theme.color.text.secondary }]}>Phone number (e.g. +14165550100)</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.color.border.interactive, color: theme.color.text.primary }]}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 416 555 0100"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!busy}
              accessibilityLabel="Phone number"
            />
            {error ? <Text style={[styles.error, { color: theme.color.feedback.danger.text }]}>{error}</Text> : null}
            <Pressable
              style={[styles.button, { backgroundColor: theme.color.action.primary }, busy && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={theme.color.text.onBrand} />
              ) : (
                <Text style={[styles.buttonText, { color: theme.color.text.onBrand }]}>Send code</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: theme.color.text.secondary }]}>Enter the code sent to {phone}</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.color.border.interactive, color: theme.color.text.primary }]}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              editable={!busy}
              accessibilityLabel="Verification code"
            />
            {error ? <Text style={[styles.error, { color: theme.color.feedback.danger.text }]}>{error}</Text> : null}
            <Pressable
              style={[styles.button, { backgroundColor: theme.color.action.primary }, busy && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={theme.color.text.onBrand} />
              ) : (
                <Text style={[styles.buttonText, { color: theme.color.text.onBrand }]}>Verify</Text>
              )}
            </Pressable>
            <Pressable
              style={styles.link}
              onPress={() => { setPhase('phone'); setError(null); setCode(''); }}
              accessibilityRole="button"
            >
              <Text style={[styles.linkText, { color: theme.color.action.primary }]}>Change number</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  // The logo from @hg/ui-native — the same geometry as every other surface (packages/brand).
  brand: { alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    // Colour applied from the theme at the usage site: action.primary. Solid
    // green here broke the rule that solid green is reserved for halal status
    // (AGENTS.md "Non-negotiable invariants"): green is the seal, never 'tap here'.
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  error: { fontSize: 13 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 14 },
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
    // ThemeProvider wraps this branch too. It used to wrap only the
    // authenticated one, so the sign-in gate — the first screen every rider
    // sees — rendered with no design system and hard-coded its own palette.
    return (
      <SafeAreaProvider>
        <ThemeProvider theme="rider" scheme="light">
          <StatusBar style="dark" />
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
            <LoginGate />
          </SafeAreaView>
        </ThemeProvider>
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
