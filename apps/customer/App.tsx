/**
 * HalalGoes — customer app entry.
 *
 * It wraps the tree in the design system's `ThemeProvider` under this app's register (`customer`,
 * `light` scheme) and a `SafeAreaProvider`, then shows one of three things, by the sign-in phase
 * (`src/signin/session.ts`):
 *
 * - **Sign in** (`SignInScreen`): phone, code, and the routes the server can force. Sign-in comes
 *   first: nobody browses before signing in (owner decision, Sign-in canvas). Deny by default —
 *   the protected tree is not mounted until a session exists.
 * - **Your details** (`ProfileCaptureScreen`): a new customer, or one with no first name.
 * - **The app** behind a small in-app stack `Router`, opened where sign-in decided (Home, the
 *   active order, or the first-run address step), with one greeting toast.
 *
 * Everything domain-shaped comes from `@hg/api-client` against the real backend; every visible
 * component comes from `@hg/ui-native`.
 */
import * as React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, Toast, setClientErrorReporter } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import { Router } from './src/navigation/Router';
import { OrderingPauseProvider } from './src/ordering/orderingPause';
import { StripeRoot } from './src/payments/StripeRoot';
import { subscribe, isAuthed } from './src/api/token';
import { clearWelcome, useSession } from './src/signin/session';
import { SignInScreen } from './src/screens/SignInScreen';
import { ProfileCaptureScreen } from './src/screens/ProfileCaptureScreen';

/**
 * The greeting after sign-in ("You're signed in · Welcome back, Aisha."). Docked at the top, under
 * the app bar, so it never covers the cart bar or the tabs a returning customer may need first.
 */
function WelcomeToast(): React.ReactElement | null {
  const { welcome } = useSession();
  // A greeting carries nothing to act on, so it always leaves: the Toast's own timer pauses
  // while a screen reader runs (and react-native-web reports one as always running), which
  // would otherwise pin it over whatever screen the customer opens next.
  React.useEffect(() => {
    if (!welcome) return;
    const t = setTimeout(clearWelcome, 8000);
    return () => clearTimeout(t);
  }, [welcome]);
  if (!welcome) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, top: 64 }}>
      <Toast
        variant={welcome.variant}
        title={welcome.title}
        description={welcome.description}
        onDismiss={clearWelcome}
        testID="WelcomeToast"
      />
    </View>
  );
}

function Gate(): React.ReactElement {
  const authed = React.useSyncExternalStore(subscribe, isAuthed, isAuthed);
  const { phase, landing } = useSession();
  // The sign-in screen stays mounted while a verified session is being routed (its "Checking
  // code" state), so the token arriving does not flash the app before the route is decided.
  if (!authed || phase === 'signin') return <SignInScreen />;
  if (phase === 'profile') return <ProfileCaptureScreen />;
  return (
    <OrderingPauseProvider>
      <Router initial={landing} />
      <WelcomeToast />
    </OrderingPauseProvider>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement | null {
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

  // ThemeProvider wraps every branch, so the sign-in screen — the first screen every customer
  // sees — renders with the design system like every other surface.
  return (
    <StripeRoot>
    <SafeAreaProvider>
      <ThemeProvider theme="customer" scheme="light">
        <StatusBar style="dark" />
        <Gate />
      </ThemeProvider>
    </SafeAreaProvider>
    </StripeRoot>
  );
}
