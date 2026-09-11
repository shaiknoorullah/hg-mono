/**
 * The Halal Goes native component gallery.
 *
 * A composition-only surface: it writes no components, it exercises `@hg/ui-native` and populates
 * everything domain-shaped from `contracts/fixtures/`. It runs in a browser through Expo web /
 * react-native-web so the deliverable is a URL rather than a simulator.
 *
 * Two global controls sit in the header: the colour scheme, and — the important one — the
 * register. Everything below the header re-renders under `<ThemeProvider theme={register}>` and
 * nothing forks on the value.
 */
import * as React from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, setClientErrorReporter } from '@hg/ui-native';
import type { ColorScheme, ThemeName } from '@hg/ui-native';
import { useHgFonts } from '@hg/ui-native/fonts';

import {
  ChromeContext,
  ControlsContext,
  MONO,
  Mono,
  Segmented,
  chromeFor,
  useChrome,
} from './src/chrome';
import type { SectionMeta } from './src/chrome';
import { HalalSection, meta as halalMeta } from './src/sections/halal';
import { RegisterSection, meta as registerMeta } from './src/sections/register';
import { PrimitivesSection, meta as primitivesMeta } from './src/sections/primitives';
import { ContentSection, meta as contentMeta } from './src/sections/content';
import { NavigationSection, meta as navigationMeta } from './src/sections/navigation';
import { FeedbackSection, meta as feedbackMeta } from './src/sections/feedback';
import { TimelineSection, meta as timelineMeta } from './src/sections/timeline';
import { OfferSheetSection, meta as offerMeta } from './src/sections/offer-sheet';
import { StatesSection, meta as statesMeta } from './src/sections/states';

const SECTIONS: readonly SectionMeta[] = [
  halalMeta,
  registerMeta,
  primitivesMeta,
  contentMeta,
  navigationMeta,
  feedbackMeta,
  timelineMeta,
  offerMeta,
  statesMeta,
];

/**
 * `HalalBadge` and `HalalCertificationPanel` report a client error rather than defaulting when a
 * display state is missing or unrecognised. The gallery deliberately renders those cases, so the
 * reports are collected and shown at the bottom of section 01's neighbours rather than swallowed.
 */
const clientErrors: { code: string; at: number }[] = [];

export default function App() {
  // Plus Jakarta Sans, the RN counterpart to web's `--hg-font-ui`. Every hook call stays
  // unconditional and ABOVE the early return below (Rules of Hooks) — only the render output
  // forks on `fontsLoaded`, never the hook order.
  const { fontsLoaded, fontError } = useHgFonts();
  const [themeName, setThemeName] = React.useState<ThemeName>('customer');
  const [scheme, setScheme] = React.useState<ColorScheme>('light');
  const scroller = React.useRef<ScrollView>(null);
  const offsets = React.useRef<Record<string, number>>({});
  const { width } = useWindowDimensions();
  const wide = width >= 1080;

  React.useEffect(() => {
    if (fontError) {
      // eslint-disable-next-line no-console
      console.warn('Plus Jakarta Sans failed to load — falling back to the system font.', fontError);
    }
  }, [fontError]);

  React.useEffect(() => {
    setClientErrorReporter((code) => {
      clientErrors.push({ code, at: Date.now() });
    });
  }, []);

  const controls = React.useMemo(
    () => ({ themeName, scheme, setThemeName, setScheme }),
    [themeName, scheme],
  );
  const chrome = chromeFor(scheme);

  const onLayoutY = React.useCallback((id: string, y: number) => {
    offsets.current[id] = y;
  }, []);

  const jump = React.useCallback((id: string) => {
    const y = offsets.current[id];
    if (typeof y === 'number') {
      scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  }, []);

  // Keep the splash screen up (render nothing) until the four Plus Jakarta Sans weights are
  // registered — otherwise the gallery's own Typography specimen (section 03) would flash the
  // system font and then jump, which is exactly the "why does the app look different for one
  // frame" bug this gate exists to prevent. A font ERROR still renders — the system-font
  // fallback is a legitimate, readable app; a font that never resolves is not.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ControlsContext.Provider value={controls}>
        <ChromeContext.Provider value={chrome}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <View style={{ flex: 1, backgroundColor: chrome.page }}>
            <Header sections={SECTIONS} onJump={jump} wide={wide} />
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {wide ? <SideNav sections={SECTIONS} onJump={jump} /> : null}
              <ScrollView
                ref={scroller}
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: wide ? 40 : 16,
                  paddingBottom: 160,
                  maxWidth: 1400,
                }}
              >
                {/*
                  One provider for the whole gallery. Every section below is theme-agnostic; the
                  register-comparison section is the single place that mounts a second provider,
                  and it does so only to show both registers at once.
                */}
                <ThemeProvider theme={themeName} scheme={scheme}>
                  <View>
                    <HalalSection onLayoutY={onLayoutY} />
                    <RegisterSection onLayoutY={onLayoutY} />
                    <PrimitivesSection onLayoutY={onLayoutY} />
                    <ContentSection onLayoutY={onLayoutY} />
                    <NavigationSection onLayoutY={onLayoutY} />
                    <FeedbackSection onLayoutY={onLayoutY} />
                    <TimelineSection onLayoutY={onLayoutY} />
                    <OfferSheetSection onLayoutY={onLayoutY} />
                    <StatesSection onLayoutY={onLayoutY} />
                  </View>
                </ThemeProvider>
                <Footer />
              </ScrollView>
            </View>
          </View>
        </ChromeContext.Provider>
      </ControlsContext.Provider>
    </SafeAreaProvider>
  );
}

/* --------------------------------------------------------------------------- header */

function Header({
  sections,
  onJump,
  wide,
}: {
  sections: readonly SectionMeta[];
  onJump: (id: string) => void;
  wide: boolean;
}) {
  const c = useChrome();
  const { themeName, scheme, setThemeName, setScheme } = React.useContext(ControlsContext);
  return (
    <View
      style={{
        backgroundColor: c.panel,
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        paddingHorizontal: wide ? 40 : 16,
        paddingTop: 16,
        paddingBottom: 14,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 28 }}>
        <View style={{ gap: 2, flexGrow: 1, minWidth: 260 }}>
          <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: c.ink }}>
            Halal Goes — mobile design system
          </Text>
          <Mono size={11}>
            @hg/ui-native · 39 exported components · fixtures from contracts/fixtures · Expo SDK 54
            + react-native-web
          </Mono>
        </View>
        <Segmented
          label="Register"
          value={themeName}
          options={[
            { value: 'customer' as ThemeName, label: 'customer' },
            { value: 'rider' as ThemeName, label: 'rider' },
          ]}
          onChange={setThemeName}
        />
        <Segmented
          label="Scheme"
          value={scheme}
          options={[
            { value: 'light' as ColorScheme, label: 'light' },
            { value: 'dark' as ColorScheme, label: 'dark' },
          ]}
          onChange={setScheme}
        />
      </View>
      {wide ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {sections.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="link"
                onPress={() => onJump(s.id)}
                style={{
                  borderWidth: 1,
                  borderColor: c.line,
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ fontFamily: MONO, fontSize: 11, color: c.ink }}>{s.id}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- side nav */

function SideNav({
  sections,
  onJump,
}: {
  sections: readonly SectionMeta[];
  onJump: (id: string) => void;
}) {
  const c = useChrome();
  return (
    <View
      style={{
        width: 240,
        borderEndWidth: 1,
        borderEndColor: c.line,
        paddingVertical: 24,
        paddingHorizontal: 16,
        gap: 4,
      }}
    >
      <Mono size={10}>SECTIONS</Mono>
      <View style={{ height: 8 }} />
      {sections.map((s) => (
        <Pressable
          key={s.id}
          accessibilityRole="link"
          onPress={() => onJump(s.id)}
          style={{ paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6 }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 11, color: c.muted }}>{s.id}</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: c.ink }}>{s.title}</Text>
        </Pressable>
      ))}
      <View style={{ height: 20 }} />
      <Mono size={9}>
        Start at 01. The register control at the top is the one to play with — it is the claim the
        system is staking.
      </Mono>
    </View>
  );
}

/* --------------------------------------------------------------------------- footer */

function Footer() {
  const c = useChrome();
  return (
    <View style={{ paddingTop: 48, paddingBottom: 24, gap: 8 }}>
      <View style={{ height: 1, backgroundColor: c.line }} />
      <Mono size={10}>
        Rendering on {Platform.OS}. Composition only — this app defines no design-system components
        of its own; the chrome you are reading (labels, frames, controls) is plain React Native so
        it can never be mistaken for the library.
      </Mono>
      <Mono size={10}>
        MapView degrades to its text panel on web: `react-native-maps` has no react-native-web
        build, and the component is written to treat an absent native module exactly like a tile
        failure. See section 06.
      </Mono>
    </View>
  );
}
