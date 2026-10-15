/**
 * The system banner slot's data (`ASS/SystemBannerStack`, manifest §1.1): which banners show,
 * top first, and what each says. The shell draws them with `Banner` from `ds.ts`.
 *
 * Order, top first: staging/local strip · offline · API not ready · SMS sign-in codes (sticky, no
 * dismiss) · high-severity alert · (What's new, not built: see the pull request). The slot sits
 * before `<main>`, pushes content down and never covers it. Only the offline banner is a status
 * region; a new high-severity alert uses the alert role once.
 *
 * The API-not-ready and SMS banners are for every staff role, because both are outages anyone
 * helping a customer must know about (the sender check is readable by all three roles).
 */
import { useEffect, useState } from 'react';

import { alertBanner } from '../alerts/banner';
import { useAlerts } from '../alerts/store';
import type { BannerTone } from '../ds';
import type { StaffRole } from '../data/session';
import { SYSTEM } from './copy';
import { useStatus, viewOf, type StatusState } from './status';

export interface SystemBannerData {
  /** Stable key, also the banner's place in the stack. */
  readonly id: 'environment' | 'offline' | 'api' | 'sms' | 'alert';
  readonly tone: BannerTone;
  readonly title: string;
  readonly description?: string;
  /** `status` announces politely; `none` is read in order only. */
  readonly announce: 'status' | 'alert' | 'none';
  /** A link inside the console: the label and the route it opens. */
  readonly action?: { readonly label: string; readonly to: string };
  /** Present only on a banner the person may hide. */
  readonly onDismiss?: () => void;
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

/** "The API is not ready": the same fact as the System status page, on every page. */
export function apiBanner(status: StatusState): SystemBannerData | null {
  const reading = status.latest;
  if (!reading) return null;
  const view = viewOf(reading);
  if (view !== 'not-ready' && view !== 'inconsistent') return null;
  return {
    id: 'api',
    tone: 'warning',
    title: SYSTEM.banner.notReadyTitle,
    description: SYSTEM.banner.notReadyBody,
    announce: 'none',
    action: { label: SYSTEM.banner.open, to: '/system' },
  };
}

/** Sign-in codes by text may not arrive: sticky, no dismiss, for every role. */
export function smsBanner(status: StatusState): SystemBannerData | null {
  if (status.sms.kind !== 'failed') return null;
  return {
    id: 'sms',
    tone: 'warning',
    title: SYSTEM.banner.smsTitle,
    description: SYSTEM.banner.smsBody,
    announce: 'none',
    action: { label: SYSTEM.banner.open, to: '/system' },
  };
}

/** The banners to show now, top first. */
export function useSystemBanners(env?: string, role: StaffRole | null = null): SystemBannerData[] {
  const online = useOnline();
  const status = useStatus();
  const alerts = useAlerts();
  const out: SystemBannerData[] = [];
  const strip = environmentBanner(env);
  if (strip) out.push(strip);
  if (!online) out.push(OFFLINE_BANNER);
  const api = apiBanner(status);
  if (api) out.push(api);
  const sms = smsBanner(status);
  if (sms) out.push(sms);
  const alert = alertBanner(alerts, role);
  if (alert) out.push(alert);
  return out;
}
