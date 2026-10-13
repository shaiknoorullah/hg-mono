/**
 * WP11 reads: the Deliveries list (`listRiderEarningEntries?type=DELIVERY`), one assignment's
 * redacted terminal view (`getAssignment`) and a short-lived document link
 * (`createDocumentDownloadUrl`). Nothing here sends or derives an amount: every amount a rider
 * sees is an entry's own `gross_cents`, rendered by `Price`.
 */
import { unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { fetchEntries, type EarningEntry, type Page } from '../earnings/api';
import type { RiderError } from '../data/errors';

export type Assignment = Schema['Assignment'];
export type PresignedDownload = Schema['PresignedDownload'];

/** One page of DELIVERY lines, newest first (the cursor is `meta.next_cursor`). */
export function fetchDeliveries(cursor?: string): Promise<Page<EarningEntry>> {
  return fetchEntries(cursor ? { type: ['DELIVERY'], cursor } : { type: ['DELIVERY'] });
}

export async function fetchAssignment(assignmentId: string): Promise<Assignment> {
  const res = await unwrap(rider.GET('/v1/riders/me/assignments/{assignmentId}', { params: { path: { assignmentId } } }));
  return (res as { data: Assignment }).data;
}

/**
 * A fresh presigned link for one document (P-28: TTL 120 s, audited on every issue). Minted on
 * each tap and never kept past its `expires_at`: no query cache, no storage.
 */
export async function fetchDownloadUrl(documentId: string): Promise<PresignedDownload> {
  const res = await unwrap(rider.GET('/v1/documents/{documentId}/download-url', { params: { path: { documentId } } }));
  return (res as { data: PresignedDownload }).data;
}

/** 404 or REASSIGNED: the delivery is no longer the rider's to read (HW Delivery-unavailable). */
export function isUnavailable(e: RiderError | null | undefined): boolean {
  return e?.status === 404 || e?.code === 'NOT_FOUND';
}

/**
 * The drop-off street only ("Brimley Rd, Scarborough, ON"): the house number and the postal code
 * are dropped after a delivery (HW n-delivery privacy rule). Unit and buzzer are separate fields
 * and are never read here.
 */
export function streetOnly(address: string): string {
  return address
    .replace(/^\s*\d+[A-Za-z]?(?:-\d+)?\s+/, '')
    .replace(/\s+[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\s*$/, '')
    .trim();
}

/** "Large · extra garlic sauce": the variant, then the add-ons. Never a price. */
export function itemMore(item: Assignment['items'][number]): string {
  return [item.variant_name, ...(item.addon_names ?? [])].filter(Boolean).join(' · ');
}

/** The assignment's own timestamps, in order, only those it carries. */
export function timeline(a: Assignment): { key: 'accepted' | 'atRestaurant' | 'pickedUp' | 'atDropoff' | 'delivered'; at: string }[] {
  const rows: { key: 'accepted' | 'atRestaurant' | 'pickedUp' | 'atDropoff' | 'delivered'; at: string | null | undefined }[] = [
    { key: 'accepted', at: a.assigned_at },
    { key: 'atRestaurant', at: a.arrived_pickup_at },
    { key: 'pickedUp', at: a.picked_up_at },
    { key: 'atDropoff', at: a.arrived_dropoff_at },
    { key: 'delivered', at: a.delivered_at },
  ];
  return rows.filter((r): r is { key: (typeof r)['key']; at: string } => !!r.at);
}
