'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { joinWaitlist, type WaitlistResult } from '@/app/actions/waitlist';
import { captureAttribution, readAttribution } from '@/lib/attribution';
import { SwapLabel } from '@/components/SwapLabel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AudienceTrack } from '@/lib/audiences';

const INITIAL: WaitlistResult = { status: 'idle' };

/**
 * Four states, all of them implemented: idle, submitting, invalid/error, done.
 * A happy-path-only form does not merge (AGENTS.md §6).
 *
 * Built on the shadcn primitives rather than raw elements. They carry the box
 * model, the focus ring, the disabled and invalid handling, and — for the
 * checkbox — the Radix control that keeps a custom-rendered tick keyboard- and
 * screen-reader-correct. Sizing is passed as className: the components merge
 * with tailwind-merge, so `h-14` replaces their default height instead of
 * fighting it.
 *
 * Still a real <form> with a server action, so it works before hydration.
 */
/**
 * `compact` is for the sticky bar, which is a strip across the bottom of a page
 * somebody is trying to read. Full height there measured 202px of a 900px
 * viewport — a fifth of the screen taken from the page to hold a form nobody
 * asked for yet. Compact drops the field label to screen readers only, loses
 * the reassurance line (the footer form carries it), and shortens the controls.
 *
 * What it does NOT drop is the consent sentence. CASL consent travels with the
 * field and is never implied, so a variant that hides it would not be a smaller
 * form — it would be a different, worse one.
 */
export function WaitlistForm({
  track,
  context,
  compact = false,
}: {
  track: AudienceTrack;
  context: string;
  compact?: boolean;
}) {
  const [result, submit, pending] = useActionState(joinWaitlist, INITIAL);
  // Read once, on the client, after mount: sessionStorage does not exist during
  // the server render, so a hidden field seeded from it would be a hydration
  // mismatch. Empty until then, which is the honest value.
  const [utm, setUtm] = useState('');
  const id = useId();
  const fieldId = `${id}-contact`;
  const consentId = `${id}-consent`;
  const messageId = `${id}-message`;
  const contactRef = useRef<HTMLInputElement>(null);

  // Send focus back to the field the visitor has to fix. The live region
  // announces the message; without this they would have to find their way back.
  useEffect(() => {
    if (result.status === 'invalid' && result.field === 'contact') contactRef.current?.focus();
  }, [result]);

  useEffect(() => {
    captureAttribution();
    const found = readAttribution();
    setUtm(Object.keys(found).length > 0 ? JSON.stringify(found) : '');
  }, []);

  if (result.status === 'ok') {
    return (
      <Card
        data-slot="card"
        className={
          compact
            ? 'gap-0 rounded-none border-0 bg-transparent p-0 shadow-none'
            : 'gap-0 rounded-2xl border-line-decorative p-[18px] shadow-none lg:p-7'
        }
      >
        <p className="m-0 font-display text-heading-xl text-fg-primary">You’re on the list.</p>
        <p className="mt-2 mb-0 text-body-md text-mk-ink">
          {track.id === 'restaurant'
            ? 'We’ll email you what we check, what it costs and how to get listed. If nothing lands in ten minutes, look in spam.'
            : 'We’ll email you once, the day we open in your area. Nothing before then.'}
        </p>
      </Card>
    );
  }

  const invalidField = result.status === 'invalid' ? result.field : null;
  const message = result.status === 'invalid' || result.status === 'error' ? result.message : null;
  // React resets an uncontrolled form once its action resolves. Re-seeding the
  // defaults from what was submitted is what stops a failed attempt wiping the
  // field the visitor just filled in.
  const values = result.status === 'invalid' || result.status === 'error' ? result.values : undefined;

  return (
    // Card has no asChild, so the form is the outer element and the card is
    // its styled body. Card defaults to gap-6/py-6/shadow-sm; those are
    // overridden here rather than worked around, which is what tailwind-merge
    // inside cn() is for.
    <form action={submit} noValidate>
      <Card
        data-slot="card"
        className={
          compact
            ? 'gap-0 rounded-none border-0 bg-transparent p-0 shadow-none'
            : 'gap-0 rounded-2xl border-line-decorative p-[18px] shadow-none lg:p-7'
        }
      >
        <input type="hidden" name="audience" value={track.id} />
        {/* Which form on which page, and the campaign that brought them — so a
            signup can be attributed without anything that identifies a person.
            Both are re-bounded on the server; neither is trusted. */}
        <input type="hidden" name="context" value={context} />
        <input type="hidden" name="utm" value={utm} />

        <Label
          htmlFor={fieldId}
          className={
            compact
              ? 'sr-only'
              : 'text-label-lg font-semibold text-fg-primary'
          }
        >
          {track.form.label}
        </Label>

        <div className={`flex flex-col gap-2.5 lg:flex-row ${compact ? '' : 'mt-2.5'}`}>
          <Input
            id={fieldId}
            ref={contactRef}
            name="contact"
            type={track.form.type}
            inputMode={track.form.inputMode}
            autoComplete={track.form.autoComplete}
            placeholder={track.form.placeholder}
            defaultValue={values?.contact ?? ''}
            required
            aria-invalid={invalidField === 'contact' || undefined}
            aria-describedby={message ? messageId : undefined}
            className={`rounded-md border-[1.5px] bg-control-bg px-4 lg:flex-1 ${compact ? 'h-12 text-body-md' : 'h-14 text-body-lg'}`}
          />

          <Button
            type="submit"
            disabled={pending}
            className={`group rounded-md font-bold transition-[transform,background-color] duration-[180ms] ease-[var(--hg-ease-spring)] hover:-translate-y-0.5 hover:bg-action-primary-bg-pressed disabled:translate-y-0 motion-reduce:hover:translate-y-0 ${compact ? 'h-12 px-5 text-body-md' : 'h-14 px-[26px] text-body-lg'}`}
          >
            {pending ? 'Sending…' : <SwapLabel>{track.form.submit}</SwapLabel>}
          </Button>
        </div>

        {/* CASL. Unticked, adjacent to the field, and the wording is stored with
            the signup so we can show what was agreed to. */}
        <div className={`flex items-start gap-2.5 ${compact ? 'mt-2' : 'mt-3.5'}`}>
          <Checkbox
            id={consentId}
            name="consent"
            defaultChecked={values?.consent ?? false}
            aria-invalid={invalidField === 'consent' || undefined}
            aria-describedby={message ? messageId : undefined}
            className={compact ? 'mt-px size-5' : 'mt-0.5 size-6'}
          />
          <Label
            htmlFor={consentId}
            className={`font-normal text-mk-ink ${compact ? 'text-[12px] leading-snug' : 'text-body-sm leading-relaxed'}`}
          >
            {track.form.consent}
          </Label>
        </div>

        <p
          id={messageId}
          role="status"
          aria-live="polite"
          className={`mb-0 leading-relaxed ${compact ? 'mt-1.5 text-[12px]' : 'mt-3 text-body-sm'} ${
            message ? 'text-feedback-danger-text' : 'text-mk-ink'
          } ${compact && !message ? 'hidden' : ''}`}
        >
          {message ?? track.form.reassurance}
        </p>
      </Card>
    </form>
  );
}
