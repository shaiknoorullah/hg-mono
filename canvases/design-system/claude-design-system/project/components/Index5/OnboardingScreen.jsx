const { Button, Input, Card, RadioGroup, Badge } = window.HalalGoesDesignSystem_d11a47;

/* K-31: onboarding. RiderOnboardingState PROFILE_PENDING → VEHICLE_PENDING → DOCUMENTS_PENDING →
   DOCUMENTS_REVIEW → (DOCUMENTS_REJECTED: fix) → PAYOUT_PENDING → ACTIVE. */
const OB_STEPS = ['Profile', 'Vehicle', 'Documents', 'Review', 'Payouts'];
const OB_INDEX = { profile: 0, vehicle: 1, documents: 2, review: 3, fix: 2, payout: 4 };

function OnboardingScreen({ variant, state }) {
  const [vehicle, setVehicle] = React.useState('SCOOTER');
  const motorised = ['SCOOTER', 'MOTORCYCLE', 'CAR'].includes(vehicle);
  const docs = DOCS_FOR[motorised ? 'motorised' : 'unpowered'];
  const cta = { profile: 'Continue', vehicle: 'Continue', documents: 'Submit for review', review: null, fix: 'Resubmit', payout: 'Set up payouts' }[variant];
  const content = () => {
    if (variant === 'profile') return (
      <>
        <Input label="First name" value="Yusuf" onChange={() => {}} />
        <Input label="Last name" value="Ahmed" onChange={() => {}} helperText="Customers only see your first name and last initial." />
        <Input label="Email" variant="email" value="yusuf@example.ca" onChange={() => {}} />
      </>
    );
    if (variant === 'vehicle') return (
      <>
        <RadioGroup label="How will you deliver?" value={vehicle} onValueChange={setVehicle} required
          options={VEHICLES.map(([v, l]) => ({ value: v, label: l }))} />
        {motorised && <Input label="Licence plate" value="CJRA 204" onChange={() => {}} />}
        {motorised && <Input label="Make and model" value="Honda PCX 125" onChange={() => {}} />}
      </>
    );
    if (variant === 'documents') return (
      <>
        <Body muted>{motorised ? 'Motorised riders upload a licence, registration, insurance and a photo.' : 'Bicycle and on-foot riders upload a government ID and a photo.'}</Body>
        {docs.map(([t, l], i) => <GapFileUpload key={t} label={l} state={i === 0 ? 'done' : i === 1 ? 'uploading' : 'idle'} fileName={i === 0 ? 'licence-front.jpg' : 'registration.pdf'} />)}
      </>
    );
    if (variant === 'review') return (
      <GapEmptyState icon="clock" title="We're checking your documents"
        body="A person reviews every document. You'll get a notification when it's done. You can't go online until then." />
    );
    if (variant === 'fix') return (
      <>
        <GapBanner tone="warning" title="One document needs a new upload">Everything else is approved. Replace the document below and resubmit.</GapBanner>
        <Card variant="outlined" radius="lg">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>Vehicle registration</span>
              <Badge variant="warning" size="sm">{KYC_LABEL.REJECTED}</Badge>
            </div>
            <GapKeyValue labelWidth={96} rows={[['Reason', 'Plate does not match (PLATE_MISMATCH)'], ['Reviewer note', 'The plate on the registration is CJRA 240, not CJRA 204.']]} />
            <GapFileUpload label="New upload" state="error" error="Upload failed. Check your connection and choose the file again." />
          </div>
        </Card>
        <GapListRow title="Driver's licence" right={<Badge variant="outline" size="sm" icon="check">{KYC_LABEL.APPROVED}</Badge>} />
        <GapListRow title="Vehicle insurance" right={<Badge variant="outline" size="sm" icon="check">{KYC_LABEL.APPROVED}</Badge>} />
      </>
    );
    return (
      <>
        <Body>Earnings are paid weekly, every Monday, to your bank through Stripe.</Body>
        <GapBanner tone="info" title="Payouts not set up yet">You can't go online until Stripe confirms your payout details.</GapBanner>
      </>
    );
  };
  return (
    <RiderScreen title="Become a rider" subtitle={'Step ' + (OB_INDEX[variant] + 1) + ' of ' + OB_STEPS.length + ' · ' + OB_STEPS[OB_INDEX[variant]]}
      footer={cta && state === 'populated' ? <Button size="xl" fullWidth>{cta}</Button> : null}>
      <Pad>
        {/* StatusTimeline only draws OrderState; onboarding progress is a non-order stepper, which the
            DS lacks (gap: ProgressSteps). The step is carried by the app bar subtitle instead. */}
        <GapOnboardingSteps steps={OB_STEPS} current={OB_INDEX[variant]} />
        {state === 'loading' ? <GapSkeleton rows={2} />
          : state === 'error' ? <GapErrorState title="Couldn't load your application" body="Your answers are saved. Try again to continue where you left off." />
          : content()}
      </Pad>
    </RiderScreen>
  );
}

/* Gap: ProgressSteps (a non-order step indicator). Composed from DS Badges only. */
function GapOnboardingSteps({ steps, current }) {
  return (
    <Gap name="ProgressSteps" role="list" aria-label={'Step ' + (current + 1) + ' of ' + steps.length} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((l, i) => (
        <span role="listitem" key={l} aria-current={i === current ? 'step' : undefined}>
          <Badge size="sm" variant={i === current ? 'brand' : i < current ? 'neutral' : 'outline'} appearance={i === current ? 'solid' : 'tint'} icon={i < current ? 'check' : undefined}>{l}</Badge>
        </span>
      ))}
    </Gap>
  );
}

Object.assign(window, { OnboardingScreen });
