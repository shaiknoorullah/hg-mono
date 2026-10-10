/**
 * WP7 Application, part 1: the hub that hosts the `application` flow, step 1 (Your details) and
 * step 2 (How you deliver), and the closed application.
 *
 * - R04 Hub. Boards: SO `Onboarding-Welcome`, `-Welcome-Light`, `Onboarding-InProgress`,
 *   `-Loading`, `-Error`, `-Offline`. Not built: `Onboarding-Welcome-Terms`, `-Terms-Tried`
 *   (API gap 36, terms acceptance).
 * - R05 entry: "Read the rider terms" / "Read the privacy notice" push WP9's `legalDocument`
 *   only once it is registered; before that the terms line shows without the links.
 * - R06 Your details. Boards: SO `Profile-Default`, `-Required`, `-Saving`, `-Underage`,
 *   `-UnderageAgain`, `-EmailInUse`, `-ServerError`, `-Loading`, `-Offline`, `-Timezone-Error`,
 *   `Profile-Underage-Light`, `Profile-Default-LargeText`, `Profile-Default-Keyboard`.
 * - R07 How you deliver. Boards: SO `Vehicle-Empty`, `-NoChoice`, `-Bicycle`, `-OnFoot`,
 *   `-Scooter`, `-Car`, `-Motorcycle`, `-Switched`, `-NotApplicable`, `-YearRange`,
 *   `-PlateInUse`, `-Required`, `-Saving`, `-Loading`, `-Error`, `-Offline`, `-ChangeAfterDocs`,
 *   `Vehicle-Scooter-Light`.
 * - R13 Application closed. Board: SO `Fix-Closed`. Not built: `Fix-Closed-Reason` (API gap 39).
 *
 * The hub decides nothing itself: `getRiderOnboardingStatus.next_step` says which step is next.
 * Steps the hub does not own (review, fix documents, payouts) replace it with their screen.
 *
 * Every banner is slate or amber (Banner `neutral` / `warning`); field errors use the danger
 * text role, which is allowed because nothing here is a halal state. The rider app shows no
 * halal badge.
 */
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Icon,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  icon,
  space,
  typeStyle,
  useTheme,
} from '../ds';
import { callSupport, useSupport, type Support } from '../data/config';
import { useOnline } from '../data/connectivity';
import { toRiderError } from '../data/errors';
import { useApiQuery, type QueryResult } from '../data/query';
import { LegacyFallback } from '../nav/LegacyFallback';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { useSession } from '../session/Session';
import { signOut } from '../session/signOut';
import { CALL_SUPPORT, TERMINAL } from '../signin/copy';
import { revokeSession } from '../signin/otp';
import {
  APP_TITLE,
  BACK_TO_APPLICATION,
  BACK_TO_DETAILS,
  CLOSED,
  CONTINUE,
  DETAILS,
  HUB,
  OFFLINE_TITLE,
  PROGRESS,
  SIGN_OUT,
  TRY_AGAIN,
  VEHICLE,
} from './copy';
import {
  MIN_VEHICLE_YEAR,
  OFFLINE_PROBE_MS,
  TIMEZONES,
  addedCount,
  addedDocs,
  dateOfBirth,
  fetchOnboardingStatus,
  fieldErrors,
  isMotorised,
  minAgeFrom,
  optionalRoute,
  presetTimezone,
  recordUnderage,
  requiredDocs,
  rowDone,
  stepNumber,
  submitProfile,
  submitVehicle,
  underageState,
  type OnboardingStatus,
  type RiderProfileInput,
  type RiderVehicleInput,
  type VehicleType,
} from './data';

const CLOSED_CODES = new Set(['ACCOUNT_NOT_ACTIVE', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_BANNED']);

/**
 * The onboarding status. While offline it is re-read every few seconds: `useOnline` only turns
 * back on when a request gets an answer, and these screens send nothing else on their own, so
 * without the probe Continue would stay off after the signal returns ("Continue works again once
 * you are back online").
 */
export function useStatus(): QueryResult<OnboardingStatus> {
  const online = useOnline();
  return useApiQuery('rider-onboarding-status', fetchOnboardingStatus, { pollMs: online ? null : OFFLINE_PROBE_MS });
}

function leave(): void {
  void revokeSession();
  signOut();
}

// ───────────────────────────── shared layout (local to this file) ─────────────────────────────

export interface FrameProps {
  testID: string;
  /** The AppBar title; "Your application" unless a screen names its own (WP8 capture, edit screens). */
  title?: string;
  subtitle?: string;
  back?: { label: string; onPress: () => void };
  /** 0–100 from the server; the AppBar's determinate bar stands in for ProgressSteps. */
  progress?: number;
  /** The heading below is the page's h1 (Welcome, Closed). */
  ownHeading?: boolean;
  footer?: React.ReactNode;
  scrollRef?: React.RefObject<ScrollView | null>;
  children: React.ReactNode;
}

export function Frame({ testID, title = APP_TITLE, subtitle, back, progress, ownHeading, footer, scrollRef, children }: FrameProps): React.ReactElement {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.color.surface.base }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ds-request(native): AppBar back 56 (field) — SO Profile-Default, Vehicle-Empty */}
      <AppBar
        tone="field"
        title={title}
        subtitle={subtitle}
        back={back ? { onPress: back.onPress } : undefined}
        backLabel={back?.label}
        progress={progress == null ? undefined : progress / 100}
        isPageHeading={!ownHeading}
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space['5'], gap: space['5'] }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: space['5'],
            paddingTop: space['4'],
            paddingBottom: space['6'],
            gap: space['3'],
            borderTopWidth: 1,
            borderTopColor: theme.color.border.decorative,
            backgroundColor: theme.color.surface.base,
          }}
        >
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** "Step 1 of 5: your details" and "10% done" (the server's percent). */
export function ProgressLine({ step, pct }: { step: number; pct: number }): React.ReactElement {
  const theme = useTheme();
  const label = typeStyle(theme, 'label.lg');
  return (
    // ds-request(native): ProgressSteps — SO Onboarding-Welcome, Profile-Default, Vehicle-Empty (the AppBar progress bar stands in)
    <View testID="application-progress" accessibilityLabel={PROGRESS.step(step)} style={{ flexDirection: 'row', gap: space['3'], flexWrap: 'wrap' }}>
      <Text style={{ ...label, color: theme.color.text.primary, flexShrink: 1 }}>{PROGRESS.step(step)}</Text>
      <Text style={{ ...label, color: theme.color.text.secondary, marginLeft: 'auto' }}>{PROGRESS.done(pct)}</Text>
    </View>
  );
}

export function SupportGhost({ support }: { support: Support }): React.ReactElement | null {
  if (!support.phone) return null;
  return (
    <View style={{ alignItems: 'center' }}>
      <Button testID="call-support" variant="ghost" size="xl" onPress={() => callSupport(support)}>
        {CALL_SUPPORT}
      </Button>
    </View>
  );
}

export function SupportHours({ support }: { support: Support }): React.ReactElement | null {
  const theme = useTheme();
  if (!support.phone || !support.hours) return null;
  return (
    <Text testID="support-hours" style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.primary, textAlign: 'center' }}>
      {TERMINAL.hours(support.hours)}
    </Text>
  );
}

export function LoadingBody({ label }: { label: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: space['4'] }}>
      {/* role="status" (visually hidden on the board): read out, drawn as skeletons */}
      <Text accessibilityLiveRegion="polite" style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.primary }}>
        {label}
      </Text>
      <Skeleton variant="text" lines={2} />
      <Skeleton variant="rect" height={72} />
      <Skeleton variant="rect" height={72} />
      <Skeleton variant="rect" height={72} />
    </View>
  );
}

function LoadError({ testID, onRetry, support, subtitle, back }: {
  testID: string;
  onRetry: () => void;
  support: Support;
  subtitle?: string;
  back?: FrameProps['back'];
}): React.ReactElement {
  return (
    <Frame
      testID={testID}
      subtitle={subtitle}
      back={back}
      footer={
        <>
          <Button testID="retry" variant="primary" size="xl" fullWidth iconStart={<Icon name="refresh" />} onPress={onRetry}>
            {TRY_AGAIN}
          </Button>
          <SupportGhost support={support} />
        </>
      }
    >
      <ErrorState variant="inline" autoFocus title={HUB.errorTitle} description={HUB.errorBody} />
    </Frame>
  );
}

export function FieldNote({ text, error, testID }: { text: string; error?: boolean; testID?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space['2'], alignItems: 'flex-start' }}>
      {error ? <Icon name="error" size={icon.md} color={theme.color.feedback.danger.icon} /> : null}
      <Text
        testID={testID}
        accessibilityLiveRegion={error ? 'assertive' : undefined}
        style={{ ...typeStyle(theme, 'body.lg'), color: error ? theme.color.feedback.danger.text : theme.color.text.primary, flexShrink: 1 }}
      >
        {text}
      </Text>
    </View>
  );
}

export function OfflineAlert({ body }: { body: string }): React.ReactElement {
  const theme = useTheme();
  return (
    // ds-request(native): InlineAlert — SO Onboarding-Offline, Profile-Offline, Vehicle-Offline (Banner stands in)
    <Banner testID="application-offline" variant="neutral" icon={<Icon name="info" color={theme.color.text.primary} />} title={OFFLINE_TITLE} description={body} />
  );
}

// ───────────────────────────────────────── R04 hub ─────────────────────────────────────────

export function ApplicationScreen({ params }: ScreenProps<'application'>): React.ReactElement {
  const status = useStatus();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const online = useOnline();
  const data = status.data;
  const next = data?.next_step;
  const closed = data?.account_status === 'DEACTIVATED' || (status.error?.status === 403 && CLOSED_CODES.has(String(status.error.code)));
  const payouts = optionalRoute('payouts');

  // Steps the hub does not own replace it with their own screen (WP8, WP9).
  React.useEffect(() => {
    if (!data || closed) return;
    if (next === 'AWAITING_REVIEW') nav.replace('applicationReview');
    else if (next === 'FIX_DOCUMENTS') nav.replace('applicationFix');
    else if (next === 'PAYOUT' && payouts) nav.replace(payouts as never, { context: 'application' } as never);
    else if (next === 'DONE') void session.refresh().then(() => nav.closeFlow());
    // Only when the server's answer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, next, closed]);

  if (closed) return <ClosedApplication support={support} />;
  if (status.status === 'loading' || (!data && status.refreshing)) {
    return (
      <Frame testID="application-loading">
        <LoadingBody label={HUB.loading} />
      </Frame>
    );
  }
  if (!data) return <LoadError testID="application-error" onRetry={() => void status.refetch()} support={support} />;
  // Payouts (step 5) is WP9's screen; until it is registered the legacy onboarding screen has it.
  if (next === 'PAYOUT' && !payouts) return <LegacyFallback entry={{ key: 'application-legacy', name: 'application', params }} />;
  if (next !== 'PROFILE' && next !== 'VEHICLE' && next !== 'DOCUMENTS') {
    return (
      <Frame testID="application-handoff">
        <LoadingBody label={HUB.loading} />
      </Frame>
    );
  }

  const welcome = next === 'PROFILE' && !data.steps_completed.profile;
  const step = stepNumber(next);
  const primary =
    next === 'PROFILE'
      ? { label: HUB.start, go: () => nav.push('applicationDetails') }
      : next === 'VEHICLE'
        ? { label: HUB.continueVehicle, go: () => nav.push('applicationVehicle') }
        : { label: HUB.continueDocuments, go: () => nav.push('applicationDocuments') };

  return (
    <Frame
      testID={welcome ? 'application-welcome' : 'application-in-progress'}
      progress={data.progress_percent}
      ownHeading={welcome}
      footer={
        <>
          <Button testID="application-next" variant="primary" size="xl" fullWidth onPress={primary.go}>
            {primary.label}
          </Button>
          <SupportGhost support={support} />
        </>
      }
    >
      {online ? null : <OfflineAlert body={HUB.offlineBody} />}
      {welcome ? <WelcomeBody status={data} step={step} /> : <InProgressBody status={data} step={step} />}
    </Frame>
  );
}

function WelcomeBody({ status, step }: { status: OnboardingStatus; step: number }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const legal = optionalRoute('legalDocument');
  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };
  return (
    <>
      <View style={{ gap: space['2'] }}>
        <Text accessibilityRole="header" style={{ ...typeStyle(theme, 'heading.xl'), color: theme.color.text.primary }}>
          {HUB.welcomeTitle}
        </Text>
        <Text style={body}>{HUB.welcomeLead}</Text>
      </View>
      <ProgressLine step={step} pct={status.progress_percent} />
      <PlanRows status={status} step={step} welcome />
      <Text style={body}>{HUB.bring}</Text>
      <Text testID="application-terms" style={body}>
        {HUB.terms}
      </Text>
      {/* R05: the document screen is WP9's `legalDocument`; no link until it is registered. Document addresses are API gap 35. */}
      {legal ? (
        <View style={{ gap: space['2'] }}>
          <Button testID="read-terms" variant="tertiary" size="xl" fullWidth onPress={() => nav.push(legal as never, { doc: 'terms' } as never)}>
            {HUB.readTerms}
          </Button>
          <Button testID="read-privacy" variant="tertiary" size="xl" fullWidth onPress={() => nav.push(legal as never, { doc: 'privacy' } as never)}>
            {HUB.readPrivacy}
          </Button>
        </View>
      ) : null}
    </>
  );
}

function InProgressBody({ status, step }: { status: OnboardingStatus; step: number }): React.ReactElement {
  const theme = useTheme();
  return (
    <>
      <ProgressLine step={step} pct={status.progress_percent} />
      <Text accessibilityRole="header" style={{ ...typeStyle(theme, 'heading.md'), color: theme.color.text.primary }}>
        {HUB.inProgressTitle}
      </Text>
      <PlanRows status={status} step={step} />
    </>
  );
}

/** The five-row plan. Welcome: numbered rows. In progress: Done / current / Not started. */
function PlanRows({ status, step, welcome = false }: { status: OnboardingStatus; step: number; welcome?: boolean }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { me } = useSession();
  const vehicleType = me.vehicle?.vehicle_type ?? null;

  const subtitleFor = (i: number, done: boolean, current: boolean): string => {
    const row = HUB.rows[i]!;
    if (welcome) return row.description;
    if (done && i === 0) {
      const name = [me.first_name, me.last_name].filter(Boolean).join(' ');
      return name || row.description;
    }
    if (done && i === 1 && vehicleType) {
      const plate = me.vehicle?.licence_plate;
      return plate && isMotorised(vehicleType) ? `${VEHICLE.label(vehicleType)} · ${plate}` : VEHICLE.label(vehicleType);
    }
    if (current) {
      const what = i === 2 && vehicleType ? HUB.docsAdded(addedCount(status, vehicleType), requiredDocs(vehicleType).length) : row.description;
      return HUB.youAreHere(what);
    }
    return HUB.waitingDescription[i] || row.description;
  };

  const title = typeStyle(theme, 'label.lg');
  const sub = typeStyle(theme, 'body.md');
  return (
    // ds-request(native): ListRow (72), in an ol — SO Onboarding-Welcome, Onboarding-InProgress (Card stands in)
    <View accessibilityRole="list" style={{ gap: space['2'] }}>
      {HUB.rows.map((row, i) => {
        const done = !welcome && rowDone(status, i);
        const current = !welcome && !done && i + 1 === step;
        const editable = done && i < 2;
        const a11y = welcome ? row.title : done ? HUB.rowDone(row.title) : current ? HUB.rowCurrent(row.title) : HUB.rowNotStarted(row.title);
        return (
          <Card
            key={row.title}
            testID={`plan-row-${i + 1}`}
            variant={current ? 'outlined' : 'filled'}
            accessibilityLabel={a11y}
            onPress={editable ? () => nav.push(i === 0 ? 'applicationDetails' : 'applicationVehicle') : undefined}
            contentStyle={{ minHeight: 72 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
              {done ? (
                <Icon name="check" size={icon.md} weight="bold" color={theme.color.text.primary} />
              ) : (
                <Text style={{ ...title, color: theme.color.text.primary, minWidth: icon.md, textAlign: 'center' }}>{i + 1}</Text>
              )}
              <View style={{ flex: 1, gap: space['1'] }}>
                <Text style={{ ...title, color: theme.color.text.primary }}>{row.title}</Text>
                <Text style={{ ...sub, color: theme.color.text.primary }}>{subtitleFor(i, done, current)}</Text>
              </View>
              {done ? <Badge variant="outline" size="lg" icon={<Icon name="check" size={icon.sm} color={theme.color.text.primary} />} label={HUB.done} /> : null}
              {!welcome && !done && !current ? <Badge variant="outline" size="lg" label={HUB.notStarted} /> : null}
              {editable ? <Icon name="chevron-right" size={icon.md} color={theme.color.text.primary} /> : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

// ──────────────────────────────────── R13 application closed ────────────────────────────────────

function ClosedApplication({ support }: { support: Support }): React.ReactElement {
  const theme = useTheme();
  return (
    <Frame
      testID="application-closed"
      ownHeading
      footer={
        <>
          {support.phone ? (
            <>
              <Button testID="call-support" variant="secondary" size="xl" fullWidth onPress={() => callSupport(support)}>
                {CALL_SUPPORT}
              </Button>
              <SupportHours support={support} />
            </>
          ) : (
            <Text testID="no-support" style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary, textAlign: 'center' }}>
              {TERMINAL.noSupport}
            </Text>
          )}
          <Button testID="sign-out" variant="tertiary" size="xl" fullWidth onPress={leave}>
            {SIGN_OUT}
          </Button>
        </>
      }
    >
      <View style={{ gap: space['4'], paddingTop: space['8'] }}>
        <Icon name="lock" size={icon.xl} color={theme.color.text.primary} />
        <Text accessibilityRole="header" style={{ ...typeStyle(theme, 'heading.xl'), color: theme.color.text.primary }}>
          {CLOSED.title}
        </Text>
        <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{CLOSED.body}</Text>
      </View>
    </Frame>
  );
}

// ───────────────────────────────── R06 Your details (step 1) ─────────────────────────────────

type DetailsField = 'first' | 'last' | 'dob' | 'email' | 'tz';
const SUMMARY_ORDER: readonly DetailsField[] = ['first', 'last', 'dob', 'email', 'tz'];
const SUMMARY_LABEL: Record<DetailsField, string> = {
  first: DETAILS.firstName,
  last: DETAILS.lastName,
  dob: DETAILS.dob,
  email: DETAILS.email,
  tz: DETAILS.timezone,
};
const SERVER_FIELD: Record<string, DetailsField> = {
  first_name: 'first',
  last_name: 'last',
  date_of_birth: 'dob',
  email: 'email',
  timezone: 'tz',
};
const SERVER_FIELD_ERROR: Record<DetailsField, string> = {
  first: DETAILS.firstNameRequired,
  last: DETAILS.lastNameRequired,
  dob: DETAILS.dobRequired,
  email: DETAILS.emailInvalid,
  tz: DETAILS.timezoneRequired,
};

/** Positions of the fields in the scroll view, for the error summary's links. */
function useFieldPositions<K extends string>() {
  const scrollRef = React.useRef<ScrollView | null>(null);
  const ys = React.useRef<Partial<Record<K, number>>>({});
  const onLayoutFor = (k: K) => (e: { nativeEvent: { layout: { y: number } } }) => {
    ys.current[k] = e.nativeEvent.layout.y;
  };
  const scrollTo = (k: K) => scrollRef.current?.scrollTo({ y: Math.max(0, (ys.current[k] ?? 0) - space['4']), animated: true });
  return { scrollRef, onLayoutFor, scrollTo };
}

function ErrorSummary<K extends string>({ keys, labels, onGo }: { keys: readonly K[]; labels: Record<K, string>; onGo: (k: K) => void }): React.ReactElement {
  const theme = useTheme();
  return (
    // ds-request(native): ErrorSummary (56 rows) — SO Profile-Required (Banner + ghost buttons stand in)
    <View testID="error-summary" style={{ gap: space['1'] }}>
      <Banner variant="warning" icon={<Icon name="warning" color={theme.color.text.primary} />} title={DETAILS.summary(keys.length)} />
      {keys.map((k) => (
        <Button key={k} testID={`summary-${k}`} variant="ghost" size="xl" fullWidth onPress={() => onGo(k)}>
          {labels[k]}
        </Button>
      ))}
    </View>
  );
}

export function DetailsScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const online = useOnline();
  const status = useStatus();
  const me = session.me;
  const profileDone = status.data?.steps_completed.profile ?? false;

  const [first, setFirst] = React.useState(me.first_name ?? '');
  const [last, setLast] = React.useState(me.last_name ?? '');
  const [day, setDay] = React.useState('');
  const [month, setMonth] = React.useState('');
  const [year, setYear] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [tz, setTz] = React.useState<string | null>(() => presetTimezone());
  const [errors, setErrors] = React.useState<Partial<Record<DetailsField, string>>>({});
  const [summary, setSummary] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState(false);
  const [underage, setUnderage] = React.useState(() => underageState(me.account_id));
  const fields = useFieldPositions<DetailsField>();
  // A second tap lands before the re-render that marks Continue busy: one save at a time.
  const inFlight = React.useRef(false);
  const phonePreset = React.useMemo(() => presetTimezone(), []);

  // A saved profile keeps its zone; a new one is preset from the phone.
  React.useEffect(() => {
    if (profileDone && me.timezone && TIMEZONES.some((t) => t.value === me.timezone)) setTz(me.timezone);
  }, [profileDone, me.timezone]);

  const locked = underage.count >= 2;
  const back = { label: BACK_TO_APPLICATION, onPress: () => void nav.pop() };

  if (status.status === 'loading') {
    return (
      <Frame testID="details-loading" subtitle={DETAILS.subtitle} back={back}>
        <LoadingBody label={DETAILS.loading} />
      </Frame>
    );
  }
  if (!status.data) {
    return <LoadError testID="details-load-error" subtitle={DETAILS.subtitle} back={back} onRetry={() => void status.refetch()} support={support} />;
  }

  const clear = (k: DetailsField) => {
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async () => {
    if (inFlight.current) return;
    const found: Partial<Record<DetailsField, string>> = {};
    if (!first.trim()) found.first = DETAILS.firstNameRequired;
    if (!last.trim()) found.last = DETAILS.lastNameRequired;
    const dob = dateOfBirth(day.trim(), month.trim(), year.trim());
    if (!dob) found.dob = DETAILS.dobRequired;
    if (!tz) found.tz = DETAILS.timezoneRequired;
    setServerError(false);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setSummary(true);
      return;
    }
    setErrors({});
    setSummary(false);
    const body: RiderProfileInput = { first_name: first.trim(), last_name: last.trim(), date_of_birth: dob!, timezone: tz! };
    if (email.trim()) body.email = email.trim();
    setSaving(true);
    inFlight.current = true;
    try {
      await submitProfile(body);
    } catch (e) {
      inFlight.current = false;
      setSaving(false);
      const err = toRiderError(e);
      if (err.kind === 'offline') return; // the offline alert follows `online`
      if (err.code === 'UNDERAGE') {
        const count = recordUnderage(me.account_id, minAgeFrom(err.details));
        setUnderage(underageState(me.account_id));
        if (count < 2) setErrors({ dob: DETAILS.underage(minAgeFrom(err.details)) });
        return;
      }
      if (err.code === 'EMAIL_IN_USE') {
        setErrors({ email: DETAILS.emailInUse });
        return;
      }
      if (err.code === 'VALIDATION_FAILED') {
        const mapped: Partial<Record<DetailsField, string>> = {};
        for (const f of fieldErrors(err.details)) {
          const k = SERVER_FIELD[f];
          if (k) mapped[k] = SERVER_FIELD_ERROR[k];
        }
        if (Object.keys(mapped).length > 0) {
          setErrors(mapped);
          setSummary(true);
          return;
        }
      }
      setServerError(true);
      return;
    }
    await session.refresh();
    inFlight.current = false;
    setSaving(false);
    nav.push('applicationVehicle');
  };

  const summaryKeys = summary ? SUMMARY_ORDER.filter((k) => errors[k]) : [];
  const body = typeStyle(theme, 'body.lg');
  const minAge = underage.minAge;
  const readOnly = saving || locked;

  return (
    <Frame
      testID={locked ? 'details-locked' : 'details'}
      subtitle={DETAILS.subtitle}
      back={back}
      progress={status.data.progress_percent}
      scrollRef={fields.scrollRef}
      footer={
        locked ? (
          <>
            {support.phone ? (
              <Button testID="call-support" variant="secondary" size="xl" fullWidth onPress={() => callSupport(support)}>
                {CALL_SUPPORT}
              </Button>
            ) : null}
            <Button testID="sign-out" variant="tertiary" size="xl" fullWidth onPress={leave}>
              {SIGN_OUT}
            </Button>
          </>
        ) : (
          <>
            <Button
              testID="details-continue"
              variant="primary"
              size="xl"
              fullWidth
              loading={saving}
              disabled={!online}
              iconStart={serverError ? <Icon name="refresh" /> : undefined}
              onPress={() => void submit()}
            >
              {serverError ? TRY_AGAIN : CONTINUE}
            </Button>
            <SupportGhost support={support} />
          </>
        )
      }
    >
      {online ? null : <OfflineAlert body={DETAILS.offlineBody} />}
      <ProgressLine step={1} pct={status.data.progress_percent} />
      {summaryKeys.length > 0 ? <ErrorSummary keys={summaryKeys} labels={SUMMARY_LABEL} onGo={fields.scrollTo} /> : null}
      {serverError ? (
        // ds-request(native): InlineAlert — SO Profile-ServerError (Banner stands in)
        <Banner
          testID="details-server-error"
          variant="warning"
          icon={<Icon name="warning" color={theme.color.text.primary} />}
          title={DETAILS.serverErrorTitle}
          description={DETAILS.serverErrorBody}
        />
      ) : null}
      {locked ? (
        // ds-request(native): InlineAlert — SO Profile-UnderageAgain (Banner stands in)
        <Banner
          testID="details-underage-again"
          variant="neutral"
          icon={<Icon name="clock" color={theme.color.text.primary} />}
          title={DETAILS.underageAgainTitle(minAge)}
          description={DETAILS.underageAgainBody(minAge)}
        />
      ) : null}
      <View style={{ gap: space['2'] }}>
        <Text accessibilityRole="header" style={{ ...typeStyle(theme, 'heading.md'), color: theme.color.text.primary }}>
          {DETAILS.title}
        </Text>
        <Text style={{ ...body, color: theme.color.text.primary }}>{DETAILS.lead}</Text>
      </View>
      {/* ds-request(native): Input size field (56) — SO Profile-Default (lg is 52 today) */}
      <View onLayout={fields.onLayoutFor('first')}>
        <Input
          testID="details-first"
          label={DETAILS.firstName}
          size="lg"
          required
          autoComplete="given-name"
          maxLength={50}
          value={first}
          readOnly={readOnly}
          onChange={(v) => {
            setFirst(v);
            clear('first');
          }}
          errorText={errors.first}
        />
      </View>
      <View onLayout={fields.onLayoutFor('last')}>
        <Input
          testID="details-last"
          label={DETAILS.lastName}
          size="lg"
          required
          autoComplete="family-name"
          maxLength={50}
          value={last}
          readOnly={readOnly}
          onChange={(v) => {
            setLast(v);
            clear('last');
          }}
          errorText={errors.last}
        />
      </View>
      {/* ds-request(native): DateInput (typed Day / Month / Year, never a calendar) — SO Profile-Default (three numeric Inputs stand in) */}
      <View onLayout={fields.onLayoutFor('dob')} accessibilityLabel={DETAILS.dob} style={{ gap: space['2'] }}>
        <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{DETAILS.dob}</Text>
        <View style={{ flexDirection: 'row', gap: space['3'], alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input testID="dob-day" label={DETAILS.day} variant="numeric" size="lg" maxLength={2} autoComplete="bday-day" value={day} readOnly={readOnly} onChange={(v) => { setDay(v.replace(/\D/g, '')); clear('dob'); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Input testID="dob-month" label={DETAILS.month} variant="numeric" size="lg" maxLength={2} autoComplete="bday-month" value={month} readOnly={readOnly} onChange={(v) => { setMonth(v.replace(/\D/g, '')); clear('dob'); }} />
          </View>
          <View style={{ flex: 1.6 }}>
            <Input testID="dob-year" label={DETAILS.year} variant="numeric" size="lg" maxLength={4} autoComplete="bday-year" value={year} readOnly={readOnly} onChange={(v) => { setYear(v.replace(/\D/g, '')); clear('dob'); }} />
          </View>
        </View>
        {errors.dob ? <FieldNote testID="dob-error" text={errors.dob} error /> : <FieldNote testID="dob-helper" text={DETAILS.ageHelper(minAge)} />}
      </View>
      <View onLayout={fields.onLayoutFor('email')}>
        <Input
          testID="details-email"
          label={DETAILS.email}
          variant="email"
          size="lg"
          autoComplete="email"
          maxLength={254}
          value={email}
          readOnly={readOnly}
          helperText={DETAILS.emailHelper}
          onChange={(v) => {
            setEmail(v);
            clear('email');
          }}
          errorText={errors.email}
        />
      </View>
      <View onLayout={fields.onLayoutFor('tz')} style={{ gap: space['2'] }}>
        {/* ds-request(native): Select 56 (field) with helperText — SO Profile-Default */}
        <Select
          testID="details-timezone"
          label={DETAILS.timezone}
          placeholder={DETAILS.timezonePlaceholder}
          options={TIMEZONES.map((t) => ({ value: t.value, label: t.label }))}
          value={tz}
          required
          disabled={readOnly}
          onChange={(v) => {
            setTz(v);
            clear('tz');
          }}
          errorText={errors.tz}
        />
        {/* "Set from your phone" only while the value is the phone's own zone (Profile-Timezone-Error: no preset) */}
        {errors.tz ? null : <FieldNote text={!locked && tz != null && tz === phonePreset ? DETAILS.timezoneHelper : DETAILS.timezoneHelperLocked} />}
      </View>
    </Frame>
  );
}

// ─────────────────────────────── R07 How you deliver (step 2) ───────────────────────────────

type Notice =
  | { kind: 'no-choice' }
  | { kind: 'switched'; from: VehicleType; to: 'BICYCLE' | 'ON_FOOT' }
  | { kind: 'not-applicable'; to: 'BICYCLE' | 'ON_FOOT' }
  | { kind: 'server' };

interface VehicleFields {
  plate: string;
  make: string;
  model: string;
  year: string;
  colour: string;
}
const EMPTY_FIELDS: VehicleFields = { plate: '', make: '', model: '', year: '', colour: '' };

function anyFilled(f: VehicleFields): boolean {
  return Object.values(f).some((v) => v.trim() !== '');
}

export function VehicleScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const session = useSession();
  const support = useSupport();
  const online = useOnline();
  const status = useStatus();
  const saved = session.me.vehicle ?? null;

  const [type, setType] = React.useState<VehicleType | null>(saved?.vehicle_type ?? null);
  const [fields, setFields] = React.useState<VehicleFields>(() => ({
    plate: saved?.licence_plate ?? '',
    make: saved?.make ?? '',
    model: saved?.model ?? '',
    year: saved?.year != null ? String(saved.year) : '',
    colour: saved?.colour ?? '',
  }));
  const [errors, setErrors] = React.useState<{ type?: string; plate?: string; year?: string }>({});
  const [plateInUse, setPlateInUse] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pending, setPending] = React.useState<VehicleType | null>(null);
  const inFlight = React.useRef(false);

  const cameFromDetails = (nav.flow?.length ?? 0) >= 2 && nav.flow?.[nav.flow.length - 2]?.name === 'applicationDetails';
  const back = { label: cameFromDetails ? BACK_TO_DETAILS : BACK_TO_APPLICATION, onPress: () => void nav.pop() };

  if (status.status === 'loading') {
    return (
      <Frame testID="vehicle-loading" subtitle={VEHICLE.subtitle} back={back}>
        <LoadingBody label={VEHICLE.loading} />
      </Frame>
    );
  }
  if (!status.data) {
    return <LoadError testID="vehicle-load-error" subtitle={VEHICLE.subtitle} back={back} onRetry={() => void status.refetch()} support={support} />;
  }

  const docs = addedDocs(status.data).length;
  const docsFor = saved?.vehicle_type ?? null;

  const apply = (next: VehicleType) => {
    if (isMotorised(type) && !isMotorised(next)) {
      if (anyFilled(fields)) setNotice({ kind: 'switched', from: type!, to: next as 'BICYCLE' | 'ON_FOOT' });
      else setNotice(null);
      setFields(EMPTY_FIELDS);
    } else {
      setNotice(null);
    }
    setErrors({});
    setPlateInUse(false);
    setType(next);
  };

  const choose = (value: string) => {
    const next = value as VehicleType;
    if (next === type) return;
    const from = type ?? docsFor;
    // Documents already added for the other kind of vehicle: confirm first (Vehicle-ChangeAfterDocs).
    if (docs > 0 && from && isMotorised(from) !== isMotorised(next)) {
      setPending(next);
      return;
    }
    apply(next);
  };

  const set = (k: keyof VehicleFields) => (v: string) => {
    setFields((f) => ({ ...f, [k]: k === 'year' ? v.replace(/\D/g, '') : v }));
    if (k === 'plate' && (errors.plate || plateInUse)) {
      setErrors((e) => ({ ...e, plate: undefined }));
      setPlateInUse(false);
    }
    if (k === 'year' && errors.year) setErrors((e) => ({ ...e, year: undefined }));
  };

  const submit = async () => {
    if (inFlight.current) return;
    if (!type) {
      setNotice({ kind: 'no-choice' });
      setErrors({ type: VEHICLE.noChoiceError });
      return;
    }
    const motorised = isMotorised(type);
    const plate = fields.plate.trim().toUpperCase();
    const found: typeof errors = {};
    if (motorised) {
      if (plate.length < 2 || plate.length > 8) found.plate = VEHICLE.plateRequired(type);
      const y = fields.year.trim();
      if (y && (!/^\d{4}$/.test(y) || Number(y) < MIN_VEHICLE_YEAR || Number(y) > new Date().getFullYear() + 1)) found.year = VEHICLE.yearRange;
    }
    if (notice?.kind !== 'switched') setNotice(null);
    setPlateInUse(false);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // Bicycle and on foot send the type alone: the contract wants the other fields absent.
    const body: RiderVehicleInput = { vehicle_type: type };
    if (motorised) {
      body.licence_plate = plate;
      if (fields.make.trim()) body.make = fields.make.trim();
      if (fields.model.trim()) body.model = fields.model.trim();
      if (fields.year.trim()) body.year = Number(fields.year.trim());
      if (fields.colour.trim()) body.colour = fields.colour.trim();
    }
    setSaving(true);
    inFlight.current = true;
    try {
      await submitVehicle(body);
    } catch (e) {
      inFlight.current = false;
      setSaving(false);
      const err = toRiderError(e);
      if (err.kind === 'offline') return;
      if (err.code === 'PLATE_IN_USE') {
        setPlateInUse(true);
        setErrors({ plate: VEHICLE.plateInUse });
        return;
      }
      if (err.code === 'FIELD_REQUIRED' && motorised) {
        setErrors({ plate: VEHICLE.plateRequired(type) });
        return;
      }
      if (err.code === 'FIELD_NOT_APPLICABLE' && !motorised) {
        setFields(EMPTY_FIELDS);
        setNotice({ kind: 'not-applicable', to: type as 'BICYCLE' | 'ON_FOOT' });
        return;
      }
      if (err.code === 'VALIDATION_FAILED') {
        const bad = fieldErrors(err.details);
        const mapped: typeof errors = {};
        if (bad.has('licence_plate')) mapped.plate = VEHICLE.plateRequired(type);
        if (bad.has('year')) mapped.year = VEHICLE.yearRange;
        if (Object.keys(mapped).length > 0) {
          setErrors(mapped);
          return;
        }
      }
      setNotice({ kind: 'server' });
      return;
    }
    await session.refresh();
    inFlight.current = false;
    setSaving(false);
    nav.push('applicationDocuments');
  };

  const motorised = isMotorised(type);
  const retry = notice?.kind === 'server' || notice?.kind === 'not-applicable';
  const bodyType = typeStyle(theme, 'body.lg');

  return (
    <Frame
      testID="vehicle"
      subtitle={VEHICLE.subtitle}
      back={back}
      progress={status.data.progress_percent}
      footer={
        <>
          <Button
            testID="vehicle-continue"
            variant="primary"
            size="xl"
            fullWidth
            loading={saving}
            disabled={!online}
            iconStart={retry ? <Icon name="refresh" /> : undefined}
            onPress={() => void submit()}
          >
            {retry ? TRY_AGAIN : CONTINUE}
          </Button>
          <SupportGhost support={support} />
        </>
      }
    >
      {online ? null : <OfflineAlert body={VEHICLE.offlineBody} />}
      <ProgressLine step={2} pct={status.data.progress_percent} />
      {notice ? <VehicleNotice notice={notice} /> : null}
      {docs > 0 && docsFor ? (
        <Text testID="vehicle-docs-added" style={{ ...bodyType, color: theme.color.text.primary }}>
          {VEHICLE.docsAdded(docs, docsFor)}
        </Text>
      ) : null}
      {/* ds-request(native): RadioGroup roomy (72 rows) — SO Vehicle-Empty (Radio 24 stands in; rows are 56) */}
      <RadioGroup
        testID="vehicle-type"
        name="vehicle_type"
        label={VEHICLE.question}
        required
        value={type}
        disabled={saving}
        onChange={choose}
        errorText={errors.type}
      >
        {VEHICLE.options.map((o) => (
          <Radio key={o.value} testID={`vehicle-${o.value}`} value={o.value} label={o.label} description={o.description} size={24} />
        ))}
      </RadioGroup>
      {type && motorised ? (
        <View testID="vehicle-about" style={{ gap: space['5'] }}>
          <Text accessibilityRole="header" style={{ ...typeStyle(theme, 'heading.md'), color: theme.color.text.primary }}>
            {VEHICLE.about(type)}
          </Text>
          {errors.plate && !plateInUse ? <Text style={{ ...bodyType, color: theme.color.text.primary }}>{VEHICLE.plateNeeded(type)}</Text> : null}
          <View style={{ gap: space['2'] }}>
            <Input testID="vehicle-plate" label={VEHICLE.plate} size="lg" required maxLength={8} value={fields.plate} readOnly={saving} onChange={set('plate')} errorText={errors.plate} />
            {plateInUse && support.phone ? (
              <>
                <Button testID="its-my-vehicle" variant="tertiary" size="xl" fullWidth onPress={() => callSupport(support)}>
                  {VEHICLE.itsMine}
                </Button>
                <SupportHours support={support} />
              </>
            ) : null}
          </View>
          <Input testID="vehicle-make" label={VEHICLE.make} size="lg" maxLength={50} value={fields.make} readOnly={saving} onChange={set('make')} />
          <Input testID="vehicle-model" label={VEHICLE.model} size="lg" maxLength={50} value={fields.model} readOnly={saving} onChange={set('model')} />
          <Input testID="vehicle-year" label={VEHICLE.year} variant="numeric" size="lg" maxLength={4} value={fields.year} readOnly={saving} onChange={set('year')} errorText={errors.year} />
          <Input testID="vehicle-colour" label={VEHICLE.colour} size="lg" maxLength={30} value={fields.colour} readOnly={saving} onChange={set('colour')} />
        </View>
      ) : null}
      {pending && type ? (
        <Modal
          testID="vehicle-change"
          open
          variant="confirm"
          title={VEHICLE.changeTitle(pending)}
          description={VEHICLE.changeBody(pending, isMotorised(pending))}
          onClose={() => setPending(null)}
          actions={[
            { label: VEHICLE.changeKeep(type), onPress: () => setPending(null), testID: 'vehicle-change-keep' },
            {
              label: VEHICLE.changeConfirm(pending),
              onPress: () => {
                const next = pending;
                setPending(null);
                apply(next);
              },
              testID: 'vehicle-change-confirm',
            },
          ]}
        />
      ) : null}
    </Frame>
  );
}

function VehicleNotice({ notice }: { notice: Notice }): React.ReactElement {
  const theme = useTheme();
  const glyph = (name: 'info' | 'warning') => <Icon name={name} color={theme.color.text.primary} />;
  // ds-request(native): InlineAlert — SO Vehicle-NoChoice, Vehicle-Switched, Vehicle-NotApplicable, Vehicle-Error (Banner stands in)
  switch (notice.kind) {
    case 'no-choice':
      return <Banner testID="vehicle-no-choice" variant="warning" icon={glyph('warning')} title={VEHICLE.noChoiceTitle} description={VEHICLE.noChoiceBody} />;
    case 'switched':
      return <Banner testID="vehicle-switched" variant="neutral" icon={glyph('info')} title={VEHICLE.switchedTitle(notice.from)} description={VEHICLE.switchedBody(notice.to)} />;
    case 'not-applicable':
      return <Banner testID="vehicle-not-applicable" variant="warning" icon={glyph('warning')} title={VEHICLE.saveErrorTitle} description={VEHICLE.notApplicableBody(notice.to)} />;
    default:
      return <Banner testID="vehicle-server-error" variant="warning" icon={glyph('warning')} title={VEHICLE.saveErrorTitle} description={VEHICLE.serverErrorBody} />;
  }
}
