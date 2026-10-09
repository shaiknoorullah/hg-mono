const { Card, Button, Badge, DataTable } = window.HalalGoesDesignSystem_d11a47;

/* K-20/K-28: Hours is its own screen, on its own resource (GET/PUT /v1/restaurant/hours):
   weekly TradingIntervals plus date overrides, in the restaurant's timezone. */
function HoursScreen({ state }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = order.map(d => {
    const iv = HOURS.intervals.find(i => i[0] === d);
    return { id: 'd' + d, day: DAY[d], opens: iv ? iv[1] : null, closes: iv ? iv[2] : null, crosses: iv && iv[3] };
  });
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={2} height={120} />}
      empty={<GapEmptyState icon="clock" title="No opening hours yet" body="Customers can't order until you set your weekly hours." action="Set weekly hours" />}
      error={<GapErrorState title="Couldn't load your hours" body="Your storefront keeps its current hours. Try again." onRetry={() => {}} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 'var(--space-6)', alignItems: 'start', maxWidth: 1040 }}>
        <Card radius="lg" variant="outlined">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 'var(--space-3)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Weekly hours</h3>
            <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{HOURS.timezone}</span>
            <Button variant="tertiary" size="sm" style={{ marginInlineStart: 'auto' }}>Edit week</Button>
          </div>
          <DataTable caption="Weekly opening hours" hideCaption density="compact" rows={rows} columns={[
            { key: 'day', label: 'Day' },
            { key: 'hours', label: 'Hours', numeric: true, render: r => r.opens ? r.opens + ' – ' + r.closes : <span style={{ color: 'var(--text-tertiary)' }}>Closed</span> },
            { key: 'note', label: '', render: r => r.crosses ? <Badge variant="neutral" size="sm">Past midnight</Badge> : null },
          ]} />
        </Card>
        <Card radius="lg" variant="outlined">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 'var(--space-3)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Date overrides</h3>
            <Button variant="tertiary" size="sm" iconStart="plus" style={{ marginInlineStart: 'auto' }}>Add date</Button>
          </div>
          {HOURS.overrides.length === 0
            ? <GapEmptyState icon="clock" title="No overrides" body="Add holidays and special hours here." />
            : HOURS.overrides.map(o => (
              <GapListRow key={o.date} icon="clock" title={o.date + (o.reason ? ' · ' + o.reason : '')}
                sub={o.is_closed ? 'Closed all day' : o.opens_at + ' – ' + o.closes_at}
                right={<Button variant="ghost" size="sm">Edit</Button>} />
            ))}
        </Card>
      </div>
    </Stateful>
  );
}
Object.assign(window, { HoursScreen });
