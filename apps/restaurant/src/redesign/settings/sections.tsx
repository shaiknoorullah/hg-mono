/**
 * The five settings sections (settings board `PartHalalCard`, `PartProfile`, `PartDocuments`,
 * `Settings-Account`, `Settings-Security`). Each has its own loading, error and empty draw.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, HalalBadge, KeyValueList, Skeleton, reportHalalClientError } from '../ds';
import { client } from '../data/client';
import { call } from '../data/call';
import { useConsole } from '../data/console';
import { useAvailability } from '../data/availability';
import { useServerResource, type ServerResource } from '../data/useServerResource';
import { formatPhone } from '../format/phone';
import { RightNow } from '../hours/RightNow';
import { downloadDocument } from '../onboarding/upload';
import { DOC_META, documentSummary, isShownDocType, longDate, type ShownDocType } from '../onboarding/model';
import { supportFrom } from '../auth/api';
import {
  DOC_LABEL,
  accountView,
  currentDocuments,
  docStateView,
  halalHidesListing,
  isReadOnlyAccount,
  type EditGroup,
  type HalalSectionView,
  type KycDocument,
  type RestaurantProfile,
} from './model';

const card = 'flex flex-col gap-4 rounded-lg border border-line-decorative bg-surface-raised p-6';

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="m-0 text-heading-md">
      {children}
    </h2>
  );
}

export function SectionSkeleton() {
  return (
    <div className={card} data-testid="section-skeleton" aria-hidden="true">
      <Skeleton variant="rect" width={220} height={28} />
      <Skeleton variant="rect" height={16} />
      <Skeleton variant="rect" height={16} />
      <Skeleton variant="rect" width={180} height={44} />
    </div>
  );
}

// ── Halal certification ───────────────────────────────────────────────────────────────────

const TONE_BOX: Record<HalalSectionView['tone'], string> = {
  certified: 'border-line-decorative bg-surface-raised',
  expiring: 'border-halal-expiring-border bg-halal-expiring-tint',
  // Cool slate: "we can't currently vouch". Never red.
  expired: 'border-halal-expired-border bg-halal-expired-tint',
  unverified: 'border-dashed border-halal-unverified-border bg-surface-raised',
  missing: 'border-line-decorative bg-surface-raised',
};

export function HalalSection({ view, profile, onRenew, onSupport }: { view: HalalSectionView; profile: RestaurantProfile | null; onRenew: () => void; onSupport: () => void }) {
  useEffect(() => {
    if (view.missing) reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId: profile?.id, received: profile?.halal, surface: 'operational' });
  }, [view.missing, profile?.id, profile?.halal]);
  const body = profile?.halal?.certifying_body_name?.trim();
  return (
    <section aria-labelledby="halal-h" className="flex flex-col gap-4" data-testid="section-halal" data-tone={view.tone}>
      <Heading id="halal-h">Halal certification</Heading>
      <div className={`flex flex-col gap-3 rounded-lg border p-6 ${TONE_BOX[view.tone]}`}>
        {view.badge ? <HalalBadge state={view.badge} surface="operational" size="md" restaurantId={profile?.id} /> : null}
        <h3 className="m-0 text-heading-sm">{view.title}</h3>
        <p className="m-0 text-body-md text-fg-primary">{view.body}</p>
        {body && view.badge ? <p className="m-0 text-body-md text-fg-secondary">Certified by {body}.</p> : null}
        <p className="m-0 text-body-sm text-fg-secondary">HalalGoes does not itself certify food.</p>
      </div>

      {view.renewal ? (
        <div className="flex flex-col gap-1 rounded-lg border border-line-decorative bg-surface-subtle p-4" role="status" data-testid="halal-renewal-note" data-kind={view.renewal.kind}>
          {view.renewal.kind === 'review' ? (
            <>
              <p className="m-0 text-label-lg">Renewed certificate in review</p>
              <p className="m-0 text-body-md text-fg-secondary">A reviewer checks it within 3 business days. We’ll tell you as soon as it’s decided.</p>
            </>
          ) : (
            <>
              <p className="m-0 text-label-lg">Your renewed certificate wasn't accepted</p>
              {view.renewal.note ? <p className="m-0 text-body-md text-fg-secondary">Reviewer’s note: “{view.renewal.note}”</p> : null}
              <p className="m-0 text-body-md text-fg-secondary">Upload a corrected certificate</p>
            </>
          )}
        </div>
      ) : null}

      {!view.missing ? (
        <div className="flex flex-col items-start gap-2">
          {view.uploadReason ? (
            <p id="renew-reason" className="m-0 text-body-md text-fg-secondary" data-testid="renew-reason">
              {view.uploadReason}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" disabled={!view.canUpload} aria-describedby={view.uploadReason ? 'renew-reason' : undefined} onPress={onRenew}>
              {view.uploadLabel}
            </Button>
            <Button variant="tertiary" size="lg" onPress={onSupport}>
              Contact support
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="tertiary" size="lg" onPress={onSupport}>
            Contact support
          </Button>
        </div>
      )}
    </section>
  );
}

// ── Account and orders right now ──────────────────────────────────────────────────────────

type Hours = { intervals: unknown[] };

export function AccountSection({ profile, onSupport }: { profile: RestaurantProfile | null; onSupport: () => void }) {
  const { core, config, timezone } = useConsole();
  const availability = useAvailability();
  const navigate = useNavigate();
  const hours: ServerResource<Hours> = useServerResource(() => call(client.GET('/v1/restaurant/hours', {})) as unknown as Promise<Hours>);
  const acct = accountView(profile?.account_state, halalHidesListing(profile?.halal));
  const live = profile?.account_state === 'LIVE' && !halalHidesListing(profile?.halal);
  const support = supportFrom(config);
  return (
    <section aria-labelledby="account-h" className="flex flex-col gap-4" data-testid="section-account">
      <Heading id="account-h">Account</Heading>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">Your listing</h3>
        <div className="flex items-center gap-2">
          <Badge label={acct.label} variant={acct.tone === 'warning' ? 'warning' : acct.tone === 'info' ? 'info' : 'neutral'} />
        </div>
        <p className="m-0 text-body-md" data-testid="account-text">
          {acct.text}
        </p>
        {isReadOnlyAccount(profile?.account_state) ? <p className="m-0 text-body-md text-fg-secondary">You can read your details but not change them.</p> : null}
        {!live ? (
          <div>
            <Button variant="tertiary" size="lg" onPress={onSupport}>
              Contact support
            </Button>
          </div>
        ) : null}
      </div>
      {live ? (
        availability.status === 'error' ? (
          <div role="alert" className={card} data-testid="orders-now-error">
            <h3 className="m-0 text-heading-sm">Orders right now</h3>
            <p className="m-0 text-body-md text-fg-secondary">We couldn’t read whether you’re taking orders. Your orders are not affected.</p>
            <div>
              <Button variant="tertiary" size="lg" onPress={() => availability.reload()}>
                Try again
              </Button>
            </div>
          </div>
        ) : availability.data ? (
          <RightNow
            availability={availability}
            restaurantId={core.data?.restaurantId ?? null}
            timezone={timezone}
            noHours={hours.status === 'ready' && hours.data?.intervals.length === 0}
            onSeeHours={() => navigate('/hours')}
            onSeeSpecialDates={() => navigate('/hours')}
            supportPhone={support?.tel ?? null}
          />
        ) : (
          <div className={card} data-testid="orders-now-loading" aria-hidden="true">
            <Skeleton variant="rect" width={200} height={24} />
            <Skeleton variant="rect" height={44} />
          </div>
        )
      ) : null}
    </section>
  );
}

// ── Business profile ──────────────────────────────────────────────────────────────────────

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-label-md text-fg-secondary">{label}</p>
        <p className="m-0 text-body-md">{value}</p>
      </div>
      {action}
    </div>
  );
}

export function ProfileSection({ profile, editable, onEdit, onRequest }: { profile: RestaurantProfile | null; editable: boolean; onEdit: (g: EditGroup) => void; onRequest: () => void }) {
  if (!profile) return <SectionSkeleton />;
  const a = profile.address;
  const owner = [profile.owner_first_name, profile.owner_last_name].filter(Boolean).join(' ');
  const edit = (g: EditGroup, label: string) =>
    editable ? (
      <Button variant="tertiary" size="md" onPress={() => onEdit(g)} aria-label={`Edit ${label}`}>
        Edit
      </Button>
    ) : null;
  const request = (label: string) =>
    editable ? (
      <Button variant="tertiary" size="md" onPress={onRequest} aria-label={`Request a change to ${label}`}>
        Request a change
      </Button>
    ) : null;
  return (
    <section aria-labelledby="profile-h" className="flex flex-col gap-4" data-testid="section-profile">
      <Heading id="profile-h">Business profile</Heading>
      {!editable ? <p className="m-0 text-body-md text-fg-secondary">You can read these details but not change them.</p> : null}
      <div className={card} data-testid="profile-names">
        <h3 className="m-0 text-heading-sm">Names</h3>
        <Row label="Name customers see" value={profile.display_name} action={request('the name customers see')} />
        <Row label="Legal business name" value={profile.legal_name} action={request('the legal name')} />
        <Row label="Owner" value={owner || 'Not set yet'} action={edit('names', 'owner name')} />
      </div>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">Phone numbers</h3>
        <Row label="Business phone" value={profile.phone_e164 ? formatPhone(profile.phone_e164) : 'Not set yet'} action={edit('contact', 'phone numbers')} />
        <Row label="Phone customers can call" value={profile.public_phone_e164 ? formatPhone(profile.public_phone_e164) : 'Not set yet'} />
      </div>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">Address</h3>
        <Row label="Street address" value={`${a.line1}${a.line2 ? `, ${a.line2}` : ''}, ${a.city}, ${a.province} ${a.postal_code}`} action={request('the address')} />
      </div>
      <div className={card} data-testid="profile-about">
        <h3 className="m-0 text-heading-sm">About</h3>
        <Row label="Description" value={profile.description?.trim() ? profile.description : 'Not set yet'} action={request('the description')} />
        <Row label="GST/HST number" value={profile.gst_hst_number ?? 'Not set yet'} action={request('the GST/HST number')} />
      </div>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">Kitchen</h3>
        <Row label="Usual preparation time" value={profile.avg_prep_minutes ? `${profile.avg_prep_minutes} minutes` : 'Not set yet'} action={edit('kitchen', 'preparation time')} />
      </div>
    </section>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────────────────

/** The label on a row's upload button: the board says what the upload is for (settings board `PartDocuments`). */
export function uploadLabel(d: KycDocument): string {
  if (d.state === 'REJECTED') return 'Upload a new version';
  if (d.state === 'EXPIRED') return 'Upload renewed certificate';
  return 'Upload new version';
}

export function DocumentsSection({ docs, denied, canUpload = false, onUpload }: { docs: ServerResource<KycDocument[]>; denied: boolean; canUpload?: boolean; onUpload?: (type: ShownDocType) => void }) {
  const [link, setLink] = useState<{ id: string; kind: 'gone' | 'failed' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id);
    setLink(null);
    const res = await downloadDocument(id);
    setBusy(null);
    if (res !== 'started') setLink({ id, kind: res });
  };
  let body: ReactNode;
  if (denied) {
    body = (
      <p className="m-0 text-body-md text-fg-secondary" data-testid="documents-denied">
        Only the owner or a manager can see the documents. Ask them to open this page.
      </p>
    );
  } else if (docs.status === 'loading') {
    body = (
      <div className="flex flex-col gap-3" data-testid="documents-loading" aria-hidden="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={56} />
      </div>
    );
  } else if (docs.status === 'error' || !docs.data) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2" data-testid="documents-error">
        <p className="m-0 text-heading-sm">Couldn't load your documents</p>
        <p className="m-0 text-body-md text-fg-secondary">Your documents haven’t changed. Check your connection and try again.</p>
        <Button variant="primary" size="lg" onPress={() => docs.reload()}>
          Try again
        </Button>
      </div>
    );
  } else {
    const rows = currentDocuments(docs.data);
    body =
      rows.length === 0 ? (
        <p className="m-0 text-body-md text-fg-secondary" data-testid="documents-empty">
          No documents on record yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {rows.map((d) => {
            const st = docStateView(d.state);
            return (
              <li key={d.id} className="flex flex-col gap-2 rounded-md border border-line-decorative p-4" data-testid={`doc-${d.doc_type}`} data-state={d.state}>
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-label-lg">{DOC_LABEL[d.doc_type] ?? d.doc_type}</p>
                  <Badge label={st.label} variant={st.tone} />
                </div>
                <p className="m-0 text-body-md text-fg-secondary">{documentSummary(d)}</p>
                {d.state === 'REJECTED' && d.review_note ? <p className="m-0 text-body-md">Reviewer’s note: “{d.review_note}”</p> : null}
                {d.state === 'EXPIRED' && d.valid_until ? <p className="m-0 text-body-md text-fg-secondary">Expired on {longDate(d.valid_until)}.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="tertiary" size="md" loading={busy === d.id} onPress={() => void open(d.id)} aria-label={`View ${DOC_LABEL[d.doc_type] ?? 'document'}`}>
                    View
                  </Button>
                  {/* The halal certificate is renewed under Halal certification; a document in review is locked. */}
                  {canUpload && onUpload && isShownDocType(d.doc_type) && d.doc_type !== 'HALAL_CERTIFICATE' && d.state !== 'SUBMITTED' && d.state !== 'IN_REVIEW' ? (
                    <Button variant="tertiary" size="md" onPress={() => onUpload(d.doc_type as ShownDocType)} aria-label={`${uploadLabel(d)}: ${DOC_META[d.doc_type as ShownDocType].lc}`}>
                      {uploadLabel(d)}
                    </Button>
                  ) : null}
                </div>
                {link?.id === d.id ? (
                  <p role="alert" className="m-0 text-body-md text-fg-secondary" data-testid="file-link-error">
                    {link.kind === 'gone' ? 'This file is no longer available.' : 'Couldn’t open the file. The link expired or the connection dropped. Try again.'}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      );
  }
  return (
    <section aria-labelledby="docs-h" className="flex flex-col gap-4" data-testid="section-documents">
      <Heading id="docs-h">Documents</Heading>
      <div className={card}>
        <p className="m-0 text-body-md text-fg-secondary">Your documents are private. Only HalalGoes reviewers see them, and a file opens through a link that expires in two minutes.</p>
        {body}
      </div>
    </section>
  );
}

// ── Sign-in and security ──────────────────────────────────────────────────────────────────

export function SecuritySection({ onChange }: { onChange: () => void }) {
  return (
    <section aria-labelledby="security-h" className="flex flex-col gap-4" data-testid="section-security">
      <Heading id="security-h">Sign-in and security</Heading>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">How you sign in</h3>
        <p className="m-0 text-body-md text-fg-secondary">With your email address and password.</p>
        <KeyValueList rows={[{ key: 'password', label: 'Password', value: 'Change it here at any time. You need your current password.' }]} />
        <div>
          <Button variant="primary" size="lg" onPress={onChange}>
            Change password
          </Button>
        </div>
      </div>
      <div className={card}>
        <h3 className="m-0 text-heading-sm">Forgot your password?</h3>
        <p className="m-0 text-body-md text-fg-secondary">Sign out, then choose Forgot your password? on the sign-in page. We email you a link to set a new one.</p>
      </div>
    </section>
  );
}
