/**
 * Settings, `/settings/:section` (restaurant work package for settings; canvas
 * `ScreenSettings`). A section list on the left (title and a one-line summary), the chosen
 * section beside it, and a panel on the right while an edit, an upload or a password change is
 * open (the section list then keeps titles only).
 *
 *   Halal certification | Account | Business profile | Documents | This device | Sign-in and security
 *
 * Page banners for the certificate, the account state and the connection already sit under
 * the status bar on every page (`status/Banners`), so this page does not draw a second set;
 * the sections carry the detail. Not built here yet: What's new (the contract has no release
 * notes), the document upload sheet for the other documents, and the address change (see
 * the pull request).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Skeleton, useToast } from '../ds';
import { client } from '../data/client';
import { call } from '../data/call';
import { useConsole } from '../data/console';
import { useServerResource, errorStatus } from '../data/useServerResource';
import { serverNow } from '../data/serverClock';
import { isoDateIn } from '../format/time';
import { halalCertificateRow } from '../status/halal';
import { usePagePanelOpen } from '../shell/layout';
import { EditPanel, PasswordPanel, RenewHalalPanel, SupportPanel } from './panels';
import { DeviceSection } from './DeviceSection';
import { deviceSummary, useDevicePrefs, useNotifications } from './device';
import { AccountSection, DocumentsSection, HalalSection, ProfileSection, SecuritySection, SectionSkeleton } from './sections';
import {
  SECTIONS,
  accountView,
  canManage,
  documentsSummary,
  halalHidesListing,
  halalSectionView,
  isReadOnlyAccount,
  isSectionKey,
  type EditGroup,
  type KycDocument,
  type SectionKey,
} from './model';

function loadDocuments(): Promise<KycDocument[]> {
  return call(client.GET('/v1/restaurant/documents', {}));
}

type Panel = 'renew' | 'password' | 'support' | 'support-change' | `edit-${EditGroup}`;
const PANELS: readonly Panel[] = ['renew', 'password', 'support', 'support-change', 'edit-names', 'edit-contact', 'edit-kitchen'];

// ── Page ──────────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { profile, core, timezone } = useConsole();
  const docs = useServerResource(loadDocuments);
  const devicePrefs = useDevicePrefs();
  const notifications = useNotifications();
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const raw = params['*']?.split('/')[0];
  const section: SectionKey = isSectionKey(raw) ? raw : 'halal';
  const panelParam = search.get('panel') as Panel | null;
  const panel = panelParam && PANELS.includes(panelParam) ? panelParam : null;
  usePagePanelOpen(panel !== null && profile.status !== 'loading');

  const roles = core.data?.principal.roles;
  const manage = canManage(roles);
  const p = profile.data;
  const readOnly = isReadOnlyAccount(p?.account_state);
  const today = isoDateIn(serverNow(), timezone);
  // Staff cannot read the document pack (the contract limits it to owner and manager): their
  // read answers 403, which is "ask the owner", not a failure of the page.
  const docsDenied = docs.status === 'error' && errorStatus(docs.error) === 403;
  const cert = halalCertificateRow(docs.data);
  const halal = halalSectionView(p?.halal, cert, today, manage && !readOnly);

  const open = (next: Panel | null) => {
    const q = new URLSearchParams(search);
    if (next) q.set('panel', next);
    else q.delete('panel');
    setSearch(q, { replace: false });
  };
  const close = () => open(null);
  const go = (key: SectionKey) => navigate(`/settings/${key}`);

  // `/settings?panel=renew` is the link the halal banners use.
  useEffect(() => {
    if (panelParam && !panel) {
      const q = new URLSearchParams(search);
      q.delete('panel');
      setSearch(q, { replace: true });
    }
  }, [panelParam, panel, search, setSearch]);

  if (profile.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" data-testid="settings-page" data-state="error">
        <div role="alert" className="flex w-full max-w-[600px] flex-col items-center gap-3 rounded-lg border border-line-interactive bg-surface-raised px-6 py-8 text-center">
          <h2 className="m-0 text-heading-lg">Couldn’t load your settings</h2>
          <p className="m-0 text-body-lg text-fg-secondary">Your restaurant and your orders are not affected. Check your connection and try again.</p>
          <Button variant="primary" size="lg" onPress={() => profile.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const loading = profile.status === 'loading' || !p;
  const summaries: Record<SectionKey, string> = {
    halal: loading ? '' : halal.summary,
    account: loading ? '' : accountView(p?.account_state, halalHidesListing(p?.halal)).label,
    profile: loading ? '' : p?.description?.trim() ? 'Complete' : 'Description missing',
    documents: docsDenied ? 'Owner and managers only' : documentsSummary(docs.data, docs.status === 'error'),
    device: deviceSummary(devicePrefs, notifications.state),
    security: 'Sign-in details',
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="settings-page" data-state={loading ? 'loading' : 'ready'} aria-busy={loading || undefined}>
      <nav aria-label="Settings sections" className={`flex shrink-0 flex-col gap-1 overflow-y-auto ${panel ? 'w-[200px]' : 'w-[280px]'}`} data-testid="settings-nav">
        <h1 className="m-0 px-3 pb-2 text-heading-lg">Settings</h1>
        {SECTIONS.map((s) => {
          const on = s.key === section;
          return (
            <button
              key={s.key}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => go(s.key)}
              className={`hg-focus flex min-h-14 flex-col items-start justify-center rounded-md px-3 py-2 text-start ${on ? 'bg-state-selected-tint text-label-lg font-bold' : 'bg-transparent text-body-md'}`}
            >
              <span>{s.title}</span>
              {loading ? <Skeleton variant="rect" width={140} height={14} /> : panel ? null : <span className="text-body-sm font-normal text-fg-secondary">{summaries[s.key]}</span>}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-6" data-testid="settings-content">
        {loading ? (
          <SectionSkeleton />
        ) : section === 'halal' ? (
          <HalalSection view={halal} profile={p} onRenew={() => open('renew')} onSupport={() => open('support')} />
        ) : section === 'account' ? (
          <AccountSection profile={p} onSupport={() => open('support')} />
        ) : section === 'profile' ? (
          <ProfileSection profile={p} editable={manage && !readOnly} onEdit={(g) => open(`edit-${g}`)} onRequest={() => open('support-change')} />
        ) : section === 'documents' ? (
          <DocumentsSection docs={docs} denied={docsDenied} />
        ) : section === 'device' ? (
          <DeviceSection />
        ) : (
          <SecuritySection onChange={() => open('password')} />
        )}
      </div>

      {panel === 'renew' ? <RenewHalalPanel onClose={close} /> : null}
      {panel === 'password' ? (
        <PasswordPanel
          onClose={close}
          onChanged={() => {
            close();
            toast.show({ variant: 'success', title: 'Password changed', description: 'Sign in again on your order screen if it isn’t this one. Other devices are signed out.' });
          }}
        />
      ) : null}
      {panel === 'support' || panel === 'support-change' ? <SupportPanel about={panel === 'support-change' ? 'change' : 'general'} onClose={close} /> : null}
      {panel?.startsWith('edit-') && p ? (
        <EditPanel
          key={panel}
          group={panel.slice(5) as EditGroup}
          profile={p}
          onClose={close}
          onSaved={(saved) => {
            profile.mutate(() => saved);
            close();
          }}
        />
      ) : null}
    </div>
  );
}
