/** Test data for the alerts area: contract fixtures turned into `admin:ops` envelopes. */
import type { RealtimeEnvelope } from '@hg/api-client';

import { fixture } from '../../testing';

export const opsEvents = () => fixture<RealtimeEnvelope[]>('realtime_admin_ops_all');

export function alertEvent(seq: number, data: Record<string, unknown>, type = 'admin.alert'): RealtimeEnvelope {
  return {
    id: `01TESTEVENT${String(seq).padStart(15, '0')}`,
    seq,
    channel: 'admin:ops',
    type,
    v: 1,
    ts: '2026-08-10T18:50:00.000Z',
    data,
  } as RealtimeEnvelope;
}

export const highAlert = (seq: number, over: Record<string, unknown> = {}) =>
  alertEvent(seq, {
    severity: 'high',
    kind: 'webhook_delivery_failed',
    subject_type: 'PLATFORM',
    subject_id: null,
    message: 'Stripe webhook deliveries have failed for 5 minutes.',
    at: '2026-08-10T18:50:00.000Z',
    ...over,
  });
