/* Kit.jsx: shared kit scaffolding, identical in every kit folder (Index, Index2..Index5).
   Two jobs:
   1. KitFrame: the artboard switcher (screen / variant / state) the previews render inside.
   2. Gap placeholders. Every Gap* below stands in for a component the design system does not
      have yet. They are composed only from existing DS components and tokens, and each one is
      marked with data-gap="<ComponentName>" so the preview can outline it ("Show component
      gaps"). Issue #109 (component rebuild) replaces each Gap with the real component; nothing
      here is a new component. Delete this file's Gap section when #109 lands. */
const { Button, Icon, IconButton, Card, Select, SegmentedControl, Switch, Badge } = window.HalalGoesDesignSystem_d11a47;

/* ---------------------------------------------------------------- gap marker */
function Gap({ name, as = 'div', style, children, ...rest }) {
  const Tag = as;
  return <Tag data-gap={name} title={'Component gap: ' + name + ' (placeholder until #109)'} style={style} {...rest}>{children}</Tag>;
}

/* Wordmark: the name is HalalGoes, one word. Gap: Wordmark/Logo. */
function GapWordmark({ size = 20, tone = 'ink', sub }) {
  const color = tone === 'onDark' ? 'var(--color-neutral-0)' : tone === 'text' ? 'var(--text-primary)' : 'var(--color-accent-600)';
  return (
    <Gap name="Wordmark" as="span" style={{ display: 'inline-grid', gap: 2 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size, letterSpacing: '-.03em', color, lineHeight: 1.1 }}>HalalGoes</span>
      {sub && <span style={{ fontSize: 'var(--type-caption-size)', color: tone === 'onDark' ? 'var(--text-on-accent)' : 'var(--text-tertiary)', opacity: tone === 'onDark' ? .8 : 1 }}>{sub}</span>}
    </Gap>
  );
}

/* Skeleton. Gap: Skeleton (exists in @hg/ui-native primitives/Skeleton.tsx). */
function GapSkeleton({ rows = 3, height = 72, media = false, style }) {
  const bar = (w, h = 12) => <span style={{ display: 'block', width: w, height: h, borderRadius: 'var(--radius-xs)', background: 'var(--surface-sunken)' }} />;
  return (
    <Gap name="Skeleton" aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 12, ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'grid', gap: 8, padding: 'var(--space-4)', minHeight: height, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-decorative)', background: 'var(--surface-raised)' }}>
          {media && <span style={{ display: 'block', height: 96, borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }} />}
          {bar('55%', 14)}{bar('80%')}{bar('35%')}
        </div>
      ))}
    </Gap>
  );
}

/* EmptyState. Gap: EmptyState (exists in packages/ui-web + ui-native feedback/EmptyState.tsx). */
function GapEmptyState({ icon = 'search', title, body, action, onAction, secondary, onSecondary, style }) {
  return (
    <Gap name="EmptyState" style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 10, padding: 'var(--space-8) var(--space-5)', ...style }}>
      <span style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', color: 'var(--text-tertiary)' }}>{icon ? <Icon name={icon} size="lg" /> : null}</span>
      <div style={{ fontSize: 'var(--type-heading-md-size)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      {body && <p style={{ margin: 0, maxWidth: 320, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', color: 'var(--text-secondary)' }}>{body}</p>}
      {(action || secondary) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          {action && <Button size="md" onPress={onAction}>{action}</Button>}
          {secondary && <Button size="md" variant="ghost" onPress={onSecondary}>{secondary}</Button>}
        </div>
      )}
    </Gap>
  );
}

/* ErrorState. Gap: ErrorState (exists in packages/ui-web + ui-native feedback/ErrorState.tsx).
   recoverable: a retry. terminal: no retry, a way out. Never red for a halal state. */
function GapErrorState({ title = 'Something went wrong', body, retry = 'Try again', onRetry, terminal = false, exit, onExit, code, style }) {
  return (
    <Gap name="ErrorState" role="alert" style={{ display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 10, padding: 'var(--space-8) var(--space-5)', ...style }}>
      <span style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-full)', background: 'var(--feedback-warning-tint)', color: 'var(--feedback-warning-tint-text)' }}><Icon name={terminal ? 'error' : 'refresh'} size="lg" /></span>
      <div style={{ fontSize: 'var(--type-heading-md-size)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      {body && <p style={{ margin: 0, maxWidth: 320, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', color: 'var(--text-secondary)' }}>{body}</p>}
      {code && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)', color: 'var(--text-tertiary)' }}>{code}</span>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {!terminal && <Button size="md" variant="secondary" iconStart="refresh" onPress={onRetry}>{retry}</Button>}
        {exit && <Button size="md" variant="ghost" onPress={onExit}>{exit}</Button>}
      </div>
    </Gap>
  );
}

/* Persistent inline notice (not a transient Toast). Gap: InlineAlert/Banner.
   tone: info | warning | neutral | success(tint only). Never used in red for halal. */
function GapBanner({ tone = 'info', icon, title, children, action, style }) {
  const T = {
    info: ['var(--feedback-info-tint)', 'var(--feedback-info-tint-text)', 'var(--feedback-info-border)', 'info'],
    warning: ['var(--feedback-warning-tint)', 'var(--feedback-warning-tint-text)', 'var(--feedback-warning-border)', 'warning'],
    neutral: ['var(--surface-sunken)', 'var(--text-secondary)', 'var(--border-decorative)', 'info'],
    success: ['var(--feedback-success-tint)', 'var(--feedback-success-tint-text)', 'var(--feedback-success-border)', 'check'],
    danger: ['var(--feedback-danger-tint)', 'var(--feedback-danger-tint-text)', 'var(--feedback-danger-border)', 'error'],
  }[tone];
  return (
    <Gap name="InlineAlert" role="status" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: T[0], color: T[1], border: '1px solid ' + T[2], borderRadius: 'var(--radius-md)', ...style }}>
      <span style={{ marginTop: 1 }}><Icon name={icon || T[3]} size="md" /></span>
      <div style={{ flex: 1, display: 'grid', gap: 2, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)' }}>
        {title && <strong style={{ fontWeight: 600, fontSize: 'var(--type-label-lg-size)' }}>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {action}
    </Gap>
  );
}

/* List row. Gap: ListRow. */
function GapListRow({ icon, title, sub, right, onClick, chevron = !!onClick, style }) {
  return (
    <Gap name="ListRow" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 'var(--target-field)', padding: '8px 0', borderTop: '1px solid var(--border-decorative)', cursor: onClick ? 'pointer' : undefined, ...style }}>
      {icon && <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', flex: '0 0 auto', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}><Icon name={icon} size="md" /></span>}
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
        <div style={{ fontSize: 'var(--type-body-md-size)', fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
        {sub && <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>{sub}</div>}
      </div>
      {right}
      {chevron && <Icon name="chevron-right" size="md" color="var(--text-tertiary)" />}
    </Gap>
  );
}

/* Key/value list. Gap: KeyValueList. rows: [[label, value, {mono}]]. */
function GapKeyValue({ rows, labelWidth = 140, style }) {
  return (
    <Gap name="KeyValueList" as="dl" style={{ margin: 0, display: 'grid', gap: 6, fontSize: 'var(--type-body-sm-size)', ...style }}>
      {rows.filter(Boolean).map(([k, v, o]) => (
        <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <dt style={{ width: labelWidth, flex: '0 0 auto', color: 'var(--text-secondary)' }}>{k}</dt>
          <dd style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: o && o.mono ? 'var(--font-mono)' : 'inherit', fontSize: o && o.mono ? 'var(--type-mono-sm-size)' : 'inherit', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </Gap>
  );
}

/* Chip. Gap: Chip (exists in @hg/ui-native primitives/Chip.tsx). */
function GapChip({ label, selected, onClick, icon }) {
  return (
    <Gap name="Chip" as="span" style={{ display: 'inline-flex' }}>
      <Button size="sm" variant={selected ? 'secondary' : 'tertiary'} iconStart={icon} onPress={onClick}
        style={{ borderRadius: 'var(--radius-full)' }}>{label}</Button>
    </Gap>
  );
}

/* Quantity stepper. Gap: QuantityStepper (exists in @hg/ui-native + ui-web content/QuantityStepper.tsx). */
function GapStepper({ value, onChange, min = 1, max = 20, label = 'Quantity' }) {
  return (
    <Gap name="QuantityStepper" role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
      <IconButton icon="minus" accessibilityLabel="One fewer" variant="tonal" shape="circle" disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
      <span aria-live="polite" style={{ minWidth: 20, textAlign: 'center', fontSize: 'var(--type-heading-md-size)', fontWeight: 600, fontVariantNumeric: 'var(--numeric-tabular)' }}>{value}</span>
      <IconButton icon="plus" accessibilityLabel="One more" variant="tonal" shape="circle" disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
    </Gap>
  );
}

/* Map. Gap: MapView (exists in @hg/ui-native feedback/MapView.tsx). Pins come from the
   payload's GeoPoints; this placeholder draws no route geometry of its own. */
function GapMap({ height = 180, pins = [], caption, style }) {
  const colors = { restaurant: 'var(--color-map-pin-restaurant)', rider: 'var(--color-map-pin-rider)', customer: 'var(--color-map-pin-customer)' };
  return (
    <Gap name="MapView" style={{ position: 'relative', height, background: 'var(--surface-sunken)', overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)', textAlign: 'center', padding: 16 }}>
        <span style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
          <Icon name="map" size="lg" />
          <span>{caption || 'Map: pins from the payload'}</span>
          <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {pins.map(p => (
              <span key={p.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: colors[p.kind] }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)' }}>{p.label}</span>
              </span>
            ))}
          </span>
        </span>
      </div>
    </Gap>
  );
}

/* Upload area. Gap: FileUpload. state: idle | uploading | done | error. */
function GapFileUpload({ label, hint, state = 'idle', fileName, error, onChoose }) {
  return (
    <Gap name="FileUpload" style={{ display: 'grid', gap: 6 }}>
      {label && <span style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'var(--space-4)', border: '1.5px dashed ' + (state === 'error' ? 'var(--feedback-danger-border)' : 'var(--border-interactive)'), borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', background: 'var(--surface-raised)' }}>
        <Icon name={state === 'done' ? 'check' : state === 'uploading' ? 'refresh' : 'plus'} size="md" />
        <div style={{ flex: 1, fontSize: 'var(--type-body-sm-size)' }}>
          {state === 'done' ? fileName : state === 'uploading' ? 'Uploading ' + (fileName || '') + '…' : (hint || 'PDF, JPG or PNG')}
        </div>
        <Button variant="tertiary" size="sm" loading={state === 'uploading'} onPress={onChoose}>{state === 'done' ? 'Replace' : 'Choose file'}</Button>
      </div>
      {error && <span style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 'var(--type-caption-size)', color: 'var(--feedback-danger-text)' }}><Icon name="error" size="sm" />{error}</span>}
    </Gap>
  );
}

/* Side navigation. Gap: SideNav. Rendered inside a dark-theme region so DS ghost Buttons read on chrome. */
function GapSideNav({ items, value, onChange }) {
  return (
    <Gap name="SideNav" as="nav" data-theme="dark" style={{ display: 'grid', gap: 2, alignContent: 'start', padding: '0 8px', background: 'transparent' }}>
      {items.map(n => (
        <Button key={n.value} variant={n.value === value ? 'secondary' : 'ghost'} iconStart={n.icon} onPress={() => onChange(n.value)}
          accessibilityLabel={n.count != null ? n.label + ', ' + n.count + ' waiting' : undefined}
          style={{ justifyContent: 'flex-start', width: '100%', color: 'var(--text-on-accent)' }}>
          {/* Button wraps children in a plain span, so the row is laid out here: label start, count end. */}
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 176 }}>
            <span style={{ textAlign: 'start' }}>{n.label}</span>
            {n.count != null && <Badge variant="brand" appearance="solid" size="sm">{n.count}</Badge>}
          </span>
        </Button>
      ))}
    </Gap>
  );
}

/* Stat tile. Gap: StatCard. */
function GapStat({ label, children, sub }) {
  return (
    <Gap name="StatCard">
      <Card radius="lg" variant="outlined">
        <div style={{ fontSize: 'var(--type-label-md-size)', color: 'var(--text-tertiary)', fontWeight: 600 }}>{label}</div>
        <div style={{ margin: '6px 0 2px' }}>{children}</div>
        {sub && <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>{sub}</div>}
      </Card>
    </Gap>
  );
}

/* Avatar. Gap: Avatar. Shows photo_url when present, initials otherwise. */
function GapAvatar({ name = '', src, size = 44 }) {
  const initials = name.split(' ').map(s => s[0]).join('').slice(0, 2);
  return (
    <Gap name="Avatar" as="span" style={{ width: size, height: size, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-full)', background: 'var(--surface-sunken)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: size / 2.8, overflow: 'hidden' }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </Gap>
  );
}

/* Accordion. Gap: Accordion. */
function GapAccordion({ items, open, onToggle }) {
  return (
    <Gap name="Accordion" style={{ display: 'grid', gap: 10 }}>
      {items.map(([q, a], i) => (
        <Card key={q} radius="lg" variant="outlined" padding="0">
          <Button variant="ghost" fullWidth iconEnd="chevron-down" onPress={() => onToggle(open === i ? -1 : i)}
            accessibilityLabel={q + (open === i ? ', expanded' : ', collapsed')} style={{ justifyContent: 'space-between', minHeight: 64, padding: '0 24px', whiteSpace: 'normal', textAlign: 'start' }}>{q}</Button>
          {open === i && <p style={{ margin: 0, padding: '0 24px 22px', fontSize: 15, lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: 680 }}>{a}</p>}
        </Card>
      ))}
    </Gap>
  );
}

/* ---------------------------------------------------------------- artboard frame */
const STATE_LABEL = { populated: 'Populated', loading: 'Loading', empty: 'Empty', error: 'Error' };

function readHash() {
  try { return Object.fromEntries(new URLSearchParams((location.hash || '').slice(1))); } catch (e) { return {}; }
}

/* screens: [{ id, label, states?: ['populated','loading','empty','error'], variants?: [{id,label}], render(ctx) }]
   ctx = { state, variant, go(screenId, variantId?) }. device: 'phone' | 'desktop'. theme: 'light' | 'dark' */
function KitFrame({ title, screens, device = 'phone', theme = 'light', initial }) {
  const h = readHash();
  /* test hook: lets the render check enumerate every artboard (screen x variant x state) */
  window.__KIT = screens.map(x => ({ id: x.id, variants: x.variants ? x.variants.map(v => v.id) : [null], states: x.states || ['populated', 'loading', 'empty', 'error'] }));
  const first = screens.find(s => s.id === (h.screen || initial)) || screens[0];
  const [screenId, setScreenId] = React.useState(first.id);
  const screen = screens.find(s => s.id === screenId) || screens[0];
  const [variant, setVariant] = React.useState(h.variant || (screen.variants ? screen.variants[0].id : null));
  const [state, setState] = React.useState(h.state || 'populated');
  const [showGaps, setShowGaps] = React.useState(h.gaps !== '0');
  const states = screen.states || ['populated', 'loading', 'empty', 'error'];
  const go = (id, v) => {
    const s = screens.find(x => x.id === id);
    setScreenId(id); setState('populated');
    setVariant(v || (s && s.variants ? s.variants[0].id : null));
  };
  const pick = id => go(id);
  const ctx = { state: states.includes(state) ? state : 'populated', variant: variant || (screen.variants ? screen.variants[0].id : null), go };
  const body = screen.render(ctx);
  return (
    <div className={showGaps ? 'kit show-gaps' : 'kit'} style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: '100%', background: 'var(--color-neutral-100)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', padding: '10px 16px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-decorative)' }}>
        <div style={{ display: 'grid', gap: 2, marginRight: 8 }}>
          <span style={{ fontSize: 'var(--type-label-sm-size)', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '.04em' }}>{title}</span>
          <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{screens.length} artboards</span>
        </div>
        <Select label="Screen" value={screenId} onValueChange={pick} options={screens.map(s => ({ value: s.id, label: s.label }))} style={{ minWidth: 220 }} />
        {screen.variants && (
          <Select label="Variant" value={ctx.variant} onValueChange={v => { setVariant(v); setState('populated'); }} options={screen.variants.map(v => ({ value: v.id, label: v.label }))} style={{ minWidth: 220 }} />
        )}
        {states.length > 1 && (
          <SegmentedControl label="Artboard state" size="sm" value={ctx.state} onChange={setState} options={states.map(s => ({ value: s, label: STATE_LABEL[s] || s }))} />
        )}
        <div style={{ marginLeft: 'auto' }}>
          <Switch size="sm" label="Show component gaps" stateLabel={{ on: 'On', off: 'Off' }} checked={showGaps} onCheckedChange={setShowGaps} />
        </div>
      </div>
      {device === 'phone' ? (
        <div style={{ display: 'grid', placeItems: 'start center', padding: '12px 0 20px' }}>
          <div data-theme={theme === 'dark' ? 'dark' : undefined} style={{ width: 390, height: 820, background: 'var(--surface-base)', color: 'var(--text-primary)', borderRadius: 34, overflow: 'hidden', boxShadow: 'var(--elev-4)', position: 'relative', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28, padding: '0 18px', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
              <span>18:47</span><span style={{ display: 'flex', gap: 6 }}><span>5G</span><span>84%</span></span>
            </div>
            <div style={{ position: 'relative', overflow: 'hidden', minHeight: 0 }}>{body}</div>
          </div>
        </div>
      ) : (
        <div data-theme={theme === 'dark' ? 'dark' : undefined} style={{ position: 'relative', minHeight: 780, background: 'var(--surface-base)' }}>{body}</div>
      )}
    </div>
  );
}

/* Baseline-state switch for one screen body. */
function Stateful({ state, loading, empty, error, children }) {
  if (state === 'loading') return loading || <GapSkeleton />;
  if (state === 'empty') return empty || <GapEmptyState title="Nothing here yet" />;
  if (state === 'error') return error || <GapErrorState />;
  return children;
}

Object.assign(window, {
  Gap, GapWordmark, GapSkeleton, GapEmptyState, GapErrorState, GapBanner, GapListRow, GapKeyValue, GapChip,
  GapStepper, GapMap, GapFileUpload, GapSideNav, GapStat, GapAvatar, GapAccordion, KitFrame, Stateful,
});
