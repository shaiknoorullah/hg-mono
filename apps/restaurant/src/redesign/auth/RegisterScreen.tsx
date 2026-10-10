/**
 * `/register` — Register your restaurant (canvas SI `Register-*`; WP2 spec §2).
 *
 * `terms_version` comes from `getPublicConfig`, never a constant (fixes the e2e step
 * `02-register-submit-terms-version-bug`); a `409 TERMS_VERSION_STALE` re-reads the config, shows
 * the new version and unticks the box. The acceptance box starts unticked. The Idempotency-Key is
 * made once per intent (one set of answers) and sent again on every retry of it, so "Trying again
 * won't create a second account" is true. 201 issues no session: the owner confirms the email
 * first, on `/check-email`.
 *
 * The owner never accepts terms the page could not load: while `getPublicConfig` is loading or
 * has failed, the box cannot be ticked and Create account is unavailable (a failed load offers
 * Try again). A config that loads without `terms_version` (optional in the contract; `services/hg`
 * omits it today, #738) still lets the owner submit: the server answers 409 TERMS_VERSION_STALE
 * with the version, which the page then shows, unticking the box, so the acceptance that counts
 * always names a version on screen.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { idempotencyKey, type Schema } from '@hg/api-client';
import { client } from '../data/client';
import { Button, Checkbox, GlyphIcon, InlineAlert, Input, StateCard, StateCardHeading, TextLink, usePageAnnouncer, WaitLine, type InlineAlertSummaryItem } from '../ds';
import { attempt, HG_CLIENT, looksLikeEmail, serverWait, usePublicConfig, type ServerWait } from './api';
import { COMMON, REGISTER, SIGN_IN } from './copy';
import type { CheckEmailEntry } from './CheckEmailScreen';

type Field = 'name' | 'email' | 'password' | 'terms';
type FieldErrors = Partial<Record<Field, string>>;

type Problem =
  | { kind: 'errors' }
  | { kind: 'taken' }
  | { kind: 'terms' }
  | { kind: 'net' }
  | { kind: 'rate'; wait: ServerWait | null };

const FIELD_IDS: Record<Field, string> = { name: 'reg-name', email: 'reg-email', password: 'reg-password', terms: 'reg-terms' };
const FIELD_ORDER: Field[] = ['name', 'email', 'password', 'terms'];
const SUMMARY_LABEL: Record<Field, string> = {
  name: REGISTER.name,
  email: REGISTER.email,
  password: REGISTER.password,
  terms: REGISTER.summaryTerms,
};

/** `FieldError.field` (contract names) → this form's field. */
const SERVER_FIELD: Record<string, Field> = {
  business_name: 'name',
  email: 'email',
  password: 'password',
  terms_version: 'terms',
};

/** Characters as a person counts them (code points), not UTF-16 units: an Arabic name counts right. */
function characters(text: string): number {
  return [...text].length;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function clientErrors(name: string, email: string, password: string, accepted: boolean): FieldErrors {
  const errors: FieldErrors = {};
  const n = characters(name.trim());
  if (n < 2) errors.name = REGISTER.nameError;
  else if (n > 120) errors.name = REGISTER.nameTooLong;
  if (!looksLikeEmail(email)) errors.email = REGISTER.emailError;
  if ([...password].length < 12) errors.password = REGISTER.passwordError;
  else if (new TextEncoder().encode(password).length > 256) errors.password = REGISTER.passwordTooLong;
  if (!accepted) errors.terms = REGISTER.termsError;
  return errors;
}

/**
 * A `422 VALIDATION_FAILED` without `FieldError` details (`services/hg` sends it for the email and
 * the business name, #739): the fields the server checks there, by the server's own rules
 * (email 3-254 bytes with an inner `@` and no spaces; name 2-120 UTF-8 bytes). When neither
 * explains it, both are marked: it is still something to change, never a network failure.
 */
function unexplainedRefusal(name: string, email: string): FieldErrors {
  const trimmedEmail = email.trim();
  const at = trimmedEmail.indexOf('@');
  const emailBytes = utf8Bytes(trimmedEmail);
  const emailRefused = emailBytes < 3 || emailBytes > 254 || at <= 0 || at === trimmedEmail.length - 1 || /\s/.test(trimmedEmail);
  const nameBytes = utf8Bytes(name.trim());
  const nameRefused = nameBytes < 2 || nameBytes > 120;
  const errors: FieldErrors = {};
  if (nameRefused || !emailRefused) errors.name = REGISTER.nameRefused;
  if (emailRefused || !nameRefused) errors.email = REGISTER.emailRefused;
  return errors;
}

export function RegisterScreen() {
  const navigate = useNavigate();
  const config = usePublicConfig();
  const { announce } = usePageAnnouncer();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failures, setFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  /** The server's newer version after a 409 TERMS_VERSION_STALE, until the config catches up. */
  const [staleCurrent, setStaleCurrent] = useState<string | null>(null);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const termsRef = useRef<HTMLButtonElement>(null);

  const termsVersion = staleCurrent ?? config.data?.terms_version ?? null;
  const termsUpdated = problem?.kind === 'terms' || staleCurrent !== null;
  const waiting = problem?.kind === 'rate' && problem.wait !== null;
  /** The terms could not be read (loading, or the read failed): nothing to accept yet. */
  const termsUnavailable = config.data === null && staleCurrent === null;

  // Terms that are not on screen cannot stay accepted.
  useEffect(() => {
    if (termsUnavailable) setAccepted(false);
  }, [termsUnavailable]);

  // The config caught up with the server's newer version.
  useEffect(() => {
    if (staleCurrent && config.data?.terms_version === staleCurrent) setStaleCurrent(null);
  }, [config.data, staleCurrent]);

  function fail(next: Problem) {
    setProblem(next);
    setFailures((n) => n + 1);
  }

  /** One key per intent: the same answers reuse it; changed answers are a new intent. */
  function keyFor(body: Schema['RestaurantRegistrationInput']): string {
    const serialised = JSON.stringify(body);
    if (!intent.current || intent.current.body !== serialised) intent.current = { key: idempotencyKey(), body: serialised };
    return intent.current.key;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || waiting || termsUnavailable) return;
    const found = clientErrors(name, email, password, accepted);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      fail({ kind: 'errors' });
      return;
    }
    const body: Schema['RestaurantRegistrationInput'] = {
      email: email.trim(),
      password,
      business_name: name.trim(),
      // The server's own value; when the config does not carry one yet, the 409 below names it.
      terms_version: termsVersion ?? '',
    };
    const key = keyFor(body);
    setBusy(true);
    const res = await attempt(() =>
      client.POST('/v1/auth/register/restaurant', { params: { header: { ...HG_CLIENT, 'Idempotency-Key': key } }, body }),
    );
    setBusy(false);
    if (res.ok) {
      intent.current = null;
      const entry: CheckEmailEntry = { email: res.data.email ?? body.email, business_name: body.business_name, start: 'default' };
      navigate('/check-email', { state: entry });
      return;
    }
    if (res.network) {
      fail({ kind: 'net' });
      return;
    }
    switch (res.code) {
      case 'VALIDATION_FAILED': {
        const list = Array.isArray(res.details) ? (res.details as Schema['FieldError'][]) : [];
        const mapped: FieldErrors = {};
        for (const fe of list) {
          const field = SERVER_FIELD[fe.field.split(/[.[]/)[0] ?? ''];
          if (field && !mapped[field]) mapped[field] = { name: REGISTER.nameError, email: REGISTER.emailError, password: REGISTER.passwordError, terms: REGISTER.termsError }[field];
        }
        setErrors(Object.keys(mapped).length > 0 ? mapped : unexplainedRefusal(name, email));
        fail({ kind: 'errors' });
        return;
      }
      case 'BREACHED_PASSWORD':
        setErrors({ password: REGISTER.breached });
        fail({ kind: 'errors' });
        return;
      case 'EMAIL_ALREADY_REGISTERED':
        setErrors({ email: REGISTER.takenField });
        fail({ kind: 'taken' });
        return;
      case 'TERMS_VERSION_STALE': {
        const current = (res.details as { current?: unknown } | null)?.current;
        setStaleCurrent(typeof current === 'string' ? current : null);
        setAccepted(false);
        setErrors({});
        void config.refresh();
        fail({ kind: 'terms' });
        return;
      }
      case 'RATE_LIMITED':
        fail({ kind: 'rate', wait: serverWait(res.serverDate, res.retryAfter ?? 60) });
        return;
      case 'IDEMPOTENCY_KEY_REUSE':
        intent.current = null;
        fail({ kind: 'net' });
        return;
      default:
        fail({ kind: 'net' });
    }
  }

  const summaryItems: InlineAlertSummaryItem[] = FIELD_ORDER.filter((f) => errors[f]).map((f) => ({
    targetId: FIELD_IDS[f],
    label: SUMMARY_LABEL[f],
    onActivate: f === 'terms' ? () => termsRef.current?.focus() : undefined,
  }));

  const banner = (() => {
    switch (problem?.kind) {
      case 'errors':
        return summaryItems.length > 0 ? (
          <InlineAlert key={failures} tone="danger" icon="error" blocking title={REGISTER.summaryTitle(summaryItems.length)} items={summaryItems} />
        ) : null;
      case 'taken':
        return (
          <div className="flex flex-col items-start gap-2">
            <InlineAlert key={failures} tone="info" icon="info" blocking title={REGISTER.takenTitle}>
              <span>{REGISTER.takenBody}</span>
            </InlineAlert>
            <Button variant="tertiary" size="md" type="button" onPress={() => navigate('/login', { state: { email: email.trim() } })}>
              {REGISTER.signIn}
            </Button>
          </div>
        );
      case 'terms':
        return (
          <InlineAlert key={failures} tone="warning" icon="warning" blocking title={REGISTER.termsChangedTitle}>
            <span>{REGISTER.termsChangedBody}</span>
          </InlineAlert>
        );
      case 'net':
        return (
          <InlineAlert key={failures} tone="neutral" icon="warning" blocking title={REGISTER.netTitle}>
            <span>{REGISTER.netBody}</span>
          </InlineAlert>
        );
      case 'rate':
        return (
          <InlineAlert key={failures} tone="warning" icon="clock" title={SIGN_IN.tooManyTitle}>
            <span>{SIGN_IN.tooManyBody}</span>
          </InlineAlert>
        );
      default:
        return null;
    }
  })();

  const clear = (f: Field) => {
    if (errors[f]) setErrors((x) => ({ ...x, [f]: undefined }));
  };

  return (
    <>
      <StateCard testId="register-card">
        <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex flex-col gap-5" aria-label={REGISTER.title}>
          <StateCardHeading title={REGISTER.title} intro={REGISTER.intro} />
          {banner}
          <Input
            id={FIELD_IDS.name}
            label={REGISTER.name}
            helperText={REGISTER.nameHelp}
            size="lg"
            autoComplete="organization"
            value={name}
            onChange={(v) => {
              setName(v);
              clear('name');
            }}
            errorText={errors.name}
            required
          />
          <Input
            id={FIELD_IDS.email}
            label={REGISTER.email}
            helperText={REGISTER.emailHelp}
            variant="email"
            autoComplete="email"
            size="lg"
            value={email}
            onChange={(v) => {
              setEmail(v);
              clear('email');
            }}
            errorText={errors.email}
            required
          />
          <Input
            id={FIELD_IDS.password}
            label={REGISTER.password}
            helperText={REGISTER.passwordHelp}
            variant="password"
            autoComplete="new-password"
            size="lg"
            value={password}
            onChange={(v) => {
              setPassword(v);
              clear('password');
            }}
            errorText={errors.password}
            required
          />
          <div className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4" data-testid="terms-box">
            {/* Needs API: the terms document's URL. Until then the label is plain text, not a link. */}
            <p className="m-0 text-label-lg text-fg-primary">{termsUpdated ? REGISTER.termsUpdated : REGISTER.terms}</p>
            {termsVersion ? <p className="m-0 text-body-sm text-fg-secondary">{REGISTER.termsVersion(termsVersion)}</p> : null}
          </div>
          {config.status === 'error' && termsUnavailable ? (
            <div className="flex flex-col items-start gap-2">
              <InlineAlert tone="neutral" icon="warning" title={REGISTER.termsLoadTitle}>
                <span>{REGISTER.termsLoadBody}</span>
              </InlineAlert>
              <Button variant="tertiary" size="md" type="button" iconStart={<GlyphIcon name="refresh" size="md" />} onPress={config.reload}>
                {SIGN_IN.tryAgain}
              </Button>
            </div>
          ) : null}
          <div id={FIELD_IDS.terms}>
            <Checkbox
              ref={termsRef}
              label={REGISTER.accept}
              disabled={termsUnavailable}
              checked={accepted}
              onChange={(v) => {
                setAccepted(v);
                clear('terms');
              }}
              error={errors.terms}
              size={24}
              name="terms"
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            type="submit"
            loading={busy}
            disabled={waiting || termsUnavailable}
            iconStart={problem?.kind === 'net' ? <GlyphIcon name="refresh" size="md" /> : undefined}
            {...(waiting ? { 'aria-describedby': 'wait-reason' } : {})}
          >
            {REGISTER.submit}
          </Button>
          {problem?.kind === 'rate' && problem.wait ? (
            <WaitLine
              prefix={COMMON.waitPrefix}
              label={COMMON.waitLabel}
              wait={problem.wait}
              onExpire={() => {
                setProblem((p) => (p?.kind === 'rate' ? { kind: 'rate', wait: null } : p));
                announce(COMMON.waitOver, 'polite');
              }}
            />
          ) : null}
        </form>
      </StateCard>
      <p className="m-0 text-center text-body-md text-fg-secondary">
        {REGISTER.alreadyBefore}
        <TextLink to="/login">{REGISTER.signIn}</TextLink>
      </p>
    </>
  );
}
