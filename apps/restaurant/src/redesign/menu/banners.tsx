/**
 * The Menu page's banners (spec §4, §6): account and certificate states, stale data, changes
 * made elsewhere, and everything out of stock. Halal states are never red and never danger:
 * an expired certificate is neutral slate ("we can’t currently vouch").
 */
import type { ReactNode } from 'react';
import { Banner, Button } from '../ds';
import { formatCalendarDate, formatTime } from '../format/time';
import type { AccountState, HalalState } from './model';

export const RENEW_HREF = '/settings?panel=renew';
export const DOCUMENTS_HREF = '/settings#documents';

interface Action {
  label: string;
  variant: 'primary' | 'tertiary';
  href?: string;
  onPress?: () => void;
}

function actions(list: Action[]): ReactNode {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((a) => (
        <Button key={a.label} variant={a.variant} size="sm" href={a.href} onPress={a.onPress}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}

export interface MenuBannersInput {
  accountState: AccountState | null | undefined;
  /** The profile did not load, so the account state is unknown: the menu is view only (fails closed). */
  accountUnknown: { onRetry: () => void } | null;
  halal: { display_state: HalalState; expires_on?: string | null } | null | undefined;
  supportHref: string;
  stale: { at: number | null; onRetry: () => void } | null;
  liveChanges: { onRefresh: () => void } | null;
  allOut: boolean;
  timeZone: string;
  onShowNotApproved: () => void;
}

/** The banners, in order: account, certificate, stale, live changes, all out. */
export function menuBanners(input: MenuBannersInput): ReactNode[] {
  const { accountState, accountUnknown, halal, supportHref, stale, liveChanges, allOut, timeZone, onShowNotApproved } = input;
  const out: ReactNode[] = [];
  if (accountUnknown) {
    out.push(
      <div id="account-banner" key="account-unknown">
        <Banner
          variant="neutral"
          title="We couldn’t check your account, so your menu is view only for now."
          description={
            <>
              Nothing on your menu has changed. Check your connection and try again to make changes.
              {actions([{ label: 'Try again', variant: 'tertiary', onPress: accountUnknown.onRetry }])}
            </>
          }
        />
      </div>,
    );
  }
  const cert = halal?.display_state ?? null;
  const expires = halal?.expires_on ? formatCalendarDate(halal.expires_on, 'long') : null;
  const suspended = accountState === 'SUSPENDED' || accountState === 'BANNED';

  if (suspended) {
    out.push(
      <div id="account-banner" key="account">
        <Banner
          variant="neutral"
          title="Your menu is read-only while your account is suspended."
          description={
            <>
              Only HalalGoes support can change this.{cert === 'EXPIRED' ? '' : ' Orders already in progress still complete.'}
              {actions([{ label: 'Contact support', variant: 'tertiary', href: supportHref }])}
            </>
          }
        />
      </div>,
    );
    if (cert === 'EXPIRED') {
      out.push(
        <div id="cert-banner" key="cert">
          <Banner
            variant="neutral"
            title="Your halal certificate has also expired."
            description={
              <>
                {expires ? `It expired on ${expires}. ` : ''}Upload the renewed one now; customers see you again only when your account is active and the certificate is
                verified.
                {actions([{ label: 'Upload renewed certificate', variant: 'tertiary', href: RENEW_HREF }])}
              </>
            }
          />
        </div>,
      );
    }
  } else if (accountState === 'DEACTIVATED') {
    out.push(
      <div id="account-banner" key="account">
        <Banner
          variant="neutral"
          title="Your restaurant is deactivated."
          description={
            <>
              You asked HalalGoes to take it off the app. Your menu and hours are kept, so you can start again at any time.
              {actions([{ label: 'Contact support', variant: 'tertiary', href: supportHref }])}
            </>
          }
        />
      </div>,
    );
  } else if (accountState === 'DELISTED' && cert !== 'EXPIRED' && cert !== 'UNVERIFIED') {
    out.push(
      <div id="account-banner" key="account">
        <Banner
          variant="neutral"
          title="Customers can’t find your restaurant right now."
          description={
            <>
              This isn’t a penalty. It happens when a required document has expired or nothing on your menu is approved yet. You’re listed again by itself once the cause
              is fixed.
              {actions([
                { label: 'Show items not approved', variant: 'tertiary', onPress: onShowNotApproved },
                { label: 'Go to Documents', variant: 'primary', href: DOCUMENTS_HREF },
              ])}
            </>
          }
        />
      </div>,
    );
  }

  if (!suspended && accountState !== 'DEACTIVATED') {
    if (cert === 'EXPIRED') {
      out.push(
        <div id="cert-banner" key="cert">
          <Banner
            variant="neutral"
            title="Customers can’t find your restaurant right now."
            description={
              <>
                {expires ? `Your halal certificate expired on ${expires}. ` : 'Your halal certificate has expired. '}Upload your renewed certificate. HalalGoes reviews it
                within 3 business days.
                {actions([{ label: 'Upload renewed certificate', variant: 'primary', href: RENEW_HREF }])}
              </>
            }
          />
        </div>,
      );
    } else if (cert === 'UNVERIFIED') {
      out.push(
        <div id="cert-banner" key="cert">
          <Banner
            variant="neutral"
            title="Customers can’t find your restaurant yet."
            description={
              <>
                Your halal certificate is not verified yet. HalalGoes reviews documents within 3 business days.
                {actions([{ label: 'Go to Documents', variant: 'tertiary', href: DOCUMENTS_HREF }])}
              </>
            }
          />
        </div>,
      );
    } else if (cert === 'EXPIRING_SOON') {
      out.push(
        <div id="cert-banner" key="cert">
          <Banner
            variant="neutral"
            title={expires ? `Your halal certificate expires on ${expires}.` : 'Your halal certificate expires soon.'}
            description={
              <>
                Upload the renewed one before then so customers can keep finding you. We remind you 30, 14, 7 and 1 days before.
                {actions([{ label: 'Upload renewed certificate', variant: 'tertiary', href: RENEW_HREF }])}
              </>
            }
          />
        </div>,
      );
    }
  }

  if (stale) {
    out.push(
      <Banner
        key="stale"
        variant="warning"
        title={stale.at ? `Showing your menu as it was at ${formatTime(stale.at, timeZone)}.` : 'Showing your menu as it was when it last loaded.'}
        description={
          <>
            We couldn’t refresh it. Changes you make now may fail until the connection is back.
            {actions([{ label: 'Try again', variant: 'tertiary', onPress: stale.onRetry }])}
          </>
        }
      />,
    );
  }

  if (liveChanges) {
    out.push(
      <Banner
        key="live"
        variant="info"
        title="Your menu changed on another device or at HalalGoes."
        description={
          <>
            Refresh to see the latest before you change anything else.
            {actions([{ label: 'Refresh', variant: 'tertiary', onPress: liveChanges.onRefresh }])}
          </>
        }
      />,
    );
  }

  if (allOut) {
    out.push(
      <Banner
        key="allout"
        variant="warning"
        title="Every item is out of stock."
        description="Customers can see your menu but can’t order anything. Turn items back on with their switches, or switch off New orders at the top."
      />,
    );
  }

  return out;
}
