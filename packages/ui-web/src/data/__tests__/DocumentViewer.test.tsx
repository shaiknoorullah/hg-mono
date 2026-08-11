import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentViewer } from '../DocumentViewer.js';

const PRESIGNED = 'https://minio.example/halal/cert.jpg?X-Amz-Signature=abc';

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn((blob: Blob) => {
      const url = `blob:mock/${created.length}`;
      created.push(url);
      void blob;
      return url;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { status: number }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }),
      statusText: '',
      ...response,
      ok: response.status >= 200 && response.status < 300,
    })) as unknown as typeof fetch,
  );
}

describe('an expired presigned URL is the expected path, not an error', () => {
  it('treats a 403 from object storage as expiry and offers a fresh link', async () => {
    stubFetch({ status: 403, statusText: 'Forbidden' });
    const onRequestAgain = vi.fn();

    render(
      <DocumentViewer
        url={PRESIGNED}
        contentType="image/jpeg"
        title="Halal certificate"
        onRequestAgain={onRequestAgain}
      />,
    );

    const viewer = await screen.findByTestId('document-viewer');
    await waitFor(() => expect(viewer.getAttribute('data-state')).toBe('expired'));

    // Expired copy, not the red error treatment, and no broken image left on screen.
    expect(screen.getByTestId('document-viewer-expired').textContent).toContain('This link expired');
    expect(screen.queryByTestId('document-viewer-error')).toBeNull();
    expect(screen.queryByTestId('document-viewer-image')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Request again' }));
    expect(onRequestAgain).toHaveBeenCalledTimes(1);
  });

  it('expires on its own when the TTL runs out, and drops the bytes when it does', async () => {
    vi.useFakeTimers();
    try {
      stubFetch({ status: 200 });
      const onExpire = vi.fn();

      render(
        <DocumentViewer
          url={PRESIGNED}
          contentType="image/jpeg"
          title="Halal certificate"
          ttlSeconds={300}
          onExpire={onExpire}
          onRequestAgain={vi.fn()}
        />,
      );

      await vi.waitFor(() =>
        expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('loaded'),
      );
      expect(created).toHaveLength(1);
      // The TTL is visible while the link is live.
      expect(screen.getByTestId('document-viewer-ttl').textContent).toContain('Link expires in');

      await vi.advanceTimersByTimeAsync(301_000);

      expect(onExpire).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('expired');
      // "Never cached to disk": the object URL is revoked the instant it expires.
      expect(revoked).toContain(created[0]);
      expect(screen.queryByTestId('document-viewer-image')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the server’s expiry over the local TTL and corrects for clock skew', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));
    try {
      stubFetch({ status: 200 });
      const onExpire = vi.fn();

      render(
        <DocumentViewer
          url={PRESIGNED}
          contentType="image/jpeg"
          title="Halal certificate"
          // The device is ten minutes fast; without skew correction this would already
          // have "expired" before the first paint.
          serverNow="2026-08-11T11:50:00.000Z"
          expiresAt="2026-08-11T11:55:00.000Z"
          onExpire={onExpire}
          onRequestAgain={vi.fn()}
        />,
      );

      await vi.waitFor(() =>
        expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('loaded'),
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(onExpire).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the other failure modes', () => {
  it('separates a genuine load failure from an expiry', async () => {
    stubFetch({ status: 500, statusText: 'Server Error' });

    render(
      <DocumentViewer
        url={PRESIGNED}
        contentType="image/jpeg"
        title="Halal certificate"
        onRequestAgain={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('error'),
    );
    // A check cannot be recorded against a document nobody can see, so this one is loud.
    expect(screen.getByTestId('document-viewer-error')).toBeTruthy();
    expect(screen.queryByTestId('document-viewer-expired')).toBeNull();
  });

  it('hands a PDF to the system viewer instead of embedding it', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    render(
      <DocumentViewer
        url="https://minio.example/kyc/licence.pdf?X-Amz-Signature=abc"
        contentType="application/pdf"
        title="Driving licence"
        onRequestAgain={vi.fn()}
      />,
    );

    expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('loaded');
    expect(screen.getByRole('link', { name: 'Open PDF' })).toBeTruthy();
    // The bytes never enter this page.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('falls back to download-only for a content type it cannot preview', () => {
    render(
      <DocumentViewer
        url="https://minio.example/kyc/doc.docx?X-Amz-Signature=abc"
        contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        title="Insurance document"
        onRequestAgain={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByTestId('document-viewer').getAttribute('data-state')).toBe('unsupported');
    expect(screen.getByTestId('document-viewer-unsupported').textContent).toContain(
      'cannot be previewed',
    );
  });

  it('says out loud that the view is recorded', () => {
    stubFetch({ status: 200 });
    render(
      <DocumentViewer
        url={PRESIGNED}
        contentType="image/jpeg"
        title="Halal certificate"
        onRequestAgain={vi.fn()}
      />,
    );
    expect(screen.getByTestId('document-viewer-audit-notice').textContent).toContain(
      'This view is recorded',
    );
  });

  it('never caches: the fetch is explicitly no-store', async () => {
    stubFetch({ status: 200 });
    render(
      <DocumentViewer
        url={PRESIGNED}
        contentType="image/jpeg"
        title="Halal certificate"
        onRequestAgain={vi.fn()}
      />,
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(init).toMatchObject({ cache: 'no-store' });
  });
});
