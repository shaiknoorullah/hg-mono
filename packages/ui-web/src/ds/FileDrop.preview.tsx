/**
 * FileDrop specimens for the design preview. There is no live preview page (FileDrop is an
 * owner-approved composite not yet in Claude Design); compare with the restaurant
 * `onboarding/DocsPanes` board.
 */

import { FileDrop } from './FileDrop.js';

/** The component name (no live reference page). */
export const component = 'FileDrop';

const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];

/** The empty dropzone. */
export function Idle() {
  return (
    <div style={{ width: 640 }}>
      <FileDrop label="business licence" accept={ACCEPT} maxSizeBytes={10 * 1024 * 1024} acceptDescription="PDF, JPG or PNG, up to 10 MB. Every page, clear and readable." />
    </div>
  );
}

/** Uploading with known progress. */
export function Uploading() {
  return (
    <div style={{ width: 640 }}>
      <FileDrop label="business licence" status="uploading" fileName="business-licence-2026.pdf" progress={62} onCancel={() => {}} />
    </div>
  );
}

/** A failed upload with Retry. */
export function Failed() {
  return (
    <div style={{ width: 640 }}>
      <FileDrop
        label="business licence"
        status="failed"
        fileName="business-licence-2026.pdf"
        onRetry={() => {}}
        errorText="The upload didn’t finish. Check your connection and try again. Your file is still selected."
      />
    </div>
  );
}

/** The dropzone after a refused file (too large). */
export function Rejected() {
  return (
    <div style={{ width: 640 }}>
      <FileDrop label="food safety certificate" buttonVariant="secondary" acceptDescription="PDF, JPG or PNG, up to 10 MB." errorText="This file is too large. The limit is 10 MB." />
    </div>
  );
}
