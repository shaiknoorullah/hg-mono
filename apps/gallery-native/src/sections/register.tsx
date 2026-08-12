/**
 * Section 02 — the register switch, put on trial.
 *
 * The design system's central structural claim is that `customer` and `rider` are the *same*
 * components and differ only by tokens: no component forks on the register, the rider's 56 dp
 * touch floor, roomy density and body.lg default all arrive as theme values. This section proves
 * it two ways — a live side-by-side of identical JSX under both registers, and a mechanical diff
 * of the two theme objects computed at render time.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Button, Chip, Input, Switch, themes, useTheme } from '@hg/ui-native';
import type { Theme } from '@hg/ui-native';

import {
  Claim,
  ForceRegister,
  Mono,
  Note,
  Section,
  Subsection,
  Surface,
  useChrome,
  useControls,
} from '../chrome';
import type { SectionMeta } from '../chrome';

export const meta: SectionMeta = {
  id: '02-register',
  title: 'Customer vs rider register',
  blurb:
    'Two registers: customer is appetite, rider is field — sunlight-readable, one-handed, roomy, 56 dp targets. The claim under review is that they are the same components with different tokens. The global REGISTER control at the top drives every other section; this one shows both at once.',
};

/* ------------------------------------------------------------------ mechanical diff */

interface Diff {
  path: string;
  customer: string;
  rider: string;
}

function flatten(value: unknown, prefix: string, out: Record<string, string>): void {
  if (value === null || typeof value !== 'object') {
    out[prefix] = String(value);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function diffThemes(a: Theme, b: Theme): { diffs: Diff[]; total: number } {
  const flatA: Record<string, string> = {};
  const flatB: Record<string, string> = {};
  flatten(a, '', flatA);
  flatten(b, '', flatB);
  const keys = Array.from(new Set([...Object.keys(flatA), ...Object.keys(flatB)])).sort();
  const diffs: Diff[] = [];
  for (const key of keys) {
    // `name` and `register` are the identity of the theme, not a design difference.
    if (key === 'name' || key === 'register') continue;
    if (flatA[key] !== flatB[key]) {
      diffs.push({ path: key, customer: flatA[key] ?? '—', rider: flatB[key] ?? '—' });
    }
  }
  return { diffs, total: keys.length };
}

function DiffTable() {
  const { scheme } = useControls();
  const c = useChrome();
  const { diffs, total } = React.useMemo(
    () => diffThemes(themes.customer[scheme] as Theme, themes.rider[scheme] as Theme),
    [scheme],
  );
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? diffs : diffs.slice(0, 14);

  const groups = React.useMemo(() => {
    const byGroup: Record<string, number> = {};
    for (const d of diffs) {
      const g = d.path.split('.').slice(0, 2).join('.');
      byGroup[g] = (byGroup[g] ?? 0) + 1;
    }
    return Object.entries(byGroup).sort((x, y) => y[1] - x[1]);
  }, [diffs]);

  return (
    <View style={{ gap: 12 }}>
      <Note>
        Computed live from `themes.customer.{scheme}` against `themes.rider.{scheme}` — {diffs.length}{' '}
        of {total} token leaves differ. Every one of them is a value inside the theme object. There
        is no entry here for a component, a layout or a behaviour, because there is no code path
        that forks on the register.
      </Note>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {groups.map(([g, n]) => (
          <View
            key={g}
            style={{
              borderWidth: 1,
              borderColor: c.line,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
              backgroundColor: c.panel,
            }}
          >
            <Mono size={10} color={c.ink}>
              {g} · {n}
            </Mono>
          </View>
        ))}
      </View>

      <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', backgroundColor: c.caseBg, padding: 10, gap: 12 }}>
          <View style={{ flex: 3 }}>
            <Mono size={10} color={c.ink}>
              TOKEN PATH
            </Mono>
          </View>
          <View style={{ flex: 2 }}>
            <Mono size={10} color={c.ink}>
              CUSTOMER
            </Mono>
          </View>
          <View style={{ flex: 2 }}>
            <Mono size={10} color={c.ink}>
              RIDER
            </Mono>
          </View>
        </View>
        {shown.map((d, i) => (
          <View
            key={d.path}
            style={{
              flexDirection: 'row',
              padding: 10,
              gap: 12,
              backgroundColor: i % 2 ? c.panel : 'transparent',
              borderTopWidth: 1,
              borderTopColor: c.line,
            }}
          >
            <View style={{ flex: 3 }}>
              <Mono size={10} color={c.ink}>
                {d.path}
              </Mono>
            </View>
            <View style={{ flex: 2 }}>
              <Mono size={10}>{d.customer}</Mono>
            </View>
            <View style={{ flex: 2 }}>
              <Mono size={10}>{d.rider}</Mono>
            </View>
          </View>
        ))}
      </View>

      {diffs.length > 14 ? (
        <Text
          accessibilityRole="button"
          onPress={() => setExpanded((e) => !e)}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: c.accent }}
        >
          {expanded ? '− collapse' : `+ show all ${diffs.length} differing tokens`}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------- live side-by-side */

/** Exactly this JSX is rendered twice. The only difference between the panes is the provider. */
function IdenticalTree() {
  const theme = useTheme();
  const [on, setOn] = React.useState(true);
  const [text, setText] = React.useState('');
  return (
    <View style={{ gap: 14 }}>
      <Button variant="primary" size="lg" fullWidth onPress={() => undefined}>
        Accept delivery
      </Button>
      <Button variant="tertiary" onPress={() => undefined}>
        View details
      </Button>
      <Input label="Buzzer code" value={text} onChange={setText} placeholder="4211" />
      <Switch checked={on} onChange={setOn} label="Available for offers" stateLabels={{ on: 'Online', off: 'Offline' }} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Biryani" variant="filter" selected />
        <Chip label="Under 30 min" variant="filter" />
      </View>
      <Mono size={9}>
        target.min {theme.target.min} · density {theme.densityMode} · cardPadding{' '}
        {theme.density.cardPadding} · body.md {theme.typography['body.md'].fontSize}px
      </Mono>
    </View>
  );
}

function RegisterPane({ register }: { register: 'customer' | 'rider' }) {
  const c = useChrome();
  return (
    <View style={{ flex: 1, minWidth: 320, gap: 8 }}>
      <Mono size={11} color={c.ink}>
        {'<ThemeProvider theme="' + register + '">'}
      </Mono>
      <ForceRegister theme={register}>
        <Surface fill>
          <IdenticalTree />
        </Surface>
      </ForceRegister>
    </View>
  );
}

export function RegisterSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <Subsection title="Same JSX, two providers">
        <Claim>
          Both panes below render one shared `IdenticalTree()` component — the identical element
          tree, the identical props. The only thing that differs is the `theme` prop on the
          `ThemeProvider` above them. Larger controls, roomier padding and bigger body text on the
          right are token consequences, not branches.
        </Claim>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
          <RegisterPane register="customer" />
          <RegisterPane register="rider" />
        </View>
      </Subsection>

      <Subsection title="Every token that differs">
        <DiffTable />
      </Subsection>
    </Section>
  );
}
