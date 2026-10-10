/**
 * The current step of a delivery in words, for Home's step card and the resume strip
 * (SH/HomeOnDelivery, HomeOnDeliveryDropoff, EarningsTabResume, ResumeStripDropoff):
 *
 * - to the restaurant: "Go to Zaytoun Grill", its address;
 * - to the customer: "Go to Aisha M.", the address and unit;
 * - at the door (ARRIVED_AT_DROPOFF): "At Aisha M.'s door".
 *
 * The full drop-off address is on the phone from accept (owner decision).
 */
import type { Assignment } from './dashboard';

const DROPOFF_LEG = new Set(['PICKED_UP', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_AT_DROPOFF']);

export interface StepLine {
  title: string;
  /** The address line under the title. */
  detail: string;
  /** The resume strip's one line: title, plus the street on the drop-off leg. */
  strip: string;
}

export function stepLine(a: Assignment): StepLine {
  if (DROPOFF_LEG.has(a.state)) {
    const name = a.dropoff.customer_display_name;
    const detail = a.dropoff.unit ? `${a.dropoff.address} · ${a.dropoff.unit}` : a.dropoff.address;
    if (a.state === 'ARRIVED_AT_DROPOFF') {
      const title = `At ${name}'s door`;
      return { title, detail, strip: title };
    }
    const title = `Go to ${name}`;
    const street = a.dropoff.address.split(',')[0]?.trim();
    return { title, detail, strip: street ? `${title} · ${street}` : title };
  }
  const title = `Go to ${a.pickup.restaurant_name}`;
  return { title, detail: a.pickup.address, strip: title };
}
