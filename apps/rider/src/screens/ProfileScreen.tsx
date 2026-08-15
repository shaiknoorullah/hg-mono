/**
 * Profile & documents.
 *
 * Identity and vehicle come from `getRiderMe` (D-02 — the same server-side routing read the
 * home screen uses); the document set with its per-document review state comes from
 * `listRiderDocuments` (P-27/P-29). A rejected or expired document links straight back to the
 * onboarding screen's capture flow rather than duplicating it here.
 *
 * States: loading / error / ready for each of the two independent reads. A rider with zero
 * documents yet (early onboarding) sees the empty state, not a blank list.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Divider,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';
import type { Schema } from '@hg/api-client';
import { isApiError, unwrap } from '@hg/api-client';

import { api } from '../api';
import type { RiderDocumentList } from '../apiTypes';
import { logout } from '../auth';
import { Screen, LoadingView, ErrorView, EmptyView } from './Screen';
import { useNav } from '../nav';

type RiderMe = Schema['RiderMe'];

const DOC_LABELS: Record<string, string> = {
  DRIVERS_LICENCE: "Driver's licence",
  VEHICLE_REGISTRATION: 'Vehicle registration',
  VEHICLE_INSURANCE: 'Vehicle insurance',
  GOVERNMENT_ID: 'Government ID',
  WORK_ELIGIBILITY: 'Work eligibility',
  PROFILE_PHOTO: 'Profile photo',
  BUSINESS_LICENCE: 'Business licence',
  HALAL_CERTIFICATE: 'Halal certificate',
  FOOD_SAFETY: 'Food safety',
  OWNER_ID: 'Owner ID',
  LIABILITY_INSURANCE: 'Liability insurance',
};

const DOC_STATE_META: Record<string, { label: string; variant: BadgeVariant }> = {
  SUBMITTED: { label: 'Submitted', variant: 'info' },
  IN_REVIEW: { label: 'In review', variant: 'info' },
  APPROVED: { label: 'Approved', variant: 'brand' },
  REJECTED: { label: 'Needs attention', variant: 'warning' },
  EXPIRED: { label: 'Expired', variant: 'warning' },
  SUPERSEDED: { label: 'Replaced', variant: 'neutral' },
};

function fullName(rider: RiderMe): string {
  return [rider.first_name, rider.last_name].filter(Boolean).join(' ') || 'Rider';
}

type IdentityLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; rider: RiderMe };

type DocsLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'empty' }
  | { status: 'ready'; documents: RiderDocumentList };

export function ProfileScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const caption = useTypeStyle('caption');
  const name = useTypeStyle('heading.lg');
  const [identity, setIdentity] = React.useState<IdentityLoad>({ status: 'loading' });
  const [docs, setDocs] = React.useState<DocsLoad>({ status: 'loading' });

  const loadIdentity = React.useCallback(async () => {
    setIdentity({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me'));
      if (!data.data) {
        setIdentity({ status: 'error', message: 'No profile on this account yet.' });
        return;
      }
      setIdentity({ status: 'ready', rider: data.data });
    } catch (e) {
      setIdentity({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load your profile.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  const loadDocs = React.useCallback(async () => {
    setDocs({ status: 'loading' });
    try {
      const data = await unwrap(api.GET('/v1/riders/me/documents'));
      if (data.data.length === 0) {
        setDocs({ status: 'empty' });
        return;
      }
      setDocs({ status: 'ready', documents: data.data });
    } catch (e) {
      setDocs({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load your documents.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void loadIdentity();
    void loadDocs();
  }, [loadIdentity, loadDocs]);

  const needsAttention =
    docs.status === 'ready' && docs.documents.some((d) => d.state === 'REJECTED' || d.state === 'EXPIRED');

  return (
    <Screen title="Profile" subtitle="Your identity, vehicle & documents">
      {identity.status === 'loading' ? <LoadingView label="Loading your profile…" /> : null}
      {identity.status === 'error' ? (
        <ErrorView message={identity.message} errorCode={identity.code} onRetry={loadIdentity} />
      ) : null}

      {identity.status === 'ready' ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.density.gutter }}>
            <Avatar
              size="lg"
              name={fullName(identity.rider)}
              src={identity.rider.photo_url ?? undefined}
              alt=""
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ ...name, color: theme.color.text.primary }}>{fullName(identity.rider)}</Text>
              {identity.rider.phone_e164 ? (
                <Text style={{ ...caption, color: theme.color.text.secondary }}>{identity.rider.phone_e164}</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: theme.target.spacing, marginTop: 4 }}>
                <Badge label={identity.rider.account_status} variant="outline" size="sm" />
                <Badge label={identity.rider.onboarding_state} variant="outline" size="sm" />
              </View>
            </View>
          </View>
          {identity.rider.vehicle ? (
            <View style={{ marginTop: theme.target.spacing, gap: theme.target.spacing }}>
              <Divider />
              <Text style={{ color: theme.color.text.secondary }}>
                {identity.rider.vehicle.vehicle_type}
                {identity.rider.vehicle.licence_plate ? ` · ${identity.rider.vehicle.licence_plate}` : ''}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {needsAttention ? (
        <Banner
          variant="warning"
          title="A document needs attention"
          description="One or more of your documents was rejected or has expired."
          action={{ label: 'Fix it', onPress: () => nav.push('onboarding', undefined) }}
        />
      ) : null}

      <Card variant="filled">
        <View style={{ gap: theme.target.spacing }}>
          <Text style={{ ...caption, color: theme.color.text.secondary }}>DOCUMENTS</Text>
          {docs.status === 'loading' ? <LoadingView label="Loading documents…" /> : null}
          {docs.status === 'error' ? (
            <ErrorView message={docs.message} errorCode={docs.code} onRetry={loadDocs} />
          ) : null}
          {docs.status === 'empty' ? (
            <EmptyView
              title="No documents on file"
              description="Capture your documents from the onboarding screen to get verified."
              actionLabel="Go to onboarding"
              onAction={() => nav.push('onboarding', undefined)}
            />
          ) : null}
          {docs.status === 'ready'
            ? docs.documents.map((doc) => (
                <View key={doc.id} style={{ gap: theme.target.spacing }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.color.text.primary }}>
                      {DOC_LABELS[doc.doc_type] ?? doc.doc_type}
                    </Text>
                    <Badge
                      label={DOC_STATE_META[doc.state]?.label ?? doc.state}
                      variant={DOC_STATE_META[doc.state]?.variant ?? 'neutral'}
                      size="sm"
                    />
                  </View>
                  {doc.valid_until ? (
                    <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                      Valid until {doc.valid_until}
                    </Text>
                  ) : null}
                  <Divider />
                </View>
              ))
            : null}
        </View>
      </Card>

      <Button variant="secondary" size="lg" fullWidth onPress={() => nav.push('deliveries', undefined)}>
        Delivery history
      </Button>
      <Button variant="secondary" size="lg" fullWidth onPress={() => nav.push('earnings', { tab: 'summary' })}>
        Earnings & payouts
      </Button>
      <Button variant="secondary" size="lg" fullWidth onPress={() => nav.push('onboarding', undefined)}>
        Onboarding & KYC
      </Button>

      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onPress={() => {
          logout();
          nav.resetHome();
        }}
      >
        Sign out
      </Button>
    </Screen>
  );
}
