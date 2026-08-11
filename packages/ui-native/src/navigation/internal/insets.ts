/**
 * Safe-area insets for the chrome components.
 *
 * `react-native-safe-area-context` is an optional peer, and even where it is installed the app may
 * not have mounted a `SafeAreaProvider` yet. Both cases have to render: an `AppBar` that throws
 * because a provider is missing is a worse failure than an `AppBar` sitting 44 dp too high.
 *
 * So this reads `SafeAreaInsetsContext` directly rather than calling `useSafeAreaInsets()`, which
 * throws when there is no provider. The context object is resolved once at module load — never per
 * render — so hook order is stable whether or not the module is present.
 */
import { createContext, useContext } from 'react';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

type InsetsContext = React.Context<Insets | null>;

function resolveContext(): InsetsContext | null {
  try {
    const mod = (require as (id: string) => Record<string, unknown>)(
      'react-native-safe-area-context',
    );
    const ctx = mod.SafeAreaInsetsContext;
    return ctx && typeof ctx === 'object' ? (ctx as InsetsContext) : null;
  } catch {
    return null;
  }
}

const InsetsContext: InsetsContext = resolveContext() ?? createContext<Insets | null>(null);

function useInsets(): Insets {
  return useContext(InsetsContext) ?? ZERO;
}

export function useTopInset(): number {
  return useInsets().top;
}

export function useBottomInset(): number {
  return useInsets().bottom;
}
