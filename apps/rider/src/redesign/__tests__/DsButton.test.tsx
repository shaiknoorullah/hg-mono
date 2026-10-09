/**
 * The whole NativeWind chain, end to end, under jest (redesign, N0):
 *
 *   docs/design/tokens.json → generated global.rider.css (hex variables) + preset
 *     → Tailwind 3 with this app's tailwind.config.js → NativeWind's CSS-to-RN compiler
 *     → `className` on the RNR-style Button in @hg/ui-native/lib → a native style object.
 *
 * Metro does the compile in the app; here it is done once in `beforeAll` and registered with
 * react-native-css-interop's test runtime. If a token, the alias table, the preset or the
 * singleton wiring breaks, these colours stop arriving.
 */
import * as React from 'react';
import { StyleSheet } from 'react-native';
import { registerCSS, render, screen, setupAllComponents, resetData, act } from 'react-native-css-interop/test';
import { colorScheme } from 'react-native-css-interop';
import { Button, Text } from '@hg/ui-native/lib';

const { compileRiderCss, UI_NATIVE_LIB } = require('../../../jest.nativewind.cjs') as {
  compileRiderCss: (content: string[]) => Promise<{ css: string; options: object }>;
  UI_NATIVE_LIB: string;
};

let compiled: { css: string; options: object };

beforeAll(async () => {
  compiled = await compileRiderCss([`${UI_NATIVE_LIB}/**/*.tsx`]);
}, 60_000);

beforeEach(() => {
  resetData();
  setupAllComponents();
  registerCSS(compiled.css, compiled.options);
});

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

/** NativeWind's compiler normalises hex to lower case; tokens.json writes upper case. */
const hex = (value: unknown) => String(value).toUpperCase();

describe('RNR Button styled by NativeWind from the generated rider tokens', () => {
  it('primary: brand fill, onBrand label (never white), 44pt target', () => {
    render(
      <Button>
        <Text>Go online</Text>
      </Button>,
    );
    const button = flat(screen.getByRole('button'));
    expect(hex(button.backgroundColor)).toBe('#F1521E');
    expect(button.minHeight).toBe(44);
    expect(hex(flat(screen.getByText('Go online')).color)).toBe('#0F241C');
  });

  it('field size is the 56pt rider target', () => {
    render(
      <Button size="field">
        <Text>Accept</Text>
      </Button>,
    );
    expect(flat(screen.getByRole('button')).minHeight).toBe(56);
  });

  it('outline uses the interactive border role', () => {
    render(
      <Button variant="outline">
        <Text>Details</Text>
      </Button>,
    );
    const button = flat(screen.getByRole('button'));
    expect(hex(button.borderColor)).toBe('#8B8578');
    expect(hex(button.backgroundColor)).toBe('#FFFAEA');
  });

  it('dark scheme flips through .dark:root', () => {
    act(() => colorScheme.set('dark'));
    try {
      render(
        <Button variant="outline">
          <Text>Details</Text>
        </Button>,
      );
      expect(hex(flat(screen.getByRole('button')).backgroundColor)).toBe('#171717');
      expect(hex(flat(screen.getByText('Details')).color)).toBe('#F6EFDD');
    } finally {
      act(() => colorScheme.set('light'));
    }
  });
});
