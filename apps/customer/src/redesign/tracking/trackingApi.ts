/**
 * The reads the order-tracking screen makes, through the redesign API client.
 *
 * Every call is a GET: tracking never sends a price, an amount or a state change. The order and its
 * tracking projection are the two reads the screen cannot draw without; the payment (card and
 * amount), the refunds (an open report) and the public config (the reply window) improve the page
 * when they arrive and are simply left out when they do not.
 */
import type { Schema } from '@hg/api-client';

import { getPublicConfig } from '../api/config';
import {
  getOrder,
  getOrderPayment,
  getOrderTracking,
  listOrderRefunds,
  type OrderCustomerView,
  type OrderPayment,
  type OrderTracking,
  type Refund,
} from '../orders/ordersApi';
import { isLiveLayout, isWaitingLayout } from './trackingView';

export type { OrderCustomerView, OrderPayment, OrderTracking, Refund };
export type RiderPublicProfile = Schema['RiderPublicProfile'];

export interface TrackedOrder {
  order: OrderCustomerView;
  /** Null while the order is not on a layout this screen draws, or when a waiting-state read failed. */
  tracking: OrderTracking | null;
  payment: OrderPayment | null;
  /** Reports this customer has open on the order (needs a read of the refunds). */
  refunds: Refund[];
  /** `restaurant_response_window_seconds`, for the width of the reply-by bar. */
  responseWindowSeconds: number | null;
}

async function settled<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

/** Reads the order, then whatever its state needs. Throws if the order or its tracking cannot be read. */
export async function readTrackedOrder(orderId: string): Promise<TrackedOrder> {
  const order = await getOrder(orderId);
  if (!isWaitingLayout(order.state) && !isLiveLayout(order.state)) {
    // Delivered, finished or ended: another screen draws it; nothing more to read here.
    return { order, tracking: null, payment: null, refunds: [], responseWindowSeconds: null };
  }
  const live = isLiveLayout(order.state);
  const [tracking, payment, refunds, config] = await Promise.all([
    live ? getOrderTracking(orderId) : settled(() => getOrderTracking(orderId)),
    settled(() => getOrderPayment(orderId)),
    live ? settled(() => listOrderRefunds(orderId)) : Promise.resolve([] as Refund[]),
    isWaitingLayout(order.state) ? settled(getPublicConfig) : Promise.resolve(null),
  ]);
  return {
    order,
    tracking,
    payment,
    refunds: refunds ?? [],
    responseWindowSeconds: config?.restaurant_response_window_seconds ?? null,
  };
}

