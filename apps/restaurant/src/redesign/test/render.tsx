/**
 * Renders the redesigned app at a URL with a signed-in session (or none), on top of the
 * fake API. `renderRedesign()` is what every redesign screen test uses.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';
import { setSession } from '../../lib/api';
import { resetSignedOut } from '../data/client';
import { resetServerClock } from '../data/serverClock';

export async function renderRedesign(path: string, { signedIn = true }: { signedIn?: boolean } = {}) {
  installDomShims();
  resetServerClock();
  resetSignedOut();
  setSession(signedIn ? { accessToken: 'access-token-1' } : null);
  const { default: RedesignRoot } = await import('../RedesignRoot');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RedesignRoot />
    </MemoryRouter>,
  );
}
