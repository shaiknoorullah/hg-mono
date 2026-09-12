// Wires every waitlist form on the page: client validation (E.164 phone / email),
// CASL consent timestamp, UTM attribution, POST to /api/waitlist. Progressive —
// the form still POSTs natively if JS fails, and the endpoint re-validates.

function toE164CA(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed; // already E.164
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function getUtm(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const stored = sessionStorage.getItem('hg-utm');
    if (stored) Object.assign(out, JSON.parse(stored));
  } catch {}
  return out;
}

function wire(form: HTMLFormElement) {
  const audience = form.dataset.audience as 'eat' | 'own';
  const context = form.dataset.context || 'unknown';
  const msg = form.querySelector<HTMLElement>('.formmsg')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;

  function fail(text: string) {
    msg.textContent = text;
    msg.setAttribute('data-err', '');
    msg.removeAttribute('data-ok');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.removeAttribute('data-err');
    msg.removeAttribute('data-ok');

    const payload: Record<string, unknown> = { audience, context, utm: getUtm() };

    if (audience === 'eat') {
      const raw = (form.querySelector<HTMLInputElement>('[name="phone"]')?.value || '').trim();
      const e164 = toE164CA(raw);
      if (!e164) return fail('Enter a valid Canadian phone number.');
      payload.phone = e164;
      const consent = form.querySelector<HTMLInputElement>('[name="consent"]');
      payload.consent = consent ? consent.checked : true;
      payload.consentAt = new Date().toISOString();
      if (consent && !consent.checked) return fail('Please tick consent so we can text you once at launch.');
    } else {
      const email = (form.querySelector<HTMLInputElement>('[name="email"]')?.value || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.');
      payload.email = email;
      payload.consentAt = new Date().toISOString();
    }

    submit.setAttribute('aria-busy', 'true');
    submit.setAttribute('disabled', 'true');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      msg.textContent = audience === 'eat'
        ? "You're on the list — we'll text you once, on launch day."
        : "You're on the list — we'll email you about onboarding.";
      msg.setAttribute('data-ok', '');
      form.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.disabled = true));
      submit.textContent = 'Done';
      // analytics hook (no-op unless a tracker is present)
      (window as any).rudderanalytics?.track?.('Waitlist Joined', { audience, context });
    } catch {
      fail('Something went wrong. Please try again in a moment.');
      submit.removeAttribute('disabled');
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });
}

document.querySelectorAll<HTMLFormElement>('.waitlist-form').forEach(wire);
