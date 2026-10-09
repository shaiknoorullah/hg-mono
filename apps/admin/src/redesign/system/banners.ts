/**
 * The system banner slot's data (`ASS/SystemBannerStack`, manifest §1.1): which banners show,
 * top first, and what each says. The shell draws them with `Banner` from `ds.ts`; later work
 * packages add entries here (API not ready, the SMS-sender warning once #312 lands, the
 * high-severity alert and the What's new notice belong to WP-9 and WP-10).
 *
 * Order, top first: staging/local strip · offline · (API not ready) · (SMS sign-in codes) ·
 * (high-severity alert) · (What's new). The slot sits before `<main>`, pushes content down and
 * never covers it. Only the offline banner is a status region.
 */
import { useEffect, useState } from 'react';

import type { BannerTone } from '../ds';

export interface SystemBannerData {
  /** Stable key, also the banner's place in the stack. */
  readonly id: 'environment' | 'offline';
  readonly tone: BannerTone;
  readonly title: string;
  readonly description?: string;
  /** `status` announces politely; `none` is read in order only. */
  readonly announce: 'status' | 'alert' | 'none';
}

/** The environment the console was built for (`VITE_HG_ENV`); unset means production. */
const BUILD_ENV = (import.meta.env['VITE_HG_ENV'] as string | undefined) ?? '';

/**
 * The staging/local strip (`ASS/StaffStaging`): every page, every role, above all other banners.
 * Nothing in production. Copy verbatim from the board.
 */
export function environmentBanner(env: string = BUILD_ENV): SystemBannerData | null {
  const name = env.trim().toLowerCase();
  if (name === 'dev' || name === 'staging') {
    return {
      id: 'environment',
      tone: 'info',
      title: 'Staging: not the live platform.',
      description: 'Orders, payments and people here are test data.',
      announce: 'none',
    };
  }
  if (name === 'local') {
    return {
      id: 'environment',
      tone: 'info',
      title: 'Local: this computer only',
      description: 'Orders, payments and people here are test data.',
      announce: 'none',
    };
  }
  return null;
}

/** The offline banner (`ASS/SystemBannerStack` row 1), copy verbatim. */
export const OFFLINE_BANNER: SystemBannerData = {
  id: 'offline',
  tone: 'warning',
  title: "You're offline.",
  description: 'Changes are off until the connection returns. Nothing you do now is saved for later.',
  announce: 'status',
};

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** `navigator.onLine`, kept current by the window's `online` / `offline` events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(readOnline);
  useEffect(() => {
    const update = () => setOnline(readOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** The banners to show now, top first. */
export function useSystemBanners(env?: string): SystemBannerData[] {
  const online = useOnline();
  const out: SystemBannerData[] = [];
  const strip = environmentBanner(env);
  if (strip) out.push(strip);
  if (!online) out.push(OFFLINE_BANNER);
  return out;
}
