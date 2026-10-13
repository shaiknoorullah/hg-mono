/**
 * Specimens for the proposed W3 form composites (approval packet P16–P21). There is no live
 * preview page for them; compare with the canvas boards named in each component's header.
 */

import { useState } from 'react';

import type { Cents } from '@hg/api-client';

import { Input as LibInput, fieldShellVariants } from '../lib/ui/input.js';
import { CheckboxGroup } from './CheckboxGroup.js';
import { DateInput } from './DateInput.js';
import { ErrorSummary, Field } from './Field.js';
import { InlineConfirm } from './InlineConfirm.js';
import { MoneyInput } from './MoneyInput.js';
import { Stepper } from './Stepper.js';
import { Textarea } from './Textarea.js';
import { TimeField } from './TimeField.js';

/** The gallery name for these composites. */
export const component = 'ProposedForms';

const COL = { display: 'grid', gap: 16, width: 520 } as const;

/** ErrorSummary above a Field-wrapped control with an error. */
export function FieldAndErrorSummary() {
  return (
    <div style={COL}>
      <ErrorSummary focusOnShow={false} errors={[{ fieldId: 'legal', message: 'Enter the legal name on the licence' }, { fieldId: 'dob', message: 'Enter a date of birth' }]} />
      <Field label="Legal name" id="legal" required errorText="Enter the legal name on the licence" helperText="As printed on the business licence.">
        <LibInput className={fieldShellVariants({ invalid: true })} />
      </Field>
    </div>
  );
}

/** Textarea with a counter near the limit, and with a minimum not met. */
export function TextareaCounter() {
  return (
    <div style={COL}>
      <Textarea label="What happened" characterCount maxLength={120} defaultValue="The rider left the order at the wrong door; the customer called twice and the food arrived cold." helperText="10 to 120 characters." />
      <Textarea label="Message to the restaurant" minLength={10} defaultValue="Redo" errorText="Add at least 6 more characters." />
    </div>
  );
}

/** CheckboxGroup with a maximum reached and a group error. */
export function CheckboxGroupMax() {
  const [v, setV] = useState(['a', 'b']);
  return (
    <div style={COL}>
      <CheckboxGroup
        label="Cuisines"
        min={1}
        max={2}
        value={v}
        onValueChange={setV}
        options={[
          { value: 'a', label: 'Afghan' },
          { value: 'b', label: 'Pakistani' },
          { value: 'c', label: 'Turkish' },
        ]}
      />
      <CheckboxGroup label="Documents to redo" value={[]} error="Choose at least one document for the restaurant to redo." options={[{ value: 'l', label: 'Business licence' }, { value: 'f', label: 'Food safety certificate' }]} />
    </div>
  );
}

/** DateInput valid, and out of range. */
export function DateInputStates() {
  return (
    <div style={COL}>
      <DateInput label="Date of birth" value="1994-03-07" onValueChange={() => {}} helperText="You must be 18 or older to deliver." />
      <DateInput label="Certificate expiry" value={null} onValueChange={() => {}} errorText="This certificate has expired. Upload the current one." />
    </div>
  );
}

/** TimeField in 12-hour form. */
export function TimeFieldTwelveHour() {
  const [v, setV] = useState<string | null>('21:30');
  return (
    <div style={COL}>
      <TimeField label="Closes at" value={v} onValueChange={setV} minuteStep={15} />
    </div>
  );
}

/** MoneyInput empty with a limit, and over the limit. */
export function MoneyInputStates() {
  return (
    <div style={COL}>
      <MoneyInput label="Goodwill amount" valueCents={1250 as Cents} maxCents={5000 as Cents} onValueChange={() => {}} helperText="Dollars and cents, sent as whole cents." />
      <MoneyInput label="Refund amount" valueCents={null} onValueChange={() => {}} errorText="The most you can refund is $42.10." />
    </div>
  );
}

/** Stepper, full and compact. */
export function StepperFullAndCompact() {
  const steps = [
    { id: 'profile', label: 'Restaurant profile', status: 'done' as const },
    { id: 'docs', label: 'Documents', status: 'current' as const },
    { id: 'menu', label: 'Menu', status: 'upcoming' as const },
    { id: 'payout', label: 'Payouts', status: 'error' as const },
    { id: 'review', label: 'Review', status: 'upcoming' as const },
  ];
  return (
    <div style={COL}>
      <Stepper steps={steps} label="Setup steps" onStepPress={() => {}} />
      <Stepper variant="compact" steps={steps} label="Setup progress" />
    </div>
  );
}

/** InlineConfirm asking, and failed. */
export function InlineConfirmStates() {
  return (
    <div style={COL}>
      <InlineConfirm prompt="Turn off new orders? Customers see you as closed until you turn them back on." confirmLabel="Turn off orders" onConfirm={() => {}} onCancel={() => {}} />
      <InlineConfirm prompt="Sign out of this tablet?" confirmLabel="Sign out" destructive onConfirm={() => {}} onCancel={() => {}} errorText="Couldn’t reach HalalGoes. Try again." />
    </div>
  );
}
