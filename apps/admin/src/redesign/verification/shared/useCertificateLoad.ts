/**
 * The halal certificate and, best effort, the restaurant application it belongs to. The console
 * and the full-size viewer open the same record, so both load it here.
 */
import { useCallback } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../../data/api';
import { unwrap, useLoad } from '../../../lib/load';

export interface LoadedCertificate {
  certificate: Schema['HalalCertificate'];
  application: Schema['RestaurantApplication'] | null;
}

export function useCertificateLoad(certificateId: string) {
  const fetcher = useCallback(async (): Promise<LoadedCertificate> => {
    const certificate = (await unwrap(api.GET('/v1/admin/halal-certificates/{certificateId}', { params: { path: { certificateId } } }))).data;
    let application: LoadedCertificate['application'] = null;
    try {
      application = (await unwrap(api.GET('/v1/admin/restaurant-applications/{restaurantId}', { params: { path: { restaurantId: certificate.restaurant_id } } }))).data;
    } catch {
      application = null;
    }
    return { certificate, application };
  }, [certificateId]);
  return useLoad<LoadedCertificate>(fetcher);
}
