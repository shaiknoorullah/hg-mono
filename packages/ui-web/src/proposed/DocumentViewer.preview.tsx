/**
 * Specimens for `DocumentViewer`, named after the `CertPane` states drawn on the admin
 * `restaurant-verification/Viewer-States`, `Viewer-Limits` and `Viewer-More` boards (the live
 * design system has no preview page for it). Each sits in the board's 432 x 752 pane.
 */

import type { ReactNode } from 'react';

import { DocumentViewer } from './DocumentViewer.js';

/** Grouped under one heading in the preview. */
export const component = 'DocumentViewer';

const Pane = ({ children }: { children: ReactNode }) => <div style={{ width: 432, height: 752 }}>{children}</div>;
const EXPIRES = new Date(Date.now() + 120_000).toISOString();

/** A stand-in certificate page (a data URL, so the specimen needs no server). */
const SCAN =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="776" viewBox="0 0 600 776">' +
      '<rect width="600" height="776" fill="white"/><rect x="40" y="40" width="520" height="696" fill="none" stroke="gray" stroke-width="2"/>' +
      '<text x="300" y="140" font-family="serif" font-size="34" text-anchor="middle">Halal Certificate</text>' +
      '<text x="300" y="200" font-family="serif" font-size="18" text-anchor="middle">Zaytoun Grill</text>' +
      '<text x="300" y="232" font-family="serif" font-size="14" text-anchor="middle">2872 Eglinton Ave E, Toronto, ON</text>' +
      '<rect x="90" y="300" width="420" height="10" fill="lightgray"/><rect x="90" y="330" width="380" height="10" fill="lightgray"/>' +
      '<rect x="90" y="360" width="400" height="10" fill="lightgray"/><circle cx="440" cy="620" r="56" fill="none" stroke="gray" stroke-width="3"/>' +
      '</svg>',
  );
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK';
const noop = () => undefined;

/** `ready`: the scan, the toolbar and two pages. */
export function Ready() {
  return (
    <Pane>
      <DocumentViewer
        title="Halal certificate scan"
        src={{ url: SCAN, kind: 'image', expiresAt: EXPIRES }}
        onRefresh={noop}
        page={1}
        pageCount={2}
        onPageChange={noop}
        fullViewHref="#viewer"
      />
    </Pane>
  );
}

/** `pdf`: a PDF in the page, with the new-tab link where the browser has no PDF viewer. */
export function Pdf() {
  return (
    <Pane>
      <DocumentViewer title="Halal certificate PDF" src={{ url: PDF, kind: 'pdf', expiresAt: EXPIRES }} onRefresh={noop} />
    </Pane>
  );
}

/** `loading`: a private link is being made. */
export function Loading() {
  return (
    <Pane>
      <DocumentViewer title="Halal certificate scan" src={null} loading />
    </Pane>
  );
}

/** `expired`: the link ran out before the page loaded. */
export function Expired() {
  return (
    <Pane>
      <DocumentViewer
        title="Halal certificate scan"
        src={{ url: SCAN, kind: 'image', expiresAt: new Date(Date.now() - 60_000).toISOString() }}
        onRefresh={noop}
      />
    </Pane>
  );
}

/** `error`: storage did not answer. */
export function Failed() {
  return (
    <Pane>
      <DocumentViewer title="Halal certificate scan" url={SCAN} kind="image" status="failed" onRetry={noop} />
    </Pane>
  );
}

/** `missing`: no document on the record. */
export function Missing() {
  return (
    <Pane>
      <DocumentViewer title="Certificate scan" src={null} />
    </Pane>
  );
}

/** `forbidden`: the viewer's role may not open documents. */
export function Forbidden() {
  return (
    <Pane>
      <DocumentViewer title="Halal certificate scan" forbidden />
    </Pane>
  );
}
