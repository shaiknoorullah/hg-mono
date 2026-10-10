/**
 * Renders the redesigned app at a URL with a signed-in session (or none), on top of the
 * fake API. `renderRedesign()` is what every redesign screen test uses.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';
import { setSession } from '../../lib/api';
import { resetSignedOut } from '../data/client';
import { resetServerClock } from '../data/serverClock';
import { resetHeartbeatHealth } from '../data/heartbeat';
import { resetConnectionHistory } from '../data/connection';

/** A quiet `Audio` that always plays: the gate's test chime and the order loop. */
class SilentAudio {
  src: string;
  loop = false;
  volume = 1;
  currentTime = 0;
  constructor(src = '') {
    this.src = src;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  load() {}
  addEventListener() {}
  removeEventListener() {}
}

/**
 * Passes the go-live gate on /orders the way a person does: one click on its button. Sound
 * plays and notifications are allowed, unless the test stubbed them first.
 */
async function passGoLiveGate() {
  if (!vi.isMockFunction((globalThis as { Audio?: unknown }).Audio)) vi.stubGlobal('Audio', SilentAudio);
  if (typeof (globalThis as { Notification?: unknown }).Notification === 'undefined') {
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'granted', requestPermission: async () => 'granted' }));
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on sound and go live' }));
  await waitFor(() => expect(screen.queryByTestId('go-live-gate')).toBeNull());
}

export interface RenderRedesignOptions {
  signedIn?: boolean;
  /** Pass the go-live gate first, for tests of what /orders shows under it. */
  live?: boolean;
}

export async function renderRedesign(path: string, { signedIn = true, live = false }: RenderRedesignOptions = {}) {
  installDomShims();
  resetServerClock();
  resetSignedOut();
  resetHeartbeatHealth();
  resetConnectionHistory();
  setSession(signedIn ? { accessToken: 'access-token-1' } : null);
  const { default: RedesignRoot } = await import('../RedesignRoot');
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <RedesignRoot />
    </MemoryRouter>,
  );
  if (live) await passGoLiveGate();
  return result;
}
