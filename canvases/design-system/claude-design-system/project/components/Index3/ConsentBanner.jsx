/* ConsentBanner.jsx: cookie consent (apps/marketing/src/components/ConsentManager.tsx + lib/consent.ts).
   Nothing is pre-accepted: every service is default: false, required: false. Decline and Accept all
   carry equal weight (both secondary) — declining is one click. Copy is verbatim from consent.ts.
   mode: 'notice' (bottom corner) | 'preferences' (centred Modal with two switches, both off). */
const { Card, Button, Modal, Switch } = window.HalalGoesDesignSystem_d11a47;

function ConsentBanner({ mode = 'notice', onClose = () => {}, onChoose = () => {} }) {
  const [on, setOn] = React.useState({ umami: false, ads: false });
  if (mode === 'preferences') {
    return (
      <Modal open contained size="md" title="What we would like to use" onClose={onClose}
        description="Everything below is off by default and stays off unless you turn it on. You can change this at any time from the link in the footer."
        actions={<>
          <Button variant="secondary" onPress={onClose}>Decline</Button>
          <Button variant="secondary" onPress={onClose}>Save choices</Button>
        </>}>
        <div style={{ display: 'grid', gap: 8 }}>
          <Switch id="ck-umami" label="Measurement · Umami" stateLabel={{ on: 'On', off: 'Off' }} checked={on.umami} onCheckedChange={v => setOn({ ...on, umami: v })}
            description="Our own analytics, running on our own server. It counts page views and where they came from. It sets no cookie, follows nobody between sites, and records no personal data." />
          <Switch id="ck-ads" label="Advertising · Advertising pixels" stateLabel={{ on: 'On', off: 'Off' }} checked={on.ads} onCheckedChange={v => setOn({ ...on, ads: v })}
            description="Lets an ad platform know that a visit turned into a signup, so we stop paying for ads that do not work. This one does follow you between sites, which is why it is off unless you allow it." />
        </div>
      </Modal>
    );
  }
  return (
    <Card radius="lg" variant="outlined" role="dialog" aria-label="Cookies"
      style={{ position: 'fixed', insetInlineStart: 16, bottom: 16, zIndex: 'var(--z-toast)', maxWidth: 420, display: 'grid', gap: 10, boxShadow: 'var(--elev-4)' }}>
      <strong style={{ fontSize: 'var(--type-heading-sm-size)' }}>Cookies</strong>
      <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', color: 'var(--text-secondary)' }}>
        We would like to measure how this page is used, and — once we advertise — whether an ad led you here. Nothing is switched on until you say so.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" onPress={onClose}>Decline</Button>
        <Button variant="secondary" size="sm" onPress={onClose}>Accept all</Button>
        <Button variant="ghost" size="sm" onPress={onChoose}>Choose</Button>
      </div>
    </Card>
  );
}
Object.assign(window, { ConsentBanner });
