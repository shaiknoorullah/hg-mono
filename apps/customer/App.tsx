/**
 * HalalGoes — customer app entry.
 *
 * It wraps the tree in the design system's `ThemeProvider` under this app's register (`customer`,
 * `light` scheme) and a `SafeAreaProvider`, then mounts the customer journey behind a small
 * in-app stack `Router`: Discovery → Restaurant → Cart → Checkout → Tracking. Everything
 * domain-shaped comes from `@hg/api-client` against the real backend; every visible component
 * comes from `@hg/ui-native`.
 *
 * An OTP LoginGate guards the app tree. Discovery browse is anonymous per the contract
 * (`availability.state: NO_ADDRESS`), but for V0 the gate fires before the tree renders,
 * keeping the implementation simple until anonymous browse is needed separately.
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, setClientErrorReporter, Wordmark } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import { Router } from './src/navigation/Router';
import { requestOtp, verifyOtp } from './src/api/auth';
import { subscribe, isAuthed } from './src/api/token';

// ---------------------------------------------------------------------------
// OTP LoginGate
// ---------------------------------------------------------------------------

type Phase = 'phone' | 'code';

function LoginGate(): React.ReactElement {
  // The gate renders inside ThemeProvider (see the root below), so its colours
  // come from the register like every other surface. They used to be raw hexes
  // because this branch mounted OUTSIDE the provider and had no theme to read.
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
        <Text style={[styles.title, { color: theme.color.text.primary }]}>Sign in</Text>

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
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    // Colour is applied from the theme at the usage site: action.primary. A
    // solid green here broke the rule that solid green is reserved for halal
    // status (AGENTS.md "Non-negotiable invariants"): green is the verification
    // seal, never "tap here". The no-green lint could not see it because this
    // app declared no lint script.
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    fontSize: 13,
  },
  link: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
  },
});

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement | null {
  const authed = React.useSyncExternalStore(subscribe, isAuthed, isAuthed);
  // Plus Jakarta Sans (the design system's `--hg-font-ui` counterpart), loaded once at the root
  // before anything renders — `ThemeProvider`'s `typeStyle()` emits these exact face names.
  // `fontError` still renders (RN falls back to the system font); only the loading gate blocks.
  const { fontsLoaded, fontError } = useHgFonts();

  React.useEffect(() => {
    // Unmapped enum values (halal states, error codes) report rather than crash. In this scaffold
    // we log them; a real build would forward to telemetry.
    setClientErrorReporter((code) => {
      // eslint-disable-next-line no-console
      console.warn('[hg-customer] client error reported:', code);
    });
  }, []);

  React.useEffect(() => {
    if (fontError) {
      // eslint-disable-next-line no-console
      console.warn('[hg-customer] font load error, falling back to system font:', fontError);
    }
  }, [fontError]);

  if (!fontsLoaded) {
    // Keep the Expo splash screen up rather than flashing an unstyled frame.
    return null;
  }

  // ThemeProvider wraps BOTH branches. It used to wrap only the authenticated
  // one, so the sign-in gate — the first screen every customer sees — rendered
  // with no design system at all and hard-coded its own palette.
  return (
    <SafeAreaProvider>
      <ThemeProvider theme="customer" scheme="light">
        <StatusBar style="dark" />
        {authed ? <Router /> : <LoginGate />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
