/**
 * The reads the order outcome screen makes on top of the order the tracking screen already has.
 *
 * Every call is a GET. The payment says what was held and charged, the refunds say what is owed back
 * and in what state, the tracking record carries the timeline of a disputed order. A failed payment
 * read is reported (the money card says it could not load); a failed refunds or timeline read is
 * left out, because those only add to the page.
 */
import { getOrderPayment, getOrderTracking, listOrderRefunds, type OrderPayment, type OrderTracking, type Refund } from '../orders/ordersApi';

export interface OutcomeData {
  payment: OrderPayment | null;
  refunds: Refund[];
  timeline: OrderTracking['timeline'] | null;
}

async function settled<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

export async function readOutcome(orderId: string, wantsTimeline: boolean): Promise<OutcomeData> {
  const [payment, refunds, tracking] = await Promise.all([
    settled(() => getOrderPayment(orderId)),
    settled(() => listOrderRefunds(orderId)),
    wantsTimeline ? settled(() => getOrderTracking(orderId)) : Promise.resolve(null),
  ]);
  return { payment, refunds: refunds ?? [], timeline: tracking?.timeline ?? null };
}
