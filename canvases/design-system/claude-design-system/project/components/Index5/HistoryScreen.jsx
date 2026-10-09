/* K-31: Delivery history (past assignments) and Profile. */
const { Badge, Card, Button } = window.HalalGoesDesignSystem_d11a47;

function HistoryScreen({ state, go }) {
  return (
    <RiderScreen title="Delivery history" subtitle="Last 30 days" tab="history" go={go}>
      <Pad>
        {state === 'loading' ? <GapSkeleton rows={4} height={56} />
          : state === 'error' ? <GapErrorState title="Couldn’t load your history" body="Try again in a moment." />
          : state === 'empty' ? <GapEmptyState icon="orders" title="No deliveries yet" body="Trips you finish, return or that are cancelled show here." />
          : (
            <Card variant="outlined" radius="lg">
              {HISTORY.map(h => (
                <GapListRow key={h.id} title={h.restaurant + ' → ' + h.area}
                  sub={<span style={{ color: 'var(--text-primary)' }}>{h.at} · <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)' }}>{h.order_code}</span></span>}
                  right={<Badge variant={ASSIGNMENT_LABEL[h.state][1]} size="sm">{ASSIGNMENT_LABEL[h.state][0]}</Badge>} />
              ))}
            </Card>
          )}
      </Pad>
    </RiderScreen>
  );
}

function ProfileScreen({ state, go }) {
  const me = RIDER_ME;
  return (
    <RiderScreen title="Profile" tab="profile" go={go}>
      <Pad>
        {state === 'loading' ? <GapSkeleton rows={3} />
          : state === 'error' ? <GapErrorState title="Couldn’t load your profile" body="Try again. You can still go online meanwhile." />
          : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <GapAvatar name={me.first_name + ' ' + me.last_initial} size={56} />
                <div style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>{me.first_name} {me.last_initial}.</span>
                  <span style={{ fontSize: 'var(--type-body-md-size)' }}>{me.phone}</span>
                </div>
              </div>
              <Card variant="outlined" radius="lg">
                <SectionLabel>Vehicle</SectionLabel>
                <GapKeyValue labelWidth={96} style={{ marginTop: 8 }} rows={[['Type', 'Scooter'], ['Plate', me.vehicle.plate, { mono: true }], ['Model', me.vehicle.make_model]]} />
              </Card>
              <Card variant="outlined" radius="lg">
                <SectionLabel>Documents</SectionLabel>
                {DOCUMENTS.map(d => (
                  <GapListRow key={d.doc_type} title={d.label}
                    sub={d.valid_until ? <span style={{ color: 'var(--text-primary)' }}>Valid until {d.valid_until}</span> : null}
                    right={<Badge variant={KYC_TONE[d.state]} size="sm">{KYC_LABEL[d.state]}</Badge>} />
                ))}
              </Card>
              <Card variant="outlined" radius="lg">
                <GapListRow title="Payout account" sub={<span style={{ color: 'var(--text-primary)' }}>Bank ending 4821 · via Stripe</span>} onClick={() => {}} />
                <GapListRow icon="bell" title="Notifications" onClick={() => {}} />
                <GapListRow icon="info" title="Help and support" onClick={() => {}} />
              </Card>
              <Button variant="ghost" style={{ justifySelf: 'start' }} onPress={() => go('signin', 'phone')}>Sign out</Button>
            </>
          )}
      </Pad>
    </RiderScreen>
  );
}

Object.assign(window, { HistoryScreen, ProfileScreen });
