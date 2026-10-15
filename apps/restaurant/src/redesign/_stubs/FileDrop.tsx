/**
 * TEMPORARY STUB for the owner-approved DS `FileDrop` (ds-request(web): #193). Delete when
 * `@hg/ui-web/proposed` exports it.
 *
 * A dashed drop target holding one real `<input type="file">` and an "Upload file" button
 * (the button is the keyboard path; dropping is the extra). It hands the chosen `File` to
 * `onFile` and nothing else: reading, hashing and uploading are the caller's job, and the file
 * never leaves the page except through the presigned upload the caller makes.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button, Icon } from '@hg/ui-web/primitives';

export interface FileDropProps {
  /** Lower-case noun for the labels: "halal certificate". */
  noun: string;
  onFile: (file: File) => void;
  /** Button emphasis; the first empty row is primary. */
  variant?: 'primary' | 'secondary' | 'tertiary';
  /** Shown under the prompt, e.g. the accepted types and size. */
  hint?: ReactNode;
  buttonLabel?: string;
  /** Accessible name of the button, default `Upload file: {noun}`. */
  buttonAriaLabel?: string;
  accept?: string;
  disabled?: boolean;
  testId?: string;
}

export function FileDrop({ noun, onFile, variant = 'tertiary', hint, buttonLabel = 'Upload file', buttonAriaLabel, accept, disabled, testId }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [over, setOver] = useState(false);
  const take = (list: FileList | null | undefined) => {
    const file = list?.[0];
    if (file) onFile(file);
    if (input.current) input.current.value = '';
  };
  return (
    <div
      data-testid={testId}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer?.files);
      }}
      className={`flex flex-col items-center gap-3 rounded-[12px] border-[1.5px] border-dashed px-4 py-6 text-center ${over ? 'border-line-strong bg-surface-sunken' : 'border-line-interactive bg-surface-base'}`}
    >
      <span className="inline-flex items-center gap-2 text-body-md text-fg-primary">
        <Icon name="plus" size={20} />
        Drop the {noun} here, or
      </span>
      <input id={inputId} ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => take(e.target.files)} />
      <Button variant={variant} size="lg" disabled={disabled} accessibilityLabel={buttonAriaLabel ?? `${buttonLabel}: ${noun}`} onPress={() => input.current?.click()}>
        {buttonLabel}
      </Button>
      {hint ? <p className="m-0 text-body-sm text-fg-secondary">{hint}</p> : null}
    </div>
  );
}
