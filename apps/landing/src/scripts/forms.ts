/**
 * Wires every waitlist form on the page.
 *
 * Progressive by construction: if this module never loads, the form still POSTs
 * natively to /api/waitlist, which re-validates everything from scratch.
 *
 * Two behaviours worth naming:
 *  - Success REPLACES the form rather than disabling it in place. A greyed-out
 *    form with a line of text under it reads as "something went wrong".
 *  - An address already on the list is rendered as SUCCESS, never as an error.
 *    The user did the right thing; telling them off for it is the fastest way to
 *    lose them, and it also leaks who is on the list.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function getUtm(): Record<string, string> {
  try {
    const stored = sessionStorage.getItem('hg-utm');
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

function track(event: string, props: Record<string, unknown>) {
  (window as unknown as { rudderanalytics?: { track?: (e: string, p: unknown) => void } })
    .rudderanalytics?.track?.(event, props);
}

function post(payload: Record<string, unknown>) {
  return fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function successMarkup(audience: 'eat' | 'own', echo: string): string {
  if (audience === 'own') {
    return `
      <div class="wf-done">
        <p class="wf-done-head">Check your inbox.</p>
        <p class="wf-done-body">We'll send what we check and what it costs to ${echo}. If nothing lands in ten minutes, look in spam.</p>
      </div>`;
  }
  return `
    <div class="wf-done">
      <p class="wf-done-head">You're on the list.</p>
      <p class="wf-done-body">We'll email ${echo} the day we open in your area. One email. That's the deal.</p>
      <div class="wf-after">
        <label class="field">
          <span class="field-label" for="wf-city">Where in Ontario are you?</span>
          <input id="wf-city" type="text" name="city" autocomplete="address-level2" placeholder="Mississauga" />
        </label>
        <button type="button" class="btn btn--outline btn--md" data-city-add>Add it</button>
      </div>
      <p class="form-help">Optional. It tells us where to open first.</p>
      <button type="button" class="tlink wf-copy" data-copy>Copy the link <span class="arw" aria-hidden="true">→</span></button>
    </div>`;
}

function wire(form: HTMLFormElement) {
  const audience = (form.dataset.audience as 'eat' | 'own') || 'eat';
  const context = form.dataset.context || 'unknown';
  const consentText = form.dataset.consentText || '';
  const msg = form.querySelector<HTMLElement>('.formmsg');
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (!msg || !submit) return;

  const fail = (text: string) => {
    msg.textContent = text;
    msg.setAttribute('data-tone', 'error');
  };
  const clear = () => {
    msg.textContent = '';
    msg.removeAttribute('data-tone');
  };

  function succeed(echo: string) {
    form.innerHTML = successMarkup(audience, echo);
    form.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(window.location.origin || 'https://halalgoes.com');
        const was = btn.innerHTML;
        btn.textContent = 'Link copied';
        setTimeout(() => { btn.innerHTML = was; }, 2000);
      } catch {
        btn.textContent = window.location.origin;
      }
    });
    form.querySelector<HTMLButtonElement>('[data-city-add]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const city = form.querySelector<HTMLInputElement>('[name="city"]')?.value.trim();
      if (!city) return;
      void post({ audience, context: `${context}:city`, city, utm: getUtm() });
      btn.disabled = true;
      btn.textContent = 'Added';
      track('Waitlist City Added', { audience, context });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear();

    const payload: Record<string, unknown> = {
      audience,
      context,
      utm: getUtm(),
      // The rendered sentence, not just a boolean — so the consent artifact
      // survives a later copy edit to the checkbox label.
      consentText,
      consentAt: new Date().toISOString(),
    };

    const email = (form.querySelector<HTMLInputElement>('[name="email"]')?.value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return fail("That email doesn't look right.");
    payload.email = email;
    const echo = email;

    // Submitting this form IS the express consent — there is nothing else it
    // could mean, and the notice sits directly above the button. We record how
    // it was obtained so the artifact is honest about the mechanism.
    payload.consent = true;
    payload.consentMethod = 'form_submit';

    submit.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    try {
      const res = await post(payload);
      // 409 = already on the list. That is a success from where the user sits.
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      track('Waitlist Joined', { audience, context, duplicate: res.status === 409 });
      succeed(echo);
    } catch {
      fail("That didn't send. Try once more.");
      submit.disabled = false;
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });
}

document.querySelectorAll<HTMLFormElement>('.waitlist-form').forEach(wire);
