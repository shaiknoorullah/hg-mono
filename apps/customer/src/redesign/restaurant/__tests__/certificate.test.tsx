/**
 * WP4 D7: the certificate viewer. The link is minted per view (presigned, five minutes), the
 * bytes are read into memory and shown from a `data:` URI (the presigned URL never reaches
 * `<Image>`), an expired link is re-minted by "Open again", and every failure has its own state.
 */
import * as React from 'react';
import { Image } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import {
  CertificateScreen,
  LOG_NOTE,
  PDF_DESCRIPTION,
  PDF_TITLE,
  certificateAltText,
  zoomAnnouncement,
} from '../CertificateScreen';
import { CERT_LINK_MAX_TTL_MS, linkLifetimeMs, rememberRestaurantName } from '../restaurant';

const ID = payloadOf('restaurant_detail_certified').id as string;
const LINK = payloadOf('presigned_download');
// Four minutes before the fixture link expires.
const BEFORE_EXPIRY = Date.parse(LINK.expires_at) - 4 * 60 * 1000;

let mock: MockApi;
let nav: NavSpy;

/**
 * Object storage, behind the presigned links. Each answer is used once, in order (the last one
 * repeats): 'image' (a tiny WebP), 'pdf', 'hang', 'offline', or an HTTP status.
 */
type CdnAnswer = 'image' | 'pdf' | 'hang' | 'offline' | number;
const IMAGE_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03]);
let cdnAnswers: CdnAnswer[];
let cdnCalls: Array<{ url: string; init: RequestInit | undefined }>;

function routeStorage(): void {
  const api = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://cdn.halalgoes.ca/')) return api(input, init);
    cdnCalls.push({ url, init });
    const answer = cdnAnswers.length > 1 ? cdnAnswers.shift()! : cdnAnswers[0]!;
    if (answer === 'hang') return new Promise<Response>(() => {});
    if (answer === 'offline') return Promise.reject(new TypeError('Network request failed'));
    if (answer === 'pdf') return Promise.resolve(new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }));
    if (typeof answer === 'number') return Promise.resolve(new Response('<Error/>', { status: answer }));
    return Promise.resolve(new Response(IMAGE_BYTES, { headers: { 'content-type': 'image/webp' } }));
  }) as typeof fetch;
}

function show(scheme: 'light' | 'dark' = 'light') {
  nav = navSpy({ name: 'certificate', restaurantId: ID });
  return renderRedesign(<CertificateScreen restaurantId={ID} />, { nav, scheme });
}

beforeEach(() => {
  resetConnectivity();
  setNowOverride({ at: BEFORE_EXPIRY });
  rememberRestaurantName(ID, 'Karachi Kitchen');
  mock = mockApi({
    getRestaurantCertification: 'certification_panel_certified',
    createCertificateViewUrl: 'presigned_download',
  });
  cdnAnswers = ['image'];
  cdnCalls = [];
  routeStorage();
});

afterEach(() => {
  mock.restore();
  setNowOverride(null);
  resetConnectivity();
  jest.restoreAllMocks();
});

describe('D7 certificate viewer', () => {
  it('says it is getting a secure link while minting', async () => {
    mock.answer('createCertificateViewUrl', 'hang');
    show();
    expect(await screen.findByText('Getting a secure link…')).toBeTruthy();
    expect(screen.getByText(LOG_NOTE)).toBeTruthy();
  });

  it('opens the image from memory only, with the verified details and the disclaimer verbatim', async () => {
    const prefetch = jest.spyOn(Image, 'prefetch');
    show();
    const image = await screen.findByTestId('Cert-image');
    // The presigned URL never reaches <Image> (whose platform pipelines keep a disk cache): the
    // bytes were read into memory and are shown from a data: URI.
    expect(image.props.source).toEqual({ uri: `data:image/webp;base64,${btoa(String.fromCharCode(...IMAGE_BYTES))}` });
    expect(JSON.stringify(image.props.source)).not.toContain(LINK.url);
    expect(prefetch).not.toHaveBeenCalled();
    // One read of the link, asking no cache to store it, with the URL exactly as signed.
    expect(cdnCalls).toHaveLength(1);
    expect(cdnCalls[0]!.url).toBe(LINK.url);
    expect((cdnCalls[0]!.init?.headers as Record<string, string>)['Cache-Control']).toBe('no-store');
    expect(cdnCalls[0]!.init?.cache).toBeUndefined();
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(1);
    expect(mock.callsTo('createCertificateViewUrl')[0]!.method).toBe('POST');
    const cert = payloadOf('certification_panel_certified');
    expect(screen.getByText(cert.disclaimer)).toBeTruthy();
    expect(screen.getByText('Certified by')).toBeTruthy();
    expect(screen.getByText('9 March 2027')).toBeTruthy();
    expect(screen.getByText('The whole restaurant')).toBeTruthy();
    expect(image.props.accessibilityLabel).toBe(
      `Halal certificate ${cert.certificate_number} from ${cert.certifying_body_name}, valid until 9 March 2027. 100%, fitted to the screen.`,
    );
  });

  it('zooms with buttons, never only gestures', async () => {
    show();
    await screen.findByTestId('Cert-image');
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Zoom in'));
    fireEvent.press(screen.getByLabelText('Zoom in'));
    expect(screen.getByText('200%')).toBeTruthy();
    expect(screen.getByTestId('Cert-zoomLevel').props.accessibilityLabel).toBe('Zoomed to 200%.');
    fireEvent.press(screen.getByLabelText('Zoom out'));
    expect(screen.getByText('150%')).toBeTruthy();
    fireEvent.press(screen.getByText('Fit to screen'));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('an expired link says so, and "Open again" mints a new one', async () => {
    const fresh = { url: 'https://cdn.halalgoes.ca/img/asset/second.webp', expires_at: new Date(BEFORE_EXPIRY + 5 * 60 * 1000).toISOString() };
    mock.answer('createCertificateViewUrl', ['presigned_download', { status: 200, body: { data: fresh } }]);
    // Storage refuses the first link: that is how an expired presigned link answers.
    cdnAnswers = [403, 'image'];
    show();
    expect(await screen.findByText('This link has expired')).toBeTruthy();
    expect(
      screen.getByText('Certificate links last five minutes to keep the document private. Open it again for a new link.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Open again'));
    expect(await screen.findByTestId('Cert-image')).toBeTruthy();
    expect(cdnCalls.map((c) => c.url)).toEqual([LINK.url, fresh.url]);
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(2);
  });

  it('a phone clock ten minutes fast still opens a freshly minted link', async () => {
    setNowOverride({ at: Date.parse(LINK.expires_at) + 10 * 60 * 1000 });
    show();
    expect(await screen.findByTestId('Cert-image')).toBeTruthy();
    expect(screen.queryByText('This link has expired')).toBeNull();
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(1);
  });

  it('a link that runs out before its bytes arrive becomes expired, timed from when it arrived', async () => {
    cdnAnswers = ['hang'];
    jest.useFakeTimers();
    try {
      show();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Getting a secure link…')).toBeTruthy();
      // Four minutes left on the link when it arrived.
      const life = Date.parse(LINK.expires_at) - BEFORE_EXPIRY;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(life - 1000);
      });
      expect(screen.queryByText('This link has expired')).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText('This link has expired')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('measures a link in device time, and never judges it expired on arrival', () => {
    const now = Date.parse('2026-08-10T18:00:00Z');
    expect(linkLifetimeMs(new Date(now + 120_000).toISOString(), now)).toBe(120_000);
    // A phone running fast (the link looks already expired) or slow (more than 300 s left).
    expect(linkLifetimeMs(new Date(now - 60_000).toISOString(), now)).toBe(CERT_LINK_MAX_TTL_MS);
    expect(linkLifetimeMs(new Date(now + 900_000).toISOString(), now)).toBe(CERT_LINK_MAX_TTL_MS);
    expect(linkLifetimeMs('not a time', now)).toBe(CERT_LINK_MAX_TTL_MS);
  });

  it('storage failing (not expiry) is "We couldn\'t open the certificate"', async () => {
    cdnAnswers = [500];
    show();
    expect(await screen.findByText("We couldn't open the certificate")).toBeTruthy();
  });

  it('an image that fails to decode is "We couldn\'t open the certificate"', async () => {
    show();
    const image = await screen.findByTestId('Cert-image');
    fireEvent(image, 'error');
    expect(screen.getByText("We couldn't open the certificate")).toBeTruthy();
    expect(
      screen.getByText('Check your connection and try again. The verified details on the restaurant page are unchanged.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Back to Karachi Kitchen'));
    expect(nav.log).toContainEqual({ action: 'back' });
  });

  it('a failed mint offers Try again', async () => {
    mock.answer('createCertificateViewUrl', [{ status: 500, code: 'INTERNAL_ERROR' }, 'presigned_download']);
    show();
    expect(await screen.findByText("We couldn't open the certificate")).toBeTruthy();
    fireEvent.press(screen.getByText(/Try again/));
    expect(await screen.findByTestId('Cert-image')).toBeTruthy();
  });

  it('offline: nothing is cached, so it says it needs a connection', async () => {
    mock.answer('createCertificateViewUrl', 'offline');
    show();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(
      screen.getByText(
        "The certificate opens through a private link, so it needs a connection. The verified details on the restaurant page don't change.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Back to Karachi Kitchen')).toBeTruthy();
  });

  it('not viewable: says so and never asks for a link', async () => {
    const cert = payloadOf('certification_panel_certified');
    mock.answer('getRestaurantCertification', { status: 200, body: { data: { ...cert, certificate_viewable: false } } });
    show();
    expect(await screen.findByText("The certificate image isn't available to view")).toBeTruthy();
    expect(screen.getByText('The details on the restaurant page are what HalalGoes verified.')).toBeTruthy();
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(0);
  });

  it('404: "This certificate isn\'t available any more" and Reload the restaurant', async () => {
    mock.answer('createCertificateViewUrl', { status: 404, code: 'NOT_FOUND' });
    show();
    expect(await screen.findByText("This certificate isn't available any more")).toBeTruthy();
    fireEvent.press(screen.getByText('Reload the restaurant'));
    expect(nav.log).toContainEqual({ action: 'back' });
  });

  it('a PDF says so plainly, is never downloaded or handed to another app, and offers Back', async () => {
    mock.answer('createCertificateViewUrl', {
      status: 200,
      body: { data: { url: 'https://cdn.halalgoes.ca/doc/cert.pdf?X-Amz-Signature=abc', expires_at: LINK.expires_at } },
    });
    show();
    expect(await screen.findByTestId('Cert-pdf')).toBeTruthy();
    expect(screen.getByText(PDF_TITLE)).toBeTruthy();
    expect(screen.getByText(PDF_DESCRIPTION)).toBeTruthy();
    // Not the certificate_viewable=false copy: the certificate is viewable, just not in this build.
    expect(screen.queryByText("The certificate image isn't available to view")).toBeNull();
    expect(screen.queryByTestId('Cert-image')).toBeNull();
    expect(cdnCalls).toHaveLength(0);
    expect(screen.getByText(payloadOf('certification_panel_certified').disclaimer)).toBeTruthy();
    fireEvent.press(screen.getByText('Back to Karachi Kitchen'));
    expect(nav.log).toContainEqual({ action: 'back' });
  });

  it('a PDF served from a link with no .pdf name is recognised by its type, and not shown', async () => {
    cdnAnswers = ['pdf'];
    show();
    expect(await screen.findByText(PDF_TITLE)).toBeTruthy();
    expect(screen.queryByTestId('Cert-image')).toBeNull();
  });

  it('renders in dark', async () => {
    show('dark');
    expect(await screen.findByTestId('Cert-image')).toBeTruthy();
  });
});

describe('certificate text', () => {
  it('builds the alt text from the API and announces zoom', () => {
    expect(certificateAltText(null)).toBe('Halal certificate.');
    expect(zoomAnnouncement(1)).toBe('100%, fitted to the screen.');
    expect(zoomAnnouncement(1.5)).toBe('Zoomed to 150%.');
  });
});
