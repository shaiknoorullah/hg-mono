const { Card, Button, Badge, Price, Icon, IconButton, DataTable, Menu, Select } = window.HalalGoesDesignSystem_d11a47;

/* K-25: availability is the four-state MenuItemAvailabilityState (PUT .../availability), not a
   binary switch. BLOCKED is set by an admin and the restaurant cannot clear it. Claim-bearing edits
   create a MenuItemVersion that goes through admin review (PENDING_REVIEW / REJECTED). The contract
   has no import, duplicate or delete, so those actions are gone. */
const AVAIL_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'HIDDEN', label: 'Hidden from menu' },
];

function AvailabilityCell({ item }) {
  const [v, setV] = React.useState(item.availability_state);
  if (item.availability_state === 'BLOCKED') {
    return (
      <div style={{ display: 'grid', gap: 2 }}>
        <Badge variant="neutral" icon="lock" size="sm">Blocked by HalalGoes</Badge>
        <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', whiteSpace: 'normal' }}>Contact support to unblock</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 170 }}>
      <Select label={'Availability of ' + item.name} value={v} onValueChange={setV} options={AVAIL_OPTIONS} />
      {v === 'OUT_OF_STOCK' && (
        <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>Back at {item.out_of_stock_until ? hhmm(item.out_of_stock_until) : 'end of day'}</span>
      )}
    </div>
  );
}

function ReviewCell({ item }) {
  if (item.review === 'PENDING_REVIEW') return (
    <div style={{ display: 'grid', gap: 2, whiteSpace: 'normal', maxWidth: 240 }}>
      <Badge variant="info" icon="clock" size="sm">Change in review</Badge>
      <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{item.pending_note} · live version still shown</span>
    </div>
  );
  if (item.review === 'REJECTED') return (
    <div style={{ display: 'grid', gap: 2, whiteSpace: 'normal', maxWidth: 240 }}>
      <Badge variant="warning" icon="warning" size="sm">Change not approved</Badge>
      <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{item.rejection_reason_code}</span> — {item.review_note}
      </span>
    </div>
  );
  return <span style={{ color: 'var(--text-tertiary)' }}>Live</span>;
}

function MenuScreen({ state }) {
  const count = MENU.reduce((n, c) => n + c.items.length, 0);
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={4} height={56} />}
      empty={<GapEmptyState icon="orders" title="Your menu is empty" body="Add your first item. Names, descriptions, dietary and allergen tags are reviewed by HalalGoes before they go live." action="Add item" />}
      error={<GapErrorState title="Couldn't load your menu" body="Nothing has changed on your storefront. Try again." onRetry={() => {}} />}>
      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 1040 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button iconStart="plus">Add item</Button>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>{count} items in {MENU.length} categories</span>
        </div>
        <GapBanner tone="info" title="Claim-bearing edits are reviewed">
          Changes to a name, description, ingredients, dietary or allergen tags, or photo go live after HalalGoes approves them. Price and availability change at once.
        </GapBanner>
        {MENU.map(cat => (
          <section key={cat.category} style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>{cat.category}</h2>
            <DataTable caption={cat.category + ' items'} hideCaption density="comfortable" rows={cat.items}
              rowLabel={r => r.name}
              rowActions={r => r.availability_state === 'BLOCKED' ? [{ label: 'Edit item', disabled: true, disabledReason: 'Blocked by HalalGoes — contact support' }] : [{ label: 'Edit item' }]}
              columns={[
              { key: 'name', label: 'Item', render: r => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Photo src={r.image_url} alt={r.name} height={40} radius="sm" style={{ width: 40 }} />
                  <div style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600 }}>{r.name}</div>
                </div>) },
              { key: 'tags', label: 'Dietary', render: r => r.dietary_tags.length ? <span style={{ display: 'flex', gap: 4 }}>{r.dietary_tags.map(t => <Badge key={t} variant="neutral" size="sm">{t.toLowerCase()}</Badge>)}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span> },
              { key: 'price', label: 'Price', align: 'end', numeric: true, render: r => <Price cents={r.price_cents} size="sm" /> },
              { key: 'avail', label: 'Availability', render: r => <AvailabilityCell item={r} /> },
              { key: 'review', label: 'Review', render: r => <ReviewCell item={r} /> },
            ]} />
          </section>
        ))}
        <Card radius="lg" variant="outlined">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-tertiary)' }}><Icon name="info" size="md" /></span>
            <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)', lineHeight: 'var(--type-body-sm-line)' }}>
              Dietary tags describe the dish. They never describe certification — your halal status comes from your approved certificate, not from a tag you can set.
            </p>
          </div>
        </Card>
      </div>
    </Stateful>
  );
}
Object.assign(window, { MenuScreen });
