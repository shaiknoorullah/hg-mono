/* Rider kit layout pieces. Everything is DS components + role tokens under the DS dark scheme
   (KitFrame theme="dark" sets data-theme="dark" on the phone); no raw colour values (K-40).
   Contrast (NEW tokens.json, dark theme, measured from the resolved values):
     text-primary on surface-base 15.6:1, on surface-raised 10.8:1, on surface-sunken 18.3:1;
     text-secondary on surface-base 8.4:1, on surface-raised 5.8:1 (below 7:1);
     text-tertiary on surface-base 4.9:1, on surface-raised 3.4:1.
   Body copy and every instruction use text-primary; text-secondary is kept to metadata (section
   labels, captions), never instructions. The shared Kit.jsx placeholders (KeyValue labels, StatCard
   sub-lines) still use text-tertiary, 3.4:1 on raised cards: a shared-file follow-up. */
const { AppBar, BottomNav, Card, Button, Icon, Input, RadioGroup, Badge, Price, Sheet } = window.HalalGoesDesignSystem_d11a47;

/* Solar has no wallet/bike glyph: Earnings uses "orders" (a statement), History uses "clock". */
const RIDER_TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'earnings', label: 'Earnings', icon: 'orders' },
  { key: 'history', label: 'History', icon: 'clock' },
  { key: 'profile', label: 'Profile', icon: 'profile' },
];

function RiderScreen({ title, subtitle, onBack, backLabel, actions, children, footer, tab, go, overlay }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: 'auto 1fr auto auto', background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
      <AppBar tone="field" title={title} subtitle={subtitle} onBack={onBack} backLabel={backLabel} actions={actions} />
      <div style={{ overflowY: 'auto', minHeight: 0 }}>{children}</div>
      {footer ? <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)', borderTop: '1px solid var(--border-decorative)', background: 'var(--surface-base)' }}>{footer}</div> : <span />}
      {tab ? <BottomNav tone="field" label="Rider" active={tab} onChange={k => go && go(k)} items={RIDER_TABS} /> : <span />}
      {overlay}
    </div>
  );
}

function Pad({ children, gap = 'var(--space-4)' }) {
  return <div style={{ padding: 'var(--space-4)', display: 'grid', gap, alignContent: 'start' }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '.01em' }}>{children}</div>;
}

function Body({ children, muted }) {
  return <p style={{ margin: 0, fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-line)', color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{children}</p>;
}

/* Offer/assignment earnings line. K-36: an estimate, and the tip can still change. */
function EstimateLine({ earnings, size = 'md' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }}>
      Estimated <Price cents={earnings.estimated_total_cents} size={size} onDark />
      {earnings.tip_so_far_cents != null && <>· tip so far <Price cents={earnings.tip_so_far_cents} size="md" onDark /></>}
    </span>
  );
}

/* Items after acceptance (K-38): name, quantity, variant, add-ons, notes, allergens. No prices.
   An empty allergen list reads "not provided", never "no allergens". */
function ItemsList({ items }) {
  return (
    <div>
      {items.map(it => (
        <GapListRow key={it.name} title={it.quantity + '× ' + it.name}
          sub={<span style={{ display: 'grid', gap: 4, color: 'var(--text-primary)' }}>
            {(it.variant_name || it.addon_names.length > 0) && <span>{[it.variant_name, ...it.addon_names].filter(Boolean).join(' · ')}</span>}
            {it.note && <span>Note: {it.note}</span>}
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {it.allergen_tags.length
                ? it.allergen_tags.map(a => <Badge key={a} variant="warning" size="sm" icon="warning">{ALLERGEN_TEXT[a]}</Badge>)
                : <Badge variant="outline" size="sm">Allergens not provided</Badge>}
            </span>
          </span>} />
      ))}
    </div>
  );
}

/* Masked contact (D-24 V1): call through phone_alias, or send a canned template. No free-text chat.
   Solar has no phone/message glyph, so these are text buttons. */
const TEMPLATES = ['I’m outside', 'I’m at the lobby', 'Running a few minutes late', 'I can’t find the entrance'];
function ContactActions({ who, alias, setTemplatesOpen }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
      <Button variant="secondary" size="lg">Call {who}</Button>
      <Button variant="tertiary" size="lg" onPress={() => setTemplatesOpen && setTemplatesOpen(true)}>Message</Button>
      <span style={{ gridColumn: 'span 2', fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>
        Calls go through a masked number ({alias ? 'proxy ' + alias.slice(-4) : 'none'}), switched off 30 min after the trip.
      </span>
    </div>
  );
}
function TemplatesSheet({ open, onClose }) {
  return (
    <Sheet open={!!open} contained title="Send a message" onClose={onClose} footer={<Button variant="ghost" fullWidth onPress={onClose}>Cancel</Button>}>
      <div style={{ display: 'grid', gap: 8 }}>
        {TEMPLATES.map(t => <Button key={t} variant="secondary" size="lg" fullWidth style={{ justifyContent: 'flex-start' }} onPress={onClose}>{t}</Button>)}
      </div>
      <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>Templates only. Free-text chat is V2 (D-24).</p>
    </Sheet>
  );
}

/* Camera viewfinder. Gap: Scanner (camera QR / photo capture). Solar has no camera glyph. */
function GapScanner({ height = 150, caption = 'Point the camera at the seal’s QR' }) {
  return (
    <Gap name="Scanner" style={{ height, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', border: '1.5px dashed var(--border-interactive)', color: 'var(--text-primary)' }}>
      <span style={{ fontSize: 'var(--type-body-sm-size)' }}>{caption}</span>
    </Gap>
  );
}

/* Seal scan (K-37). The seal condition is a deliberate choice: nothing pre-selected, and Confirm
   stays disabled until the rider answers. A broken seal never blocks the handoff; it is recorded.
   The rider does not file tamper reports (the customer does). */
function SealScan({ phase }) {
  const [cond, setCond] = React.useState(null);
  const [manual, setManual] = React.useState(false);
  return (
    <Card variant="outlined" radius="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>{phase === 'pickup' ? 'Scan the seal at pickup' : 'Scan the seal at the door'}</div>
        {manual ? <Input size="lg" label="Seal code" placeholder="Code printed under the QR" /> : <GapScanner />}
        <Button variant="ghost" size="sm" onPress={() => setManual(m => !m)} style={{ justifySelf: 'start' }}>{manual ? 'Use the camera' : 'Type the code instead'}</Button>
        <RadioGroup label="What does the seal look like?" value={cond} onValueChange={setCond} required
          options={[
            { value: 'intact', label: 'Intact' },
            { value: 'broken', label: 'Broken or tampered', description: 'Still continue. It is recorded with the scan.' },
          ]} />
        <Button size="xl" fullWidth disabled={!cond}>{cond ? 'Confirm scan' : 'Choose the seal condition'}</Button>
        <Button variant="ghost" size="sm" style={{ justifySelf: 'start' }}>No seal on this package</Button>
      </div>
    </Card>
  );
}

Object.assign(window, { RIDER_TABS, RiderScreen, Pad, SectionLabel, Body, EstimateLine, ItemsList, ContactActions, TemplatesSheet, GapScanner, SealScan });
