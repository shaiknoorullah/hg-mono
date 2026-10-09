/**
 * WP4 D7: the certificate viewer. The link is minted per view (presigned, five minutes), the
 * image is held in memory only, an expired link is re-minted by "Open again", and every failure
 * has its own state.
 */
import * as React from 'react';
import { Image } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import { CertificateScreen, LOG_NOTE, certificateAltText, zoomAnnouncement } from '../CertificateScreen';
import { rememberRestaurantName } from '../restaurant';

const ID = payloadOf('restaurant_detail_certified').id as string;
const LINK = payloadOf('presigned_download');
// Four minutes before the fixture link expires.
const BEFORE_EXPIRY = Date.parse(LINK.expires_at) - 4 * 60 * 1000;

let mock: MockApi;
let nav: NavSpy;

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

  it('opens the image in memory only, with the verified details and the disclaimer verbatim', async () => {
    const prefetch = jest.spyOn(Image, 'prefetch');
    show();
    const image = await screen.findByTestId('Cert-image');
    expect(image.props.source).toEqual({ uri: LINK.url, cache: 'reload' });
    expect(prefetch).not.toHaveBeenCalled();
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
    fireEvent(image, 'load');
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
    // The first link has run out by the time it arrives.
    setNowOverride({ at: Date.parse(LINK.expires_at) + 1000 });
    show();
    expect(await screen.findByText('This link has expired')).toBeTruthy();
    expect(
      screen.getByText('Certificate links last five minutes to keep the document private. Open it again for a new link.'),
    ).toBeTruthy();
    setNowOverride({ at: BEFORE_EXPIRY });
    fireEvent.press(screen.getByText('Open again'));
    const image = await screen.findByTestId('Cert-image');
    expect(image.props.source.uri).toBe(fresh.url);
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(2);
  });

  it('a link that runs out before its image loads becomes expired', async () => {
    jest.useFakeTimers();
    try {
      show();
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
      expect(screen.getByTestId('Cert-image')).toBeTruthy();
      act(() => {
        setNowOverride({ at: Date.parse(LINK.expires_at) + 1 });
        jest.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(screen.getByText('This link has expired')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('an image that fails before expiry is "We couldn\'t open the certificate"', async () => {
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

  it('a PDF is not opened outside the app; the verified details stay', async () => {
    mock.answer('createCertificateViewUrl', {
      status: 200,
      body: { data: { url: 'https://cdn.halalgoes.ca/doc/cert.pdf?X-Amz-Signature=abc', expires_at: LINK.expires_at } },
    });
    show();
    expect(await screen.findByTestId('Cert-pdf')).toBeTruthy();
    expect(screen.queryByTestId('Cert-image')).toBeNull();
    expect(screen.getByText(payloadOf('certification_panel_certified').disclaimer)).toBeTruthy();
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
