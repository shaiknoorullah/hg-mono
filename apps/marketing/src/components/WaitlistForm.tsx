'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { joinWaitlist, type WaitlistResult } from '@/app/actions/waitlist';
import { SwapLabel } from '@/components/SwapLabel';
import { type AudienceTrack } from '@/lib/audiences';

const INITIAL: WaitlistResult = { status: 'idle' };

/**
 * Four states, all of them implemented: idle, submitting, invalid/error, done.
 * A happy-path-only form does not merge (AGENTS.md §6).
 *
 * It is a real <form> with a server action, so it works before hydration and
 * keeps working if the JavaScript never arrives.
 */
export function WaitlistForm({ track }: { track: AudienceTrack }) {
  const [result, submit, pending] = useActionState(joinWaitlist, INITIAL);
  const id = useId();
  const fieldId = `${id}-contact`;
  const consentId = `${id}-consent`;
  const messageId = `${id}-message`;
  const contactRef = useRef<HTMLInputElement>(null);

  // Send focus back to the field the visitor has to fix. The live region
  // announces the message; without this they would then have to find their way
  // back to the input themselves.
  useEffect(() => {
    if (result.status === 'invalid' && result.field === 'contact') contactRef.current?.focus();
  }, [result]);

  const card =
    'box-border rounded-2xl border border-line-decorative bg-surface-raised p-[18px] md:rounded-2xl md:p-7';

  if (result.status === 'ok') {
    return (
      <div className={card}>
        <p className="m-0 font-display text-heading-xl text-fg-primary">You’re on the list.</p>
        <p className="mt-2 mb-0 text-body-md text-mk-ink">
          {track.id === 'restaurant'
            ? 'We’ll email you when we open listings in your city. Nothing before then.'
            : 'We’ll text you once, the day we launch in your city. Nothing before then.'}
        </p>
      </div>
    );
  }

  const invalidField = result.status === 'invalid' ? result.field : null;
  const message = result.status === 'invalid' || result.status === 'error' ? result.message : null;
  // React resets an uncontrolled form once its action resolves. Re-seeding the
  // defaults from what was submitted is what stops a failed attempt wiping the
  // field the visitor just filled in.
  const values = result.status === 'invalid' || result.status === 'error' ? result.values : undefined;

  return (
    <form action={submit} className={card} noValidate>
      <input type="hidden" name="audience" value={track.id} />

      <label htmlFor={fieldId} className="block text-label-lg font-semibold text-fg-primary">
        {track.form.label}
      </label>

      <div className="mt-2.5 flex flex-col gap-2.5 md:flex-row">
        <input
          id={fieldId}
          name="contact"
          type={track.form.type}
          inputMode={track.form.inputMode}
          autoComplete={track.form.autoComplete}
          placeholder={track.form.placeholder}
          defaultValue={values?.contact ?? ''}
          ref={contactRef}
          required
          aria-invalid={invalidField === 'contact' || undefined}
          aria-describedby={message ? messageId : undefined}
          className={`h-14 w-full min-w-0 rounded-md md:flex-1 border-[1.5px] bg-control-bg px-4 text-body-lg text-fg-primary placeholder:text-fg-placeholder ${
            invalidField === 'contact' ? 'border-feedback-danger-border' : 'border-control-border'
          }`}
        />

        <button
          type="submit"
          disabled={pending}
          className="group inline-flex h-14 flex-none items-center justify-center rounded-md bg-action-primary-bg px-[26px] text-body-lg font-bold whitespace-nowrap text-action-primary-fg transition-[transform,background-color] duration-[180ms] ease-[var(--hg-ease-spring)] hover:-translate-y-0.5 hover:bg-action-primary-bg-pressed disabled:translate-y-0 disabled:opacity-60 motion-reduce:hover:translate-y-0"
        >
          {pending ? 'Sending…' : <SwapLabel>{track.form.submit}</SwapLabel>}
        </button>
      </div>

      {/* CASL. Unticked, adjacent to the field, and the wording is stored with
          the signup so we can show what was agreed to. */}
      <div className="mt-3.5 flex items-start gap-2.5">
        <input
          id={consentId}
          name="consent"
          type="checkbox"
          defaultChecked={values?.consent ?? false}
          aria-invalid={invalidField === 'consent' || undefined}
          aria-describedby={message ? messageId : undefined}
          className="mt-0.5 size-6 flex-none accent-[var(--hg-action-primary-bg)]"
        />
        <label htmlFor={consentId} className="text-body-sm leading-relaxed text-mk-ink">
          {track.form.consent}
        </label>
      </div>

      <p
        id={messageId}
        role="status"
        aria-live="polite"
        className={`mt-3 mb-0 text-body-sm leading-relaxed ${
          message ? 'text-feedback-danger-text' : 'text-mk-ink'
        }`}
      >
        {message ?? track.form.reassurance}
      </p>
    </form>
  );
}
