/**
 * Gallery chrome — deliberately not built from `@hg/ui-native`.
 *
 * Everything in this file is plain React Native so that nothing on screen is ambiguous: if it is
 * grey, monospaced and labelled, it is scaffolding; if it is anything else, it is the design
 * system under review. The chrome also keys its colours off the *scheme* only, never off the
 * register, so that flipping customer→rider changes the specimens and nothing else.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ColorScheme, ThemeName } from '@hg/ui-native';
import { ThemeProvider } from '@hg/ui-native';

/* ------------------------------------------------------------------ controls context */

export interface GalleryControls {
  themeName: ThemeName;
  scheme: ColorScheme;
  setThemeName: (next: ThemeName) => void;
  setScheme: (next: ColorScheme) => void;
}

export const ControlsContext = React.createContext<GalleryControls>({
  themeName: 'customer',
  scheme: 'light',
  setThemeName: () => undefined,
  setScheme: () => undefined,
});

export function useControls(): GalleryControls {
  return React.useContext(ControlsContext);
}

/* ------------------------------------------------------------------- chrome palette */

export interface ChromePalette {
  page: string;
  panel: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  caseBg: string;
  warn: string;
}

const CHROME: Record<ColorScheme, ChromePalette> = {
  light: {
    page: '#F4F4F2',
    panel: '#FFFFFF',
    ink: '#17161A',
    muted: '#5B5960',
    line: '#DDDCD8',
    accent: '#134E4A',
    accentInk: '#FFFFFF',
    caseBg: '#EDECE8',
    warn: '#8A4B00',
  },
  dark: {
    page: '#0B0B0D',
    panel: '#151518',
    ink: '#F5F5F3',
    muted: '#A3A1A8',
    line: '#2A2A2F',
    accent: '#5EEAD4',
    accentInk: '#04211E',
    caseBg: '#1E1E22',
    warn: '#F0B37E',
  },
};

export const ChromeContext = React.createContext<ChromePalette>(CHROME.light);
export function useChrome(): ChromePalette {
  return React.useContext(ChromeContext);
}
export function chromeFor(scheme: ColorScheme): ChromePalette {
  return CHROME[scheme];
}

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* ------------------------------------------------------------------------ text bits */

export function Mono({
  children,
  size = 12,
  color,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
}) {
  const c = useChrome();
  return (
    <Text style={{ fontFamily: MONO, fontSize: size, lineHeight: size * 1.5, color: color ?? c.muted }}>
      {children}
    </Text>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  const c = useChrome();
  return (
    <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted, maxWidth: 760 }}>{children}</Text>
  );
}

/** A claim the gallery is making, so the reviewer knows what to check. */
export function Claim({ children }: { children: React.ReactNode }) {
  const c = useChrome();
  return (
    <View
      style={{
        borderStartWidth: 3,
        borderStartColor: c.accent,
        paddingStart: 12,
        paddingVertical: 4,
        maxWidth: 760,
      }}
    >
      <Text style={{ fontSize: 13, lineHeight: 20, color: c.ink }}>{children}</Text>
    </View>
  );
}

/** Marks a specimen whose state was forced by a prop rather than reached organically. */
export function Forced({ children }: { children: React.ReactNode }) {
  const c = useChrome();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: c.warn,
        borderStyle: 'dashed',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.4, color: c.warn }}>
        {children}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- sections */

export interface SectionMeta {
  id: string;
  title: string;
  blurb: string;
}

export function Section({
  meta,
  onLayoutY,
  children,
}: {
  meta: SectionMeta;
  onLayoutY?: (id: string, y: number) => void;
  children: React.ReactNode;
}) {
  const c = useChrome();
  return (
    <View
      nativeID={meta.id}
      onLayout={(e) => onLayoutY?.(meta.id, e.nativeEvent.layout.y)}
      style={{ paddingTop: 40, paddingBottom: 16 }}
    >
      <View style={{ gap: 8, marginBottom: 20 }}>
        <Mono size={11} color={c.accent}>
          {meta.id}
        </Mono>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 30, lineHeight: 36, fontWeight: '700', color: c.ink }}
        >
          {meta.title}
        </Text>
        <Note>{meta.blurb}</Note>
      </View>
      <View style={{ gap: 28 }}>{children}</View>
    </View>
  );
}

export function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useChrome();
  return (
    <View style={{ gap: 16 }}>
      <View style={{ borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 8 }}>
        <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: '700', color: c.ink }}>
          {title}
        </Text>
      </View>
      <View style={{ gap: 20 }}>{children}</View>
    </View>
  );
}

/**
 * One specimen. `label` names the component and the state; `code` shows the props that produced
 * it, because "every declared state" is only checkable if the reviewer can see what was passed.
 */
export function Case({
  label,
  code,
  note,
  forced,
  surface = true,
  fill = false,
  children,
}: {
  label: string;
  code?: string;
  note?: string;
  forced?: string;
  surface?: boolean;
  /** Let the specimen span the case's full width (cards, banners, timelines). */
  fill?: boolean;
  children: React.ReactNode;
}) {
  const c = useChrome();
  return (
    <View style={{ gap: 6, minWidth: fill ? '100%' : undefined, flexGrow: fill ? 1 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: c.ink, letterSpacing: 0.2 }}>
          {label}
        </Text>
        {forced ? <Forced>{forced}</Forced> : null}
      </View>
      {code ? <Mono size={10}>{code}</Mono> : null}
      {surface ? <Surface fill={fill}>{children}</Surface> : <View>{children}</View>}
      {note ? <Mono size={10}>{note}</Mono> : null}
    </View>
  );
}

/** Paints the library theme's own `surface.base` so specimens sit on their real ground. */
export function Surface({ fill, children }: { fill?: boolean; children: React.ReactNode }) {
  const c = useChrome();
  return (
    <ThemeSurface>
      {(bg) => (
        <View
          style={{
            backgroundColor: bg,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 10,
            padding: 16,
            alignSelf: fill ? 'stretch' : 'flex-start',
            minWidth: fill ? '100%' : 0,
          }}
        >
          {children}
        </View>
      )}
    </ThemeSurface>
  );
}

/* `useTheme` lives behind a render-prop so `Surface` stays usable outside a themed subtree. */
import { useTheme } from '@hg/ui-native';
function ThemeSurface({ children }: { children: (bg: string) => React.ReactElement }) {
  const theme = useTheme();
  return children(theme.color.surface.base);
}

/** A horizontal shelf of specimens that wraps. */
export function Shelf({ children, align = 'flex-start' }: { children: React.ReactNode; align?: 'flex-start' | 'flex-end' | 'center' }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: align }}>
      {children}
    </View>
  );
}

/** A fixed-width column stack, for side-by-side comparisons. */
export function Column({ width = 320, children }: { width?: number; children: React.ReactNode }) {
  return <View style={{ width, gap: 16 }}>{children}</View>;
}

/* -------------------------------------------------------------------------- controls */

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const c = useChrome();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, color: c.muted }}>
        {label.toUpperCase()}
      </Text>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: c.panel,
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${o.label}`}
              onPress={() => onChange(o.value)}
              style={{
                paddingHorizontal: 14,
                minHeight: 36,
                justifyContent: 'center',
                backgroundColor: active ? c.accent : 'transparent',
              }}
            >
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  color: active ? c.accentInk : c.ink,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ChromeButton({
  label,
  onPress,
  active = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const c = useChrome();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        minHeight: 32,
        justifyContent: 'center',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: active ? c.accent : c.line,
        backgroundColor: active ? c.accent : 'transparent',
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 11, color: active ? c.accentInk : c.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ themed sub-trees */

/**
 * Renders a subtree under a *specific* register regardless of the global control. Used only by the
 * register-comparison section, which has to show both at once.
 */
export function ForceRegister({
  theme,
  children,
}: {
  theme: ThemeName;
  children: React.ReactNode;
}) {
  const { scheme } = useControls();
  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      {children}
    </ThemeProvider>
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
});
