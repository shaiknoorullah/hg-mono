/**
 * `FileDrop` — the web document dropzone (owner-approved, decisions row 28 Sep; drawn on
 * `restaurant/onboarding/DocsPanes`). A dashed drop area with one real Upload button, a
 * Progress row while uploading, and a retry row when an upload fails. Built on shadcn
 * `Button` (through the design-system Button) and `Progress`.
 *
 * - Dropping and picking go through the same check: the file's type against `accept` and its
 *   size against `maxSizeBytes`. A rejected file never reaches `onFileSelect`; the reason is
 *   shown as an announced error under the zone and passed to `onReject`.
 * - The drop area is not a second tab stop: the Upload button is the one control, named
 *   "Upload file: {label}". Dropping is a pointer shortcut for the same action.
 * - Uploading shows the file name, a `progressbar` named "Uploading {file}" (indeterminate
 *   when `progress` is null) and a Cancel button. Failed shows "Not uploaded", the error and
 *   a Retry (or "Choose another file") button.
 * - Files go to private buckets through short-lived URLs (invariant 7); this component only
 *   hands the `File` to the caller.
 */

import { useRef, useState, type CSSProperties, type DragEvent } from 'react';

import { HiddenFileInput } from '../lib/ui/file-input.js';
import { Progress } from '../lib/ui/progress.js';
import { cn } from '../lib/utils.js';
import { FieldMessage, describedBy, useFieldIds } from './field-parts.js';
import { Button, Icon } from './index.js';

/** Why a file was refused before upload. */
export type FileDropRejection = 'FILE_TYPE_NOT_ACCEPTED' | 'FILE_TOO_LARGE' | 'TOO_MANY_FILES';

/** Props of `FileDrop`. */
export interface FileDropProps {
  /** What the file is, lower case: "business licence". Names the zone and the button. */
  label: string;
  /** Accepted MIME types or extensions, e.g. ['application/pdf', 'image/jpeg', '.png']. */
  accept?: string[];
  /** Largest accepted size in bytes. */
  maxSizeBytes?: number;
  /** The accepted types and limit in words: "PDF, JPG or PNG, up to 10 MB." */
  acceptDescription?: string;
  /** Called with a file that passed the type and size checks. */
  onFileSelect?: (file: File) => void;
  /** Called when a file is refused, with the reason. */
  onReject?: (reason: FileDropRejection, file: File | null) => void;
  /** idle (the dropzone), uploading (progress row) or failed (retry row). */
  status?: 'idle' | 'uploading' | 'failed';
  /** The file being uploaded or that failed. */
  fileName?: string;
  /** 0–100, or null for "uploading, size unknown". */
  progress?: number | null;
  onCancel?: () => void;
  onRetry?: () => void;
  /** "Retry" by default; "Choose another file" when the file itself was the problem. */
  retryLabel?: string;
  /** A server or upload error, shown under the zone (role=alert). */
  errorText?: string | null;
  disabled?: boolean;
  /** The upload button's variant: primary when this is the next step, secondary otherwise. */
  buttonVariant?: 'primary' | 'secondary' | 'tertiary';
  id?: string;
  testId?: string;
  style?: CSSProperties;
}

const UNITS = ['bytes', 'KB', 'MB', 'GB'] as const;

/** "10 MB", "500 KB": a byte count in words, whole numbers only. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1 && value % 1024 === 0) {
    value /= 1024;
    unit += 1;
  }
  if (value >= 1024 && unit < UNITS.length - 1) {
    value = Math.round(value / 1024);
    unit += 1;
  }
  return `${value} ${UNITS[unit]}`;
}

/** True when `file` matches one of `accept` (a MIME type, a `type/*` wildcard or an extension). */
export function fileMatchesAccept(file: Pick<File, 'name' | 'type'>, accept: readonly string[] | undefined): boolean {
  if (!accept || accept.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

/** The refusal reason for a file, or null when it may be uploaded. */
export function checkFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  accept: readonly string[] | undefined,
  maxSizeBytes: number | undefined,
): FileDropRejection | null {
  if (!fileMatchesAccept(file, accept)) return 'FILE_TYPE_NOT_ACCEPTED';
  if (typeof maxSizeBytes === 'number' && file.size > maxSizeBytes) return 'FILE_TOO_LARGE';
  return null;
}

/** A document dropzone with an Upload button, progress and retry. */
export function FileDrop({
  label,
  accept,
  maxSizeBytes,
  acceptDescription,
  onFileSelect,
  onReject,
  status = 'idle',
  fileName,
  progress = null,
  onCancel,
  onRetry,
  retryLabel = 'Retry',
  errorText,
  disabled = false,
  buttonVariant = 'primary',
  id,
  testId,
  style,
}: FileDropProps) {
  const ids = useFieldIds(id, 'filedrop');
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const shownError = errorText ?? rejection;
  const hintId = `${ids.control}-hint`;

  const refuse = (reason: FileDropRejection, file: File | null) => {
    const words =
      reason === 'FILE_TYPE_NOT_ACCEPTED'
        ? `This file type isn’t accepted.${acceptDescription ? ` ${acceptDescription}` : ''}`
        : reason === 'FILE_TOO_LARGE'
          ? `This file is too large. The limit is ${formatBytes(maxSizeBytes ?? 0)}.`
          : 'Choose one file at a time.';
    setRejection(words);
    onReject?.(reason, file);
  };

  const take = (files: FileList | null) => {
    if (disabled || !files || files.length === 0) return;
    if (files.length > 1) return refuse('TOO_MANY_FILES', null);
    const file = files[0]!;
    const reason = checkFile(file, accept, maxSizeBytes);
    if (reason) return refuse(reason, file);
    setRejection(null);
    onFileSelect?.(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer?.files ?? null);
  };

  const error = shownError ? (
    <FieldMessage id={ids.error} error>
      {shownError}
    </FieldMessage>
  ) : null;

  if (status === 'uploading') {
    const name = fileName ?? label;
    const pct = typeof progress === 'number' ? Math.max(0, Math.min(100, Math.round(progress))) : null;
    return (
      <div data-testid={testId ?? 'FileDrop'} data-status="uploading" className="grid gap-2" style={style}>
        <div className="flex items-center gap-3.5 rounded-md bg-surface-sunken px-3.5 py-3">
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex justify-between gap-3">
              <span className="font-mono text-label-lg text-fg-primary">{name}</span>
              <span className="text-body-sm text-fg-secondary tabular-nums">{pct === null ? 'Uploading…' : `${pct}%`}</span>
            </div>
            <Progress
              value={pct}
              aria-label={`Uploading ${name}`}
              className="h-2 rounded-full bg-line-decorative"
              indicatorClassName="rounded-full bg-fg-secondary"
            />
          </div>
          {onCancel ? (
            <Button variant="ghost" size="sm" onPress={onCancel} accessibilityLabel={`Cancel upload of ${label}`}>
              Cancel
            </Button>
          ) : null}
        </div>
        {error}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div data-testid={testId ?? 'FileDrop'} data-status="failed" className="grid gap-2" style={style}>
        <div className="flex items-center gap-3.5 rounded-md bg-surface-sunken px-3.5 py-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="font-mono text-label-lg text-fg-primary">{fileName ?? label}</span>
            <span className="text-body-sm text-fg-secondary">Not uploaded</span>
          </div>
          {onRetry ? (
            <Button variant="primary" size="md" iconStart="refresh" onPress={onRetry} accessibilityLabel={`${retryLabel}: ${label}`}>
              {retryLabel}
            </Button>
          ) : null}
        </div>
        {error}
      </div>
    );
  }

  return (
    <div data-testid={testId ?? 'FileDrop'} data-status="idle" className="grid gap-2" style={style}>
      <div
        data-dragging={dragging || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-45 flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed p-5 text-center',
          'transition-colors duration-(--hg-duration-fast) ease-standard motion-reduce:transition-none',
          dragging ? 'border-line-brand bg-accent' : 'border-control-border bg-surface-base',
          shownError && !dragging && 'border-feedback-danger-border',
          disabled && 'opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-md bg-surface-sunken text-fg-primary">
          <Icon name="plus" size="lg" />
        </span>
        <span className="text-heading-sm text-fg-primary">
          {dragging ? `Drop to upload the ${label}` : `Drop the ${label} here, or`}
        </span>
        <Button
          variant={buttonVariant}
          size="lg"
          iconStart="plus"
          disabled={disabled}
          onPress={() => input.current?.click()}
          accessibilityLabel={`Upload file: ${label}`}
        >
          Upload file
        </Button>
        {acceptDescription ? (
          <span id={hintId} className="text-body-sm text-fg-secondary">
            {acceptDescription}
          </span>
        ) : null}
        <HiddenFileInput
          ref={input}
          id={ids.control}
          accept={accept?.join(',')}
          aria-describedby={describedBy(acceptDescription && hintId, shownError && ids.error)}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error}
    </div>
  );
}
